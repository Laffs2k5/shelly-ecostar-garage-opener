package no.leiflan.garage.api

import android.content.Context
import no.leiflan.garage.Settings
import no.leiflan.garage.api.GarageApi.ConnectionMode

/**
 * The phone's networking entry point, shared by the foreground UI, the background door-check worker, and
 * the Wear command service (spec 17). Connection priority is HTTP-direct > local broker > cloud > offline
 * (the pure choice lives in [GarageApi.decide]). Kept here so there's ONE implementation.
 */
object GarageNet {

    /** Resolve the door picture + active transport, running with whatever config exists. */
    fun poll(ctx: Context, s: Settings): GarageApi.StatusResult {
        if (s.i4Ip.isNotBlank()) {
            val local = GarageApi.fetchLocalDoor(s.i4Ip)
            if (local != null) {
                MqttTransport.disconnect()
                return GarageApi.decide(local, GarageApi.Broker.NONE, null)
            }
        }
        MqttTransport.init(ctx)
        MqttTransport.ensureConnected(s.cloudUser, s.cloudPass)
        return GarageApi.decide(null, MqttTransport.connectedVia, MqttTransport.lastDoor)
    }

    /** Send a command over the active transport (HTTP-direct to S1, else publish to the broker/cloud). */
    fun sendCommand(s: Settings, mode: ConnectionMode, cmd: String): Boolean =
        if (mode == ConnectionMode.HTTP_DIRECT) GarageApi.sendLocalCommand(s.s1Ip, 1, cmd)
        else MqttTransport.publishCommand(cmd)
}
