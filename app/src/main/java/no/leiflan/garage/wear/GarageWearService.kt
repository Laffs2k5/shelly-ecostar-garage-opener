package no.leiflan.garage.wear

import android.content.Context
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
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
                Thread.sleep(1500)                      // let the door begin to move
                publish(ctx, GarageNet.poll(ctx, s))
            }
        } catch (_: Exception) { /* phone offline / no config — nothing to do */ }
    }

    private fun publish(ctx: Context, res: GarageApi.StatusResult) {
        val d = res.status
        WearLink.publishIfChanged(ctx, d?.state, d?.dir ?: "", d?.since ?: 0L, res.mode.name, false)
    }
}
