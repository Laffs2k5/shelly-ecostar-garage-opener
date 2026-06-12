package no.leiflan.garage.notification

import android.content.Context
import no.leiflan.garage.Settings
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.NotifyRules

/**
 * Applies the [NotifyRules] decisions to the Android [Notifier], managing the once-per-episode /
 * once-per-day latches in prefs. Called from BOTH the foreground demo loop and the background
 * [DoorCheckWorker], so the notification behaviour is identical whether simulated or real.
 */
object NotifyController {
    private const val P = "garage_alarms"

    /**
     * @param state    current door state (or null)
     * @param openSec  seconds the door has been open (for AFTER_MINUTES + open-too-long)
     * @param nowMinOfDay current clock minute-of-day
     * @param today    a day index (e.g. day-of-year) for the time-alarm once-per-day latch
     */
    fun apply(ctx: Context, s: Settings, state: String?, openSec: Long, nowMinOfDay: Int, today: Int) {
        val prefs = ctx.getSharedPreferences(P, Context.MODE_PRIVATE)
        val open = NotifyRules.isOpen(state)

        // 1) persistent "door open" notification
        val mode = NotifyRules.parseMode(s.notifyMode)
        if (NotifyRules.shouldShowOpen(mode, state, openSec, s.notifyAfterMin)) {
            Notifier.showOpen(ctx, "Open for " + DoorModel.fmtDur(openSec))
        } else {
            Notifier.cancelOpen(ctx)
        }

        // 2) open > X minutes — once per open episode (latch clears when the door is no longer open).
        // When the door is no longer open, also dismiss any standing alarm (open-too-long / time-of-day) —
        // closing the door makes the alert moot, so it clears immediately (not 15 min later).
        if (!open) {
            prefs.edit().putBoolean("open_fired", false).apply()
            Notifier.cancelAlarms(ctx)
        } else if (NotifyRules.openTooLong(s.openAlarmEnabled, state, openSec, s.openAlarmMin) &&
            !prefs.getBoolean("open_fired", false)
        ) {
            Notifier.showOpenTooLong(ctx, "Open over ${s.openAlarmMin} min")
            prefs.edit().putBoolean("open_fired", true).apply()
        }

        // 3) open at time-of-day — once per (day + set time). Keying on the time too means changing the
        // alarm time re-arms it the same day (so it's testable, and a new time isn't swallowed).
        val alarmMin = NotifyRules.parseHhmm(s.timeAlarm)
        if (alarmMin >= 0) {
            val key = today * 1440 + alarmMin
            val firedAlready = prefs.getInt("time_fired_key", -1) == key
            if (NotifyRules.timeAlarmDue(s.timeAlarmEnabled, state, nowMinOfDay, alarmMin, firedAlready)) {
                Notifier.showTimeAlarm(ctx, "Still open at ${s.timeAlarm}")
                prefs.edit().putInt("time_fired_key", key).apply()
            }
        }
    }
}
