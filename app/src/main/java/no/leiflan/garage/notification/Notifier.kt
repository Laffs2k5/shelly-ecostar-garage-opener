package no.leiflan.garage.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import no.leiflan.garage.MainActivity
import no.leiflan.garage.R

/**
 * Android notification surface for v2 (spec 16). Two channels: a LOW-importance *status* channel for the
 * persistent "door open" notification (silent, ongoing) and a HIGH-importance *alarm* channel for the two
 * alarms (open > X min, open at time-of-day). Decisions live in [no.leiflan.garage.api.NotifyRules].
 */
object Notifier {
    private const val STATUS_CH = "door_status"
    private const val ALARM_CH = "door_alarm"
    private const val OPEN_ID = 101
    private const val ALARM_OPEN_LONG_ID = 102   // "open too long" — its own tray entry
    private const val ALARM_TIME_ID = 103        // "open at time-of-day" — separate, so both can show

    fun createChannels(ctx: Context) {
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(
            NotificationChannel(STATUS_CH, "Door status", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shows while the garage door is open"
            },
        )
        mgr.createNotificationChannel(
            NotificationChannel(ALARM_CH, "Door alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Alerts: open too long, or open at a set time"
            },
        )
    }

    private fun contentIntent(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0,
        Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
        PendingIntent.FLAG_IMMUTABLE,
    )

    /** Persistent "door open" notification — ongoing + silent (no action buttons, per spec 16). */
    fun showOpen(ctx: Context, text: String) {
        val n = NotificationCompat.Builder(ctx, STATUS_CH)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Garage open")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(contentIntent(ctx))
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(OPEN_ID, n)
    }

    fun cancelOpen(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(OPEN_ID)
    }

    /** Dismiss both alarm notifications (e.g. when the door is no longer open). */
    fun cancelAlarms(ctx: Context) {
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        mgr.cancel(ALARM_OPEN_LONG_ID)
        mgr.cancel(ALARM_TIME_ID)
    }

    fun showOpenTooLong(ctx: Context, text: String) = postAlarm(ctx, ALARM_OPEN_LONG_ID, "Garage still open", text)
    fun showTimeAlarm(ctx: Context, text: String) = postAlarm(ctx, ALARM_TIME_ID, "Garage open", text)

    /** A one-off alarm notification (high importance). Distinct [id] per alarm so they coexist in the tray. */
    private fun postAlarm(ctx: Context, id: Int, title: String, text: String) {
        val n = NotificationCompat.Builder(ctx, ALARM_CH)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(contentIntent(ctx))
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}
