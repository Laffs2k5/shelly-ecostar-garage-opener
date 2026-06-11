package no.leiflan.garage.notification

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import no.leiflan.garage.Settings
import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi
import no.leiflan.garage.api.MqttTransport
import no.leiflan.garage.loadSettings
import java.util.Calendar

/**
 * Background door check (spec 16 periodic-wake model): connect, read the door (HTTP-direct on the LAN,
 * else the retained broker heartbeat), evaluate the notification/alarm rules, post/cancel — then
 * disconnect. NOT an always-on service: WorkManager schedules this ~every 15 min, and the time-of-day
 * exact alarm enqueues a one-shot. Demo mode is handled in-app, so the worker no-ops when demo is on.
 */
class DoorCheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val s = loadSettings(applicationContext)
        if (s.demo) return Result.success()
        val door = readDoor(s)
        val nowSec = System.currentTimeMillis() / 1000
        val openSec = if (door != null && door.since in 1L until nowSec) nowSec - door.since else 0L
        val cal = Calendar.getInstance()
        val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val today = cal.get(Calendar.DAY_OF_YEAR)
        NotifyController.apply(applicationContext, s, door?.state, openSec, nowMin, today)
        return Result.success()
    }

    private suspend fun readDoor(s: Settings): DoorStatus? = withContext(Dispatchers.IO) {
        if (s.i4Ip.isNotBlank()) {
            GarageApi.fetchLocalDoor(s.i4Ip)?.let { return@withContext it }
        }
        MqttTransport.init(applicationContext)
        MqttTransport.ensureConnected(s.cloudUser, s.cloudPass)
        delay(3000)                       // let the retained heartbeat arrive
        val d = MqttTransport.lastDoor
        MqttTransport.disconnect()
        d
    }
}
