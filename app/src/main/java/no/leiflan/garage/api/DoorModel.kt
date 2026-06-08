package no.leiflan.garage.api

/**
 * Pure door display model (no Android deps) — JVM-unit-testable. The 7 states come from the i4
 * (spec 02). JSON parsing lives in [GarageApi] (uses Android's org.json); this is just the value type
 * + presentation helpers so they can be tested without a device.
 */
object DoorModel {

    data class DoorStatus(
        val state: String,
        val dir: String = "",
        val since: Long = 0,
        val ts: Long = 0
    )

    private val LABELS = mapOf(
        "CLOSED" to "Closed",
        "OPEN" to "Open",
        "OPENING" to "Opening…",
        "CLOSING" to "Closing…",
        "STOPPED_OPENING" to "Stopped (opening)",
        "STOPPED_CLOSING" to "Stopped (closing)",
        "UNKNOWN" to "Unknown"
    )

    fun label(state: String?): String = LABELS[state] ?: (state ?: "—")
    fun isMoving(state: String?): Boolean = state == "OPENING" || state == "CLOSING"
    fun isStopped(state: String?): Boolean = state == "STOPPED_OPENING" || state == "STOPPED_CLOSING"

    /** Seconds since the door entered its current state (0 if unknown / clock behind). */
    fun durationSec(door: DoorStatus?, nowSec: Long): Long =
        if (door == null || door.since <= 0 || nowSec < door.since) 0 else nowSec - door.since

    fun fmtDur(sec: Long): String {
        val s = if (sec < 0) 0 else sec
        if (s < 60) return "${s}s"
        val m = s / 60
        if (m < 60) return "${m}m"
        return "${m / 60}h ${m % 60}m"
    }
}
