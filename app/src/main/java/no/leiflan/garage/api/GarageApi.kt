package no.leiflan.garage.api

import no.leiflan.garage.api.DoorModel.DoorStatus
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Control logic for the two-device design (spec 01):
 *  - **door state** is read from the i4 (`garage-monitor`) — HTTP `/state` direct, or its MQTT heartbeat.
 *  - **commands** go to the S1 (`garage-controller`) — HTTP `/command`, or its MQTT command topic.
 *
 * [decide] is pure (JVM-unit-tested). The HTTP-direct calls + JSON parse use Android (`HttpURLConnection`,
 * `org.json`) and are exercised on-device. The MQTT path lives in MqttTransport (added next).
 */
object GarageApi {

    enum class Broker { NONE, LOCAL, CLOUD }
    enum class ConnectionMode { HTTP_DIRECT, LOCAL_BROKER, CLOUD, OFFLINE }
    data class StatusResult(val status: DoorStatus?, val mode: ConnectionMode)

    val VALID = listOf("open", "close", "toggle", "stop")
    fun validCmd(cmd: String): Boolean = VALID.contains(cmd)

    /**
     * Connection priority (NEW-PROJECT-GUIDE §5): HTTP-direct (i4 on the LAN) > local broker > cloud >
     * offline. `local` is the door read directly from the i4; `mqttDoor` is the last door from whichever
     * broker we're on (`mqttVia`). Pure — no I/O.
     */
    fun decide(local: DoorStatus?, mqttVia: Broker, mqttDoor: DoorStatus?): StatusResult {
        if (local != null) return StatusResult(local, ConnectionMode.HTTP_DIRECT)
        if (mqttDoor != null) when (mqttVia) {
            Broker.LOCAL -> return StatusResult(mqttDoor, ConnectionMode.LOCAL_BROKER)
            Broker.CLOUD -> return StatusResult(mqttDoor, ConnectionMode.CLOUD)
            Broker.NONE -> {}
        }
        return StatusResult(null, ConnectionMode.OFFLINE)
    }

    // ---- HTTP-direct (per-device IP) ----
    fun stateUrl(i4Ip: String, scriptId: Int = 1) = "http://$i4Ip/script/$scriptId/state"
    fun commandUrl(s1Ip: String, scriptId: Int, cmd: String) = "http://$s1Ip/script/$scriptId/command?cmd=$cmd"

    fun heartbeatTopic(monitorId: String) = "devices/$monitorId/heartbeat"

    /** True if [incomingTs] is OLDER than [lastTs] (both i4 unixtimes) — i.e. an out-of-order/stale
     *  heartbeat that should be ignored so the UI never regresses to a past state. ts==0 (missing) is never
     *  stale. Matters on the broker/cloud path where heartbeats are QoS 0 (unordered). Pure (JVM-tested). */
    fun isStale(incomingTs: Long, lastTs: Long): Boolean = incomingTs in 1 until lastTs

    /** Parse an incoming MQTT message IFF it's the monitor's heartbeat — else null. Drives the event-driven
     *  (push) UI update on the broker/cloud path. Pure (JVM-tested). */
    fun parseHeartbeat(topic: String, monitorId: String, payload: String?): DoorStatus? =
        if (topic == heartbeatTopic(monitorId)) parseDoor(payload) else null

    /** Parse an i4 `/state` (or heartbeat) JSON body into a door picture, or null. */
    fun parseDoor(json: String?): DoorStatus? {
        if (json.isNullOrBlank()) return null
        return try {
            val o = JSONObject(json)
            val st = o.optString("state", "")
            if (st.isEmpty()) null
            else DoorStatus(st, o.optString("dir", ""), o.optLong("since", 0L), o.optLong("ts", 0L))
        } catch (_: Exception) {
            null
        }
    }

    // HTTP-direct probe retry: the i4 (WiFi power-saving + often weak signal) can miss the FIRST cold contact
    // — its modem-sleep drops the packet and the phone's ARP entry has aged — so a single 2 s probe loses the
    // race and the app falls back to the broker. One quick retry, after the in-flight ARP/wake completes,
    // usually lands and lets HTTP-direct latch on a cold open instead of needing warm-up traffic first.
    const val LOCAL_PROBE_ATTEMPTS = 2
    const val LOCAL_PROBE_RETRY_MS = 500L

    /** Run [probe] up to [attempts] times, returning the first non-null result, sleeping [retryMs] between
     *  tries. [sleep] is injectable so the retry policy is JVM-unit-testable without real delays. */
    internal fun retryProbe(
        attempts: Int = LOCAL_PROBE_ATTEMPTS,
        retryMs: Long = LOCAL_PROBE_RETRY_MS,
        sleep: (Long) -> Unit = { Thread.sleep(it) },
        probe: () -> DoorStatus?,
    ): DoorStatus? {
        var i = 0
        while (true) {
            probe()?.let { return it }
            if (++i >= attempts) return null
            sleep(retryMs)
        }
    }

    /** GET the i4's `/state` (2 s timeouts), retrying once on a cold miss (see [retryProbe]). Null on
     *  repeated failure → roam down to the broker. */
    fun fetchLocalDoor(i4Ip: String, scriptId: Int = 1): DoorStatus? {
        if (i4Ip.isBlank()) return null
        return retryProbe {
            try {
                val c = (URL(stateUrl(i4Ip, scriptId)).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 2000; readTimeout = 2000; requestMethod = "GET"
                }
                val body = c.inputStream.bufferedReader().use { it.readText() }
                c.disconnect()
                parseDoor(body)
            } catch (_: Exception) {
                null
            }
        }
    }

    /** GET the S1's `/command?cmd=…` (2 s). Returns true on HTTP 200. */
    fun sendLocalCommand(s1Ip: String, scriptId: Int, cmd: String): Boolean {
        if (s1Ip.isBlank() || !validCmd(cmd)) return false
        return try {
            val c = (URL(commandUrl(s1Ip, scriptId, cmd)).openConnection() as HttpURLConnection).apply {
                connectTimeout = 2000; readTimeout = 2000; requestMethod = "GET"
            }
            val ok = c.responseCode == 200
            c.disconnect()
            ok
        } catch (_: Exception) {
            false
        }
    }
}
