package no.leiflan.garage

import no.leiflan.garage.api.MqttTls
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit tests for the pure mTLS builder. Fixtures are throwaway OpenSSL-generated certs in
 * src/test/resources (test_ca.crt = self-signed P-256 CA, test_client.p12 = client identity signed by
 * it, pass "testpass"). Run: ./gradlew testDebugUnitTest
 */
class MqttTlsTest {

    private fun res(name: String): ByteArray =
        javaClass.getResourceAsStream("/$name")?.readBytes() ?: error("missing test fixture: $name")

    private val ca get() = res("test_ca.crt")
    private val p12 get() = res("test_client.p12")
    private val pass get() = "testpass".toCharArray()

    @Test fun buildsFactoryFromValidCaAndClient() {
        assertNotNull(MqttTls.buildSocketFactory(ca, p12, pass))
    }

    @Test fun nullOnGarbageCa() {
        assertNull(MqttTls.buildSocketFactory("not a certificate".toByteArray(), p12, pass))
    }

    @Test fun nullOnEmptyCa() {
        assertNull(MqttTls.buildSocketFactory(ByteArray(0), p12, pass))
    }

    @Test fun nullOnWrongP12Password() {
        assertNull(MqttTls.buildSocketFactory(ca, p12, "wrongpass".toCharArray()))
    }

    @Test fun nullOnGarbageP12() {
        assertNull(MqttTls.buildSocketFactory(ca, "not a p12".toByteArray(), pass))
    }
}
