package no.leiflan.garage.api

import android.content.Context
import no.leiflan.garage.api.DoorModel.DoorStatus
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.MqttCallback
import org.eclipse.paho.client.mqttv3.MqttClient
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import java.io.File
import javax.net.ssl.SSLSocketFactory

/**
 * MQTT transport for the phone (spec 11 §7 broker list with failover), two-device variant:
 *   1. LOCAL broker (Mosquitto, mTLS) — `ssl://<localHost>:8883`, client cert from the imported PKCS#12.
 *   2. CLOUD broker (EMQX Serverless) — `wss://<cloudHost>:8084/mqtt`, username/password.
 *
 * Subscribes to the i4's retained door heartbeat (`devices/<monId>/heartbeat`) and caches the parsed
 * [DoorStatus]; publishes commands to the S1 (`devices/<ctrlId>/command`, QoS 1, **retain=false** — D from
 * the app-creds model). Client-id = the app's identity (CN `garage-app`). Poll-driven reconnect,
 * `isAutomaticReconnect=false` (avoid Doze keepalive churn, NEW-PROJECT-GUIDE §5).
 *
 * Not yet runtime-verified against the broker (pending the `garage-app` cert + on-device test).
 */
object MqttTransport {

    private const val LOCAL_PORT = 8883
    private const val PREFS = "garage_settings"

    @Volatile private var appCtx: Context? = null
    @Volatile private var cloudPolls = 0
    @Volatile private var client: MqttClient? = null

    @Volatile var connectedVia: GarageApi.Broker = GarageApi.Broker.NONE
        private set
    @Volatile var lastDoor: DoorStatus? = null
        private set

    /** Fired on the Paho callback thread whenever a fresh monitor heartbeat lands — lets the UI update the
     *  instant state is PUSHED over the broker/cloud subscription, instead of waiting for the next poll. */
    @Volatile var onUpdate: (() -> Unit)? = null

    val isConnected: Boolean get() = client?.isConnected == true

    fun init(context: Context) { if (appCtx == null) appCtx = context.applicationContext }

    private fun prefs() = appCtx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun pref(key: String, def: String = ""): String =
        prefs()?.getString(key, "")?.takeIf { it.isNotBlank() } ?: def

    private fun clientId(): String = pref("client_id", pref("cloud_user", "garage-app"))
    private fun monId(): String = pref("mon_id", "garage-monitor")
    private fun ctrlId(): String = pref("ctrl_id", "garage-controller")
    private fun localHost(): String = pref("mqtt_local_host")
    private fun cloudHost(): String = pref("mqtt_cloud_host")
    private fun topicHeartbeat() = "devices/${monId()}/heartbeat"
    private fun topicCommand() = "devices/${ctrlId()}/command"

    private fun clientP12(): ByteArray? {
        val ctx = appCtx ?: return null
        val f = File(ctx.filesDir, MqttTls.CLIENT_P12)
        return if (f.exists()) try { f.readBytes() } catch (_: Exception) { null } else null
    }
    private fun p12Password(): CharArray? =
        prefs()?.getString("p12_pass", "")?.takeIf { it.isNotEmpty() }?.toCharArray()

    /** Tear down the connection (used when HTTP-direct takes over → roam up). */
    @Synchronized
    fun disconnect() {
        client?.let {
            try { it.disconnectForcibly(250, 250) } catch (_: Exception) {}
            try { it.close() } catch (_: Exception) {}
        }
        client = null
        connectedVia = GarageApi.Broker.NONE
        cloudPolls = 0
    }

    /** Connect (local mTLS first, then cloud), or roam cloud→local periodically if already connected. */
    @Synchronized
    fun ensureConnected(user: String, pass: String) {
        val c = client
        if (c != null && c.isConnected) {
            if (connectedVia == GarageApi.Broker.CLOUD) {
                cloudPolls++
                if (cloudPolls >= 6) {
                    cloudPolls = 0
                    val ctx0 = appCtx
                    val sf0 = if (ctx0 != null) MqttTls.localSocketFactory(ctx0, clientP12(), p12Password()) else null
                    if (sf0 != null) {
                        val oldCloud = client
                        if (tryConnect("ssl://${localHost()}:$LOCAL_PORT", sf0, null, null, 4)) {
                            connectedVia = GarageApi.Broker.LOCAL
                            if (oldCloud != null && oldCloud !== client) {
                                try { oldCloud.disconnectForcibly(200, 200) } catch (_: Exception) {}
                                try { oldCloud.close() } catch (_: Exception) {}
                            }
                        }
                    }
                }
            }
            return
        }
        if (c != null) { disconnect() }

        val ctx = appCtx
        if (ctx != null && localHost().isNotBlank()) {
            val sf = MqttTls.localSocketFactory(ctx, clientP12(), p12Password())
            if (sf != null && tryConnect("ssl://${localHost()}:$LOCAL_PORT", sf, null, null, 4)) {
                connectedVia = GarageApi.Broker.LOCAL
                return
            }
        }
        if (user.isNotBlank() && pass.isNotBlank() && cloudHost().isNotBlank()) {
            if (tryConnect("wss://${cloudHost()}:8084/mqtt", null, user, pass, 8)) {
                connectedVia = GarageApi.Broker.CLOUD
                return
            }
        }
        connectedVia = GarageApi.Broker.NONE
    }

    private fun tryConnect(uri: String, socketFactory: SSLSocketFactory?, user: String?, pass: String?, timeoutSec: Int): Boolean {
        return try {
            val cli = MqttClient(uri, clientId(), MemoryPersistence())
            cli.setCallback(object : MqttCallback {
                override fun connectionLost(cause: Throwable?) {}
                override fun messageArrived(topic: String, message: MqttMessage) { onMessage(topic, String(message.payload)) }
                override fun deliveryComplete(token: IMqttDeliveryToken?) {}
            })
            val opts = MqttConnectOptions().apply {
                isCleanSession = false
                isAutomaticReconnect = false   // poll-driven reconnect; avoids Doze churn
                connectionTimeout = timeoutSec
                keepAliveInterval = 60
                if (socketFactory != null) this@apply.socketFactory = socketFactory
                if (user != null) userName = user
                if (pass != null) password = pass.toCharArray()
            }
            cli.connect(opts)
            cli.subscribe(topicHeartbeat(), 1)   // retained door state arrives immediately
            client = cli
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun onMessage(topic: String, payload: String) {
        GarageApi.parseHeartbeat(topic, monId(), payload)?.let { lastDoor = it; onUpdate?.invoke() }
    }

    /** Publish open/close/toggle to the controller (QoS 1, non-retained). Returns false if not connected. */
    @Synchronized
    fun publishCommand(cmd: String): Boolean {
        if (!GarageApi.validCmd(cmd)) return false
        val c = client ?: return false
        if (!c.isConnected) return false
        return try {
            c.publish(topicCommand(), MqttMessage(cmd.toByteArray()).apply { qos = 1; isRetained = false })
            true
        } catch (_: Exception) {
            false
        }
    }
}
