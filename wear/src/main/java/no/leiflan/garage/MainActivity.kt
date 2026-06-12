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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import kotlinx.coroutines.delay
import no.leiflan.garage.api.ActionModel
import no.leiflan.garage.api.DemoEngine
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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WearApp() }
    }
}

// Cyber Garage Control palette, Wear flavour.
private val WearColors = Colors(
    primary = NeonCyan, onPrimary = OnCyan,
    secondary = CautionOrange, onSecondary = OnOrange,
    background = BgBase, onBackground = OnSurface,
    surface = Surface1, onSurface = OnSurface,
    error = ErrorRed,
)

@Composable
fun WearApp() {
    // ROUGH BUILD: demo-driven (no phone relay yet — Phase 2b). The whole UI is exercisable on the watch
    // over ADB with no phone. A small DEMO stamp makes that unmistakable.
    val demo = remember { DemoEngine() }
    var door by remember { mutableStateOf<DoorStatus?>(null) }
    var mode by remember { mutableStateOf(ConnectionMode.HTTP_DIRECT) }
    var nowSec by remember { mutableStateOf(System.currentTimeMillis() / 1000) }
    var pending by remember { mutableStateOf<ActionModel.Action?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            val now = System.currentTimeMillis()
            door = demo.door(now); mode = demo.modeAt(now); nowSec = now / 1000
            delay(1000)
        }
    }

    MaterialTheme(colors = WearColors) {
        Scaffold(timeText = { TimeText() }) {
            val state = door?.state
            val actions = ActionModel.actionsFor(state)
            Column(
                Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("DEMO", color = CautionOrange, style = MaterialTheme.typography.caption2, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(2.dp))
                Text(
                    DoorModel.shortLabel(state),
                    style = MaterialTheme.typography.title2,
                    color = if (DoorModel.isStopped(state)) CautionOrange else MaterialTheme.colors.onBackground,
                    textAlign = TextAlign.Center,
                )
                Text(subLabel(door, mode, nowSec), style = MaterialTheme.typography.caption2, color = MaterialTheme.colors.onSurface, textAlign = TextAlign.Center)
                Spacer(Modifier.height(10.dp))

                // morphing action — single button, or the STOPPED pair (still one tap each, each confirmed)
                if (actions.size == 2) {
                    ActionChip(actions[0]) { pending = it }
                    Spacer(Modifier.height(6.dp))
                    ActionChip(actions[1]) { pending = it }
                } else {
                    ActionChip(actions[0]) { pending = it }
                }

                Spacer(Modifier.height(10.dp))
                val online = mode != ConnectionMode.OFFLINE
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("●", color = if (online) ConnGreen else ConnRed, style = MaterialTheme.typography.caption3)
                    Spacer(Modifier.width(4.dp))
                    Text(connShort(mode), color = MaterialTheme.colors.onSurface, style = MaterialTheme.typography.caption3)
                }
            }
        }

        // Confirm yes/no — guards against an accidental "shower tap".
        val p = pending
        Dialog(showDialog = p != null, onDismissRequest = { pending = null }) {
            if (p != null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${p.label}?", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CompactChip(
                                onClick = { pending = null },
                                label = { Text("No") },
                                colors = ChipDefaults.chipColors(backgroundColor = Surface1, contentColor = OnSurface),
                            )
                            CompactChip(
                                onClick = {
                                    val now = System.currentTimeMillis()
                                    demo.command(p.cmd, now); door = demo.door(now)
                                    pending = null
                                },
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

private fun subLabel(door: DoorStatus?, mode: ConnectionMode, nowSec: Long): String = when {
    door == null && mode == ConnectionMode.OFFLINE -> "offline"
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
