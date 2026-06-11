package no.leiflan.garage.api

/**
 * Pure decision logic for the v2 notifications + alarms (spec 16). No Android deps → JVM-unit-tested.
 * The Android side (channels, posting, WorkManager/AlarmManager) consumes these; demo mode evaluates the
 * exact same rules so the notification path is testable on-phone with no devices.
 *
 * "Open" for notification purposes = the door is not closed and is at rest open-ish: OPEN or a STOPPED_*
 * (partially open, halted). Transient OPENING/CLOSING are excluded so the persistent notification doesn't
 * flicker during travel.
 */
object NotifyRules {

    enum class NotifyMode { ALWAYS, AFTER_MINUTES, OFF }

    fun parseMode(s: String?): NotifyMode = when (s) {
        "always" -> NotifyMode.ALWAYS
        "after" -> NotifyMode.AFTER_MINUTES
        else -> NotifyMode.OFF
    }
    fun modeKey(m: NotifyMode): String = when (m) {
        NotifyMode.ALWAYS -> "always"
        NotifyMode.AFTER_MINUTES -> "after"
        NotifyMode.OFF -> "off"
    }

    fun isOpen(state: String?): Boolean =
        state == "OPEN" || state == "STOPPED_OPENING" || state == "STOPPED_CLOSING"

    /** The persistent "door open" notification: show while open, per [mode] (+ [afterMin] for AFTER_MINUTES). */
    fun shouldShowOpen(mode: NotifyMode, state: String?, openSec: Long, afterMin: Int): Boolean {
        if (!isOpen(state)) return false
        return when (mode) {
            NotifyMode.ALWAYS -> true
            NotifyMode.AFTER_MINUTES -> openSec >= afterMin.toLong() * 60L
            NotifyMode.OFF -> false
        }
    }

    /** "Open > X minutes" alarm — fires once the open duration crosses the threshold. */
    fun openTooLong(enabled: Boolean, state: String?, openSec: Long, thresholdMin: Int): Boolean =
        enabled && isOpen(state) && openSec >= thresholdMin.toLong() * 60L

    /**
     * "Open at time-of-day" alarm — due when the clock has reached [alarmMinOfDay], the door is open, and it
     * hasn't already fired today ([firedToday] is the caller's once-per-day latch). "Still open at/after T".
     */
    fun timeAlarmDue(enabled: Boolean, state: String?, nowMinOfDay: Int, alarmMinOfDay: Int, firedToday: Boolean): Boolean =
        enabled && isOpen(state) && !firedToday && nowMinOfDay >= alarmMinOfDay

    /** Parse "HH:MM" to minute-of-day, or -1 if malformed. */
    fun parseHhmm(s: String?): Int {
        if (s == null) return -1
        val parts = s.split(":")
        if (parts.size != 2) return -1
        val h = parts[0].toIntOrNull() ?: return -1
        val m = parts[1].toIntOrNull() ?: return -1
        if (h !in 0..23 || m !in 0..59) return -1
        return h * 60 + m
    }
    fun fmtHhmm(minOfDay: Int): String {
        val v = ((minOfDay % 1440) + 1440) % 1440
        return "%02d:%02d".format(v / 60, v % 60)
    }
}
