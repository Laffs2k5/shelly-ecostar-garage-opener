package no.leiflan.garage

import android.Manifest
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.leiflan.garage.api.ActionModel
import no.leiflan.garage.api.ConnectionUi
import no.leiflan.garage.api.DemoEngine
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi
import no.leiflan.garage.api.GarageApi.ConnectionMode
import no.leiflan.garage.api.MqttTls
import no.leiflan.garage.api.MqttTransport
import no.leiflan.garage.notification.NotifyController
import no.leiflan.garage.notification.Notifier
import no.leiflan.garage.notification.Scheduler
import no.leiflan.garage.ui.BrandBar
import no.leiflan.garage.ui.ConnectionFooter
import no.leiflan.garage.ui.DoorSchematic
import no.leiflan.garage.ui.NeonActionButton
import no.leiflan.garage.ui.SplitActionButton
import no.leiflan.garage.ui.theme.CautionOrange
import no.leiflan.garage.ui.theme.GarageTheme
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MqttTransport.init(this)
        Notifier.createChannels(this)
        Scheduler.apply(this, loadSettings(this))
        setContent { GarageTheme { AppRoot() } }
    }
}

private const val PREFS = "garage_settings"

data class Settings(
    val i4Ip: String, val s1Ip: String, val monId: String, val ctrlId: String,
    val localHost: String, val cloudHost: String, val cloudUser: String, val cloudPass: String,
    val p12Pass: String, val clientId: String, val demo: Boolean = false,
    // v2 notifications + alarms (spec 16)
    val notifyMode: String = "off",       // "always" | "after" | "off"
    val notifyAfterMin: Int = 5,
    val openAlarmEnabled: Boolean = false, val openAlarmMin: Int = 10,
    val timeAlarmEnabled: Boolean = false, val timeAlarm: String = "22:00",
)

fun loadSettings(ctx: Context): Settings {
    val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun g(k: String) = p.getString(k, "") ?: ""
    fun gd(k: String, d: String) = g(k).ifBlank { d }
    return Settings(
        g("i4_ip"), g("s1_ip"), gd("mon_id", "garage-monitor"), gd("ctrl_id", "garage-controller"),
        g("mqtt_local_host"), g("mqtt_cloud_host"), g("cloud_user"), g("cloud_pass"),
        g("p12_pass"), g("client_id"), p.getBoolean("demo", false),
        gd("notify_mode", "off"), p.getInt("notify_after_min", 5),
        p.getBoolean("open_alarm_en", false), p.getInt("open_alarm_min", 10),
        p.getBoolean("time_alarm_en", false), gd("time_alarm", "22:00"),
    )
}

fun saveSettings(ctx: Context, s: Settings) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
        putString("i4_ip", s.i4Ip); putString("s1_ip", s.s1Ip)
        putString("mon_id", s.monId); putString("ctrl_id", s.ctrlId)
        putString("mqtt_local_host", s.localHost); putString("mqtt_cloud_host", s.cloudHost)
        putString("cloud_user", s.cloudUser); putString("cloud_pass", s.cloudPass)
        putString("p12_pass", s.p12Pass); putString("client_id", s.clientId)
        putBoolean("demo", s.demo)
        putString("notify_mode", s.notifyMode); putInt("notify_after_min", s.notifyAfterMin)
        putBoolean("open_alarm_en", s.openAlarmEnabled); putInt("open_alarm_min", s.openAlarmMin)
        putBoolean("time_alarm_en", s.timeAlarmEnabled); putString("time_alarm", s.timeAlarm)
        apply()
    }
}

private fun copyToFiles(ctx: Context, uri: Uri, name: String): Boolean = try {
    ctx.contentResolver.openInputStream(uri)?.use { inp ->
        File(ctx.filesDir, name).outputStream().use { inp.copyTo(it) }
    }
    true
} catch (_: Exception) { false }

private fun hhmm(): String = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())

// --- poll + command (run on IO) ---
private fun poll(s: Settings): GarageApi.StatusResult {
    if (s.i4Ip.isNotBlank()) {
        val local = GarageApi.fetchLocalDoor(s.i4Ip)
        if (local != null) { MqttTransport.disconnect(); return GarageApi.decide(local, GarageApi.Broker.NONE, null) }
    }
    MqttTransport.ensureConnected(s.cloudUser, s.cloudPass)
    return GarageApi.decide(null, MqttTransport.connectedVia, MqttTransport.lastDoor)
}

private fun sendCmd(s: Settings, mode: ConnectionMode, cmd: String): Boolean =
    if (mode == ConnectionMode.HTTP_DIRECT) GarageApi.sendLocalCommand(s.s1Ip, 1, cmd)
    else MqttTransport.publishCommand(cmd)

