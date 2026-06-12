package no.leiflan.garage

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.dialog.Dialog
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import no.leiflan.garage.api.ActionModel
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi.ConnectionMode
import no.leiflan.garage.ui.theme.BgBase
import no.leiflan.garage.ui.theme.CautionOrange
import no.leiflan.garage.ui.theme.ConnGreen
import no.leiflan.garage.ui.theme.ConnRed
import no.leiflan.garage.ui.theme.ErrorRed
import no.leiflan.garage.ui.theme.NeonCyan
import no.leiflan.garage.ui.theme.OnCyan
import no.leiflan.garage.ui.theme.OnOrange
import no.leiflan.garage.ui.theme.OnSurface
import no.leiflan.garage.ui.theme.Surface1

private const val STATE_PATH = "/garage/state"
private const val CMD_PATH = "/garage/cmd"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WearApp() }
    }
}

private val WearColors = Colors(
    primary = NeonCyan, onPrimary = OnCyan,
    secondary = CautionOrange, onSecondary = OnOrange,
    background = BgBase, onBackground = OnSurface,
    surface = Surface1, onSurface = OnSurface,
    error = ErrorRed,
)

@Composable
fun WearApp() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    // The watch RIDES the phone: state comes from the phone's retained DataItem; commands relay back to it.
    var door by remember { mutableStateOf<DoorStatus?>(null) }
    var mode by remember { mutableStateOf(ConnectionMode.OFFLINE) }
    var demo by remember { mutableStateOf(false) }
    var linked by remember { mutableStateOf(false) }   // have we received state from the phone?
    var nowSec by remember { mutableStateOf(System.currentTimeMillis() / 1000) }
    var pending by remember { mutableStateOf<ActionModel.Action?>(null) }

    fun applyState(m: DataMap) {
        door = DoorStatus(m.getString("state", "UNKNOWN"), m.getString("dir", ""), m.getLong("since", 0L), 0L)
        mode = try { ConnectionMode.valueOf(m.getString("mode", "OFFLINE")) } catch (_: Exception) { ConnectionMode.OFFLINE }
        demo = m.getBoolean("demo", false)
        linked = true
    }

    // Listen for the phone's door-state DataItem (+ read the current one on start).
    DisposableEffect(Unit) {
        val dc = Wearable.getDataClient(ctx)
        dc.dataItems.addOnSuccessListener { buffer ->
            for (item in buffer) if (item.uri.path == STATE_PATH) applyState(DataMapItem.fromDataItem(item).dataMap)
            buffer.release()
        }
        val listener = DataClient.OnDataChangedListener { events ->
            for (e in events) {
                if (e.type == DataEvent.TYPE_CHANGED && e.dataItem.uri.path == STATE_PATH) {
                    applyState(DataMapItem.fromDataItem(e.dataItem).dataMap)
                }
            }
        }
        dc.addListener(listener)
        onDispose { dc.removeListener(listener) }
    }

    // Local 1s tick just for the "for Xs" duration text (no networking).
    LaunchedEffect(Unit) { while (true) { nowSec = System.currentTimeMillis() / 1000; delay(1000) } }

    fun relay(cmd: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                for (n in nodes) Wearable.getMessageClient(ctx).sendMessage(n.id, CMD_PATH, cmd.toByteArray())
            } catch (_: Exception) { /* phone not reachable */ }
        }
    }

    // On launch, ask the phone for current state — wakes GarageWearService if the phone app is closed,
    // so the watch shows live state without the phone app being open.
    LaunchedEffect(Unit) { relay("refresh") }

    MaterialTheme(colors = WearColors) {
        Scaffold(timeText = { TimeText() }) {
            val state = if (linked) door?.state else null
            val actions = ActionModel.actionsFor(state)
            Column(
                Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                if (demo) {
                    Text("DEMO", color = CautionOrange, style = MaterialTheme.typography.caption2, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(2.dp))
                }
                Text(
                    if (linked) DoorModel.shortLabel(state) else "—",
                    style = MaterialTheme.typography.title2,
                    color = if (DoorModel.isStopped(state)) CautionOrange else MaterialTheme.colors.onBackground,
                    textAlign = TextAlign.Center,
                )
                Text(subLabel(linked, door, mode, nowSec), style = MaterialTheme.typography.caption2, color = MaterialTheme.colors.onSurface, textAlign = TextAlign.Center)
                Spacer(Modifier.height(10.dp))

                if (linked) {
                    if (actions.size == 2) {
                        ActionChip(actions[0]) { pending = it }
                        Spacer(Modifier.height(6.dp))
                        ActionChip(actions[1]) { pending = it }
                    } else {
                        ActionChip(actions[0]) { pending = it }
                    }
                }

                Spacer(Modifier.height(10.dp))
                val online = linked && mode != ConnectionMode.OFFLINE
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("●", color = if (online) ConnGreen else ConnRed, style = MaterialTheme.typography.caption3)
                    Spacer(Modifier.width(4.dp))
                    Text(if (linked) connShort(mode) else "open phone", color = MaterialTheme.colors.onSurface, style = MaterialTheme.typography.caption3)
                }
            }
        }

        // Confirm Yes/No — buttons pushed to opposite edges so a "shower tap" can't hit the wrong one.
        val p = pending
        Dialog(showDialog = p != null, onDismissRequest = { pending = null }) {
            if (p != null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(Modifier.padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${p.label}?", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(16.dp))
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            CompactChip(
                                onClick = { pending = null },
                                label = { Text("No") },
                                colors = ChipDefaults.chipColors(backgroundColor = Surface1, contentColor = OnSurface),
                            )
                            CompactChip(
                                onClick = { relay(p.cmd); pending = null },
                                label = { Text("Yes") },
                                colors = ChipDefaults.chipColors(backgroundColor = NeonCyan, contentColor = OnCyan),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionChip(action: ActionModel.Action, onTap: (ActionModel.Action) -> Unit) {
    val cyan = action.tone == ActionModel.Tone.PRIMARY
    Chip(
        onClick = { onTap(action) },
        label = { Text("${action.arrow} ${action.label}".trim(), textAlign = TextAlign.Center) },
        colors = ChipDefaults.chipColors(
            backgroundColor = if (cyan) NeonCyan else CautionOrange,
            contentColor = if (cyan) OnCyan else OnOrange,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun subLabel(linked: Boolean, door: DoorStatus?, mode: ConnectionMode, nowSec: Long): String = when {
    !linked -> "phone app"
    door == null -> "…"
    door.state == "OPENING" || door.state == "CLOSING" -> "in motion"
    door.state == "STOPPED_OPENING" -> "while opening"
    door.state == "STOPPED_CLOSING" -> "while closing"
    else -> "for " + DoorModel.fmtDur(DoorModel.durationSec(door, nowSec))
}

private fun connShort(mode: ConnectionMode): String = when (mode) {
    ConnectionMode.HTTP_DIRECT -> "direct"
    ConnectionMode.LOCAL_BROKER -> "broker"
    ConnectionMode.CLOUD -> "cloud"
    ConnectionMode.OFFLINE -> "offline"
}
