package no.leiflan.garage.notification

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import no.leiflan.garage.Settings
import no.leiflan.garage.api.NotifyRules
import java.util.concurrent.TimeUnit

/**
 * Enables/disables the background work to match settings. Periodic check runs when notifications or the
 * open-too-long alarm are on (and not in demo); the time-of-day alarm uses an exact AlarmManager wake.
 * Call on app start and whenever settings are saved.
 */
object Scheduler {
    private const val WORK = "door_check"

    fun apply(ctx: Context, s: Settings) {
        val wm = WorkManager.getInstance(ctx)
        val wantPeriodic = !s.demo &&
            (NotifyRules.parseMode(s.notifyMode) != NotifyRules.NotifyMode.OFF || s.openAlarmEnabled)
        if (wantPeriodic) {
            val req = PeriodicWorkRequestBuilder<DoorCheckWorker>(15, TimeUnit.MINUTES).build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
        } else {
            wm.cancelUniqueWork(WORK)
        }
        if (!s.demo && s.timeAlarmEnabled) TimeAlarm.schedule(ctx, s.timeAlarm) else TimeAlarm.cancel(ctx)
    }
}