@Composable
fun AppRoot() {
    val ctx = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }
    var settings by remember { mutableStateOf(loadSettings(ctx)) }
    val needsSetup = !settings.demo && settings.i4Ip.isBlank() && settings.cloudHost.isBlank()

    // Ask for notification permission once (Android 13+); harmless if already granted.
    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) { notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS) }

    if (showSettings || needsSetup) {
        SettingsScreen(settings, onSave = { saveSettings(ctx, it); Scheduler.apply(ctx, it); settings = it; showSettings = false }, onClose = { showSettings = false })
    } else {
        MainScreen(settings, onSettings = { showSettings = true })
    }
}

@Composable
fun MainScreen(s: Settings, onSettings: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current
    var door by remember { mutableStateOf<DoorStatus?>(null) }
    var mode by remember { mutableStateOf(ConnectionMode.OFFLINE) }
    var log by remember { mutableStateOf(listOf<ConnectionUi.LogEntry>()) }
    var nowSec by remember { mutableStateOf(System.currentTimeMillis() / 1000) }
    var busy by remember { mutableStateOf(false) }
    val demo = remember { DemoEngine() }   // demo simulation — zero real comms

    LaunchedEffect(s) {
        if (s.demo) {
            // Fully local simulation: tick the engine, never touch the network — but DO drive the real
            // on-device notifications/alarms from the simulated state (so the notif path is testable).
            while (true) {
                val now = System.currentTimeMillis()
                val d = demo.door(now)
                door = d
                val m = demo.modeAt(now)
                if (m != mode) log = ConnectionUi.pushIfChanged(log, m, hhmm())
                mode = m
                nowSec = now / 1000
                val openSec = if (d.since in 1L until nowSec) nowSec - d.since else 0L
                val cal = java.util.Calendar.getInstance()
                NotifyController.apply(ctx, s, d.state, openSec, cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE), cal.get(java.util.Calendar.DAY_OF_YEAR))
                delay(1000)
            }
        } else {
            lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    val res = withContext(Dispatchers.IO) { poll(s) }
                    door = res.status
                    if (res.mode != mode) log = ConnectionUi.pushIfChanged(log, res.mode, hhmm())
                    mode = res.mode
                    nowSec = System.currentTimeMillis() / 1000
                    delay(5000)
                }
            }
        }
    }
    LaunchedEffect(Unit) { while (true) { nowSec = System.currentTimeMillis() / 1000; delay(1000) } }

    fun send(cmd: String) {
        if (busy) return
        if (s.demo) { val now = System.currentTimeMillis(); demo.command(cmd, now); door = demo.door(now); return }
        scope.launch { busy = true; withContext(Dispatchers.IO) { sendCmd(s, mode, cmd) }; busy = false }
    }

    val state = door?.state
    val actions = ActionModel.actionsFor(state)
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp)) {
        BrandBar(onSettings = onSettings)

        // --- State band (dominant, centred) ---
        Column(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            DoorSchematic(state, Modifier.fillMaxWidth().height(260.dp))
            Spacer(Modifier.height(24.dp))
            Text(
                DoorModel.label(state),
                style = MaterialTheme.typography.displayMedium,
                color = if (DoorModel.isStopped(state)) CautionOrange else MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(6.dp))
            Text(subtext(door, mode, nowSec), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        // --- Action band ---
        if (ActionModel.isSplit(state) && actions.size == 2) {
            SplitActionButton(actions[0], actions[1], enabled = !busy, onCmd = ::send)
        } else {
            NeonActionButton(actions[0], enabled = !busy, onCmd = ::send)
        }

        Spacer(Modifier.height(24.dp))
        val online = mode != ConnectionMode.OFFLINE
        ConnectionFooter(
            headerLabel = ConnectionUi.label(mode),
            online = online,
            freshness = if (online) "live" else "—",
            lines = log.map { "${it.time}  ${ConnectionUi.label(it.mode)}" },
        )
    }
}

/** Mono sub-label under the big state word. */
private fun subtext(door: DoorStatus?, mode: ConnectionMode, nowSec: Long): String {
    val state = door?.state
    return when {
        door == null && mode == ConnectionMode.OFFLINE -> "not connected"
        door == null -> "waiting for device…"
        state == "OPENING" || state == "CLOSING" -> "in motion"
        state == "STOPPED_OPENING" -> "stopped while opening"
        state == "STOPPED_CLOSING" -> "stopped while closing"
        else -> "for " + DoorModel.fmtDur(DoorModel.durationSec(door, nowSec))
    }
}

@Composable
fun SettingsScreen(initial: Settings, onSave: (Settings) -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var i4Ip by remember { mutableStateOf(initial.i4Ip) }
    var s1Ip by remember { mutableStateOf(initial.s1Ip) }
    var monId by remember { mutableStateOf(initial.monId) }
    var ctrlId by remember { mutableStateOf(initial.ctrlId) }
    var localHost by remember { mutableStateOf(initial.localHost) }
    var cloudHost by remember { mutableStateOf(initial.cloudHost) }
    var cloudUser by remember { mutableStateOf(initial.cloudUser) }
    var cloudPass by remember { mutableStateOf(initial.cloudPass) }
    var p12Pass by remember { mutableStateOf(initial.p12Pass) }
    var clientId by remember { mutableStateOf(initial.clientId) }
    var demo by remember { mutableStateOf(initial.demo) }
    var notifyMode by remember { mutableStateOf(initial.notifyMode) }
    var notifyAfterMin by remember { mutableStateOf(initial.notifyAfterMin.toString()) }
    var openAlarmEnabled by remember { mutableStateOf(initial.openAlarmEnabled) }
    var openAlarmMin by remember { mutableStateOf(initial.openAlarmMin.toString()) }
    var timeAlarmEnabled by remember { mutableStateOf(initial.timeAlarmEnabled) }
    var timeAlarm by remember { mutableStateOf(initial.timeAlarm) }
    var note by remember { mutableStateOf("") }

    val pickP12 = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) note = if (copyToFiles(ctx, uri, MqttTls.CLIENT_P12)) "client.p12 imported" else "p12 import failed"
    }
    val pickCa = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) note = if (copyToFiles(ctx, uri, MqttTls.CA_FILE)) "CA cert imported" else "CA import failed"
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column { Text("Demo mode"); Text("Simulated — no devices, no network", style = MaterialTheme.typography.labelSmall) }
            Switch(checked = demo, onCheckedChange = { demo = it })
        }
        Spacer(Modifier.height(12.dp))

        // --- Notifications & alarms (spec 16) ---
        Text("Open-door notification", style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("always" to "Always", "after" to "After min", "off" to "Off").forEach { (v, lbl) ->
                if (notifyMode == v) Button(onClick = { notifyMode = v }) { Text(lbl) }
                else OutlinedButton(onClick = { notifyMode = v }) { Text(lbl) }
            }
        }
        if (notifyMode == "after") field("Notify after (minutes)", notifyAfterMin) { notifyAfterMin = it }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Alarm: open too long")
            Switch(checked = openAlarmEnabled, onCheckedChange = { openAlarmEnabled = it })
        }
        if (openAlarmEnabled) field("Open longer than (minutes)", openAlarmMin) { openAlarmMin = it }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Alarm: open at time of day")
            Switch(checked = timeAlarmEnabled, onCheckedChange = { timeAlarmEnabled = it })
        }
        if (timeAlarmEnabled) field("Time (HH:MM)", timeAlarm) { timeAlarm = it }
        Spacer(Modifier.height(12.dp))

        field("i4 IP (door state)", i4Ip) { i4Ip = it }
        field("S1 IP (relay)", s1Ip) { s1Ip = it }
        field("Monitor id", monId) { monId = it }
        field("Controller id", ctrlId) { ctrlId = it }
        field("Local broker host", localHost) { localHost = it }
        field("Cloud broker host", cloudHost) { cloudHost = it }
        field("Cloud username", cloudUser) { cloudUser = it }
        field("Cloud password", cloudPass, password = true) { cloudPass = it }
        field("Client id (cert CN)", clientId) { clientId = it }
        field("PKCS#12 password", p12Pass, password = true) { p12Pass = it }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { pickP12.launch(arrayOf("*/*")) }) { Text("Import .p12") }
            OutlinedButton(onClick = { pickCa.launch(arrayOf("*/*")) }) { Text("Import CA") }
        }
        if (note.isNotBlank()) { Spacer(Modifier.height(6.dp)); Text(note, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = {
                onSave(Settings(i4Ip.trim(), s1Ip.trim(), monId.trim().ifBlank { "garage-monitor" }, ctrlId.trim().ifBlank { "garage-controller" },
                    localHost.trim(), cloudHost.trim(), cloudUser.trim(), cloudPass, p12Pass, clientId.trim(), demo,
                    notifyMode, notifyAfterMin.toIntOrNull() ?: 5,
                    openAlarmEnabled, openAlarmMin.toIntOrNull() ?: 10,
                    timeAlarmEnabled, timeAlarm.trim()))
            }) { Text("Save") }
            TextButton(onClick = onClose) { Text("Close") }
        }
    }
}

@Composable
private fun field(label: String, value: String, password: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None
    )
}
