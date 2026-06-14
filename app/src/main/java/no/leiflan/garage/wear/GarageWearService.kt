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
                refresh(ctx, s)
            } else if (GarageApi.validCmd(cmd)) {
                val res = GarageNet.poll(ctx, s)
                GarageNet.sendCommand(s, res.mode, cmd)
                follow(ctx, s)
            }
        } catch (_: Exception) { /* phone offline / no config — nothing to do */ }
    }

    /**
     * Launch refresh (watch sends `refresh` on open): poll until a RESTING reading lands, then publish it —
     * see [BackgroundFollow.keepRefreshing]. The old single poll, on a cold broker/cloud wake, read null
     * (the retained heartbeat hadn't arrived yet) and [WearLink] correctly suppressed that null — so it
     * published nothing and the watch stayed stuck on its last-known (often still-moving) state. Polling
     * keeps the connection alive between reads, so a later poll gets the real state and publishes it.
     */
    private fun refresh(ctx: Context, s: no.leiflan.garage.Settings) {
        var elapsed = 0L
        var lastState: String? = null
        while (true) {
            val res = GarageNet.poll(ctx, s)
            val st = res.status?.state
            if (st != null && st != lastState) { publish(ctx, res); lastState = st }
            elapsed += BackgroundFollow.POLL_MS
            if (!BackgroundFollow.keepRefreshing(elapsed, lastState)) break
            Thread.sleep(BackgroundFollow.POLL_MS)
        }
    }

    /**
     * Follow the door after a command so the watch sees the operation through (the foreground app, which
     * normally republishes heartbeats to the watch, isn't running). Two phases: first WARM UP — wait out a
     * cold broker/cloud connect until the first real reading (null polls here must NOT count against the
     * motion window, or a slow connect eats it and we never see the door reach rest); then FOLLOW — poll
     * once a second, publish each change, and stop as soon as the door has moved and settled (or
     * [BackgroundFollow.MAX_MS] elapses).
     */
    private fun follow(ctx: Context, s: no.leiflan.garage.Settings) {
        var lastState: String? = null
        var elapsed = 0L
        while (BackgroundFollow.keepWaiting(elapsed, lastState != null)) {
            Thread.sleep(BackgroundFollow.POLL_MS)
            elapsed += BackgroundFollow.POLL_MS
            val res = GarageNet.poll(ctx, s)
            val st = res.status?.state
            if (st != null && st != lastState) { publish(ctx, res); lastState = st }
        }
        var seenMoving = DoorModel.isMoving(lastState)
        elapsed = 0L
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
