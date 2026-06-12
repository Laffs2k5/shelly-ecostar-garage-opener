package no.leiflan.garage.wear

import android.content.Context
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import no.leiflan.garage.api.BackgroundFollow
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.GarageApi
import no.leiflan.garage.api.GarageNet
import no.leiflan.garage.loadSettings

/**
 * Receives watch commands even when the phone app is backgrounded/closed (spec 17, Phase 2b). The system
 * binds this service when a `/garage/cmd` message arrives. It runs REAL commands through the shared
 * [GarageNet] path and republishes door state so the watch updates. Demo is foreground-only (the demo
 * "brain" lives in the Activity), so demo messages are ignored here — the Activity handles those —
 * preventing double-execution when both receive the same message.
 *
 * `onMessageReceived` is invoked on a background thread, so the blocking network calls here are fine.
 */
class GarageWearService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearLink.CMD_PATH) return
        val ctx = applicationContext
        val s = loadSettings(ctx)
        if (s.demo) return

        val cmd = String(event.data)
        try {
            if (cmd == "refresh") {
                publish(ctx, GarageNet.poll(ctx, s))
            } else if (GarageApi.validCmd(cmd)) {
                val res = GarageNet.poll(ctx, s)
                GarageNet.sendCommand(s, res.mode, cmd)
                follow(ctx, s)
            }
        } catch (_: Exception) { /* phone offline / no config — nothing to do */ }
    }

    /**
     * Follow the door after a command so the watch sees the operation through (the foreground app, which
     * normally republishes heartbeats to the watch, isn't running). Poll once a second; publish on every
     * change; stop as soon as the door has moved and settled (or [BackgroundFollow.MAX_MS] elapses). This
     * also gives a freshly-opened broker/cloud connection time to actually receive heartbeats — the old
     * single 1.5 s read often fired before any arrived, leaving the watch stuck on its last-known state.
     */
    private fun follow(ctx: Context, s: no.leiflan.garage.Settings) {
        var seenMoving = false
        var elapsed = 0L
        var lastState: String? = null
        while (BackgroundFollow.keepFollowing(elapsed, seenMoving, lastState)) {
            Thread.sleep(BackgroundFollow.POLL_MS)
            elapsed += BackgroundFollow.POLL_MS
            val res = GarageNet.poll(ctx, s)
            val st = res.status?.state ?: continue
            if (DoorModel.isMoving(st)) seenMoving = true
            if (st != lastState) { publish(ctx, res); lastState = st }
        }
    }

    private fun publish(ctx: Context, res: GarageApi.StatusResult) {
        val d = res.status
        WearLink.publishIfChanged(ctx, d?.state, d?.dir ?: "", d?.since ?: 0L, res.mode.name, false)
    }
}
