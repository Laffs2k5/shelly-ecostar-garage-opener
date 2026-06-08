package no.leiflan.garage.api

import android.content.Context
import java.io.File
import java.security.KeyStore
import java.security.cert.CertificateFactory
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

/**
 * mTLS material for the LAN broker (spec 11). Both artifacts are **imported at runtime** (Settings) and
 * kept in app-internal storage — nothing identity-specific is bundled in the APK/repo (D-06):
 * - Trust anchor: the private CA's *public* cert (PEM/DER) → `filesDir/mqtt_ca.crt`.
 * - Client identity: the app's cert+key as PKCS#12 (CN `garage-app`) → `filesDir/client.p12`.
 *
 * Mosquitto uses `use_identity_as_username`, so the client cert CN is the broker identity — no password.
 */
object MqttTls {

    const val CA_FILE = "mqtt_ca.crt"
    const val CLIENT_P12 = "client.p12"

    fun hasCaCert(context: Context): Boolean =
        File(context.filesDir, CA_FILE).let { it.exists() && it.length() > 0 }

    /** mTLS factory from imported CA + client identity, or null if missing/invalid (→ fall back to cloud). */
    fun localSocketFactory(context: Context, p12: ByteArray?, password: CharArray?): SSLSocketFactory? {
        if (p12 == null || p12.isEmpty() || password == null) return null
        val caFile = File(context.filesDir, CA_FILE)
        if (!caFile.exists() || caFile.length() == 0L) return null
        val caPem = try { caFile.readBytes() } catch (_: Exception) { return null }
        return buildSocketFactory(caPem, p12, password)
    }

    /**
     * Pure construction (no Android deps) — JVM-unit-testable. Returns null on any bad input instead of
     * throwing. `caPem` = CA public cert (PEM or DER); `p12`/`password` = the client PKCS#12.
     */
    fun buildSocketFactory(caPem: ByteArray, p12: ByteArray, password: CharArray): SSLSocketFactory? {
        return try {
            val cf = CertificateFactory.getInstance("X.509")
            val ca = caPem.inputStream().use { cf.generateCertificate(it) }
            val trustStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
                load(null, null)
                setCertificateEntry("mqtt-ca", ca)
            }
            val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            tmf.init(trustStore)

            val clientStore = KeyStore.getInstance("PKCS12")
            p12.inputStream().use { clientStore.load(it, password) }
            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
            kmf.init(clientStore, password)

            val ctx = SSLContext.getInstance("TLSv1.2")
            ctx.init(kmf.keyManagers, tmf.trustManagers, null)
            ctx.socketFactory
        } catch (_: Exception) {
            null
        }
    }
}
