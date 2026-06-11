package no.leiflan.garage.api

import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi.ConnectionMode

/**
 * Demo mode (spec 16): a fully self-contained door simulation so the whole UI — states, fake travel,
 * the morphing/split button, the connection footer, and (later) on-device notifications/alarms — can be
 * exercised with **zero real communication**. No Android deps, no I/O → JVM-unit-tested.
 *
 * Time-driven and deterministic: the caller passes `nowMs` to [door] each tick and to [command] on a tap.
 * Commands mutate the sim the way the real opener would; motion auto-completes after [travelMs].
 */
class DemoEngine(private val travelMs: Long = 4000L) {

    private var state = "CLOSED"
    private var phaseStartMs = 0L

    private val modes = listOf(ConnectionMode.HTTP_DIRECT, ConnectionMode.LOCAL_BROKER, ConnectionMode.CLOUD)

    /** Rotate the transport every ~15 s so the connection footer/history is exercised. */
    fun modeAt(nowMs: Long): ConnectionMode = modes[((nowMs / 15000L) % modes.size).toInt()]

    /** Advance any in-flight motion, then return the current door picture (`since` in seconds). */
    fun door(nowMs: Long): DoorStatus {
        advance(nowMs)
        val dir = when (state) { "OPENING" -> "opening"; "CLOSING" -> "closing"; else -> "" }
        return DoorStatus(state, dir, phaseStartMs / 1000L, nowMs / 1000L)
    }

    fun state(): String = state

    private fun advance(nowMs: Long) {
        val elapsed = nowMs - phaseStartMs
        when (state) {
            "OPENING" -> if (elapsed >= travelMs) enter("OPEN", nowMs)
            "CLOSING" -> if (elapsed >= travelMs) enter("CLOSED", nowMs)
        }
    }

    private fun enter(s: String, nowMs: Long) { state = s; phaseStartMs = nowMs }

    /** Apply a tapped command, mirroring the real opener's response. Unknown/no-op commands are ignored. */
    fun command(cmd: String, nowMs: Long) {
        when (cmd) {
            "open" -> if (state == "CLOSED" || state == "STOPPED_OPENING" || state == "STOPPED_CLOSING") enter("OPENING", nowMs)
            "close" -> if (state == "OPEN" || state == "STOPPED_OPENING" || state == "STOPPED_CLOSING") enter("CLOSING", nowMs)
            "stop" -> when (state) {
                "OPENING" -> enter("STOPPED_OPENING", nowMs)
                "CLOSING" -> enter("STOPPED_CLOSING", nowMs)
            }
            "toggle" -> when (state) {
                "CLOSED" -> enter("OPENING", nowMs)
                "OPEN" -> enter("CLOSING", nowMs)
                "OPENING" -> enter("STOPPED_OPENING", nowMs)
                "CLOSING" -> enter("STOPPED_CLOSING", nowMs)
                else -> enter("OPENING", nowMs)   // from a stopped state, best-effort
            }
        }
    }
}
