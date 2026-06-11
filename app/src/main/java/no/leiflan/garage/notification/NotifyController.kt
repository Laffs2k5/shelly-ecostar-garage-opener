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

        // 2) open > X minutes — once per open episode (latch clears when the door is no longer open)
        if (!open) {
            prefs.edit().putBoolean("open_fired", false).apply()
        } else if (NotifyRules.openTooLong(s.openAlarmEnabled, state, openSec, s.openAlarmMin) &&
            !prefs.getBoolean("open_fired", false)
        ) {
            Notifier.showAlarm(ctx, "Garage still open", "Open over ${s.openAlarmMin} min")
            prefs.edit().putBoolean("open_fired", true).apply()
        }

        // 3) open at time-of-day — once per day
        val alarmMin = NotifyRules.parseHhmm(s.timeAlarm)
        if (alarmMin >= 0) {
            val firedToday = prefs.getInt("time_fired_day", -1) == today
            if (NotifyRules.timeAlarmDue(s.timeAlarmEnabled, state, nowMinOfDay, alarmMin, firedToday)) {
                Notifier.showAlarm(ctx, "Garage open", "Still open at ${s.timeAlarm}")
                prefs.edit().putInt("time_fired_day", today).apply()
            }
        }
    }
}
