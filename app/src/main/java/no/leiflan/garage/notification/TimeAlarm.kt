package no.leiflan.garage.notification

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import no.leiflan.garage.api.NotifyRules
import no.leiflan.garage.loadSettings
import java.util.Calendar

/**
 * Exact wake for the "open at time-of-day" alarm (spec 16). At the set HH:MM we fire a one-shot door
 * check (the worker reads the door and the rules post the alert iff still open), then reschedule for the
 * next day. Mirrors the coffee app's ScheduleAlarmManager/Receiver.
 */
object TimeAlarm {
    private const val REQ = 2001

    fun schedule(ctx: Context, hhmm: String) {
        val min = NotifyRules.parseHhmm(hhmm)
        if (min < 0) return
        val am = ctx.getSystemService(AlarmManager::class.java)
        if (!am.canScheduleExactAlarms()) return
        val pi = pending(ctx)
        am.cancel(pi)
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, min / 60); set(Calendar.MINUTE, min % 60)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        } catch (_: SecurityException) { /* permission gone — won't fire, won't crash */ }
    }

    fun cancel(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java).cancel(pending(ctx))
    }

    private fun pending(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, REQ, Intent(ctx, TimeAlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

/** Fires at the set time: kick a one-shot door check, then reschedule for tomorrow. */
class TimeAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        WorkManager.getInstance(ctx).enqueue(OneTimeWorkRequestBuilder<DoorCheckWorker>().build())
        val s = loadSettings(ctx)
        if (s.timeAlarmEnabled) TimeAlarm.schedule(ctx, s.timeAlarm)
    }
}
