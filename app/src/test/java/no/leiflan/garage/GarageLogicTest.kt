package no.leiflan.garage

import no.leiflan.garage.api.ConnectionUi
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi
import no.leiflan.garage.api.GarageApi.Broker
import no.leiflan.garage.api.GarageApi.ConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the pure logic (no Android/Paho). Run: ./gradlew testDebugUnitTest */
class GarageLogicTest {

    private fun door(state: String = "OPEN", since: Long = 0) = DoorStatus(state, "", since, 0)

    // --- decide(): HTTP-direct > local broker > cloud > offline ---
    @Test fun httpDirectWins() {
        val r = GarageApi.decide(door("CLOSED"), Broker.CLOUD, door("OPEN"))
        assertEquals(ConnectionMode.HTTP_DIRECT, r.mode)
        assertEquals("CLOSED", r.status?.state)
    }

    @Test fun localBrokerWhenViaLocal() {
        assertEquals(ConnectionMode.LOCAL_BROKER, GarageApi.decide(null, Broker.LOCAL, door()).mode)
    }

    @Test fun cloudWhenViaCloud() {
        assertEquals(ConnectionMode.CLOUD, GarageApi.decide(null, Broker.CLOUD, door()).mode)
    }

    @Test fun offlineWhenNothing() {
        val r = GarageApi.decide(null, Broker.NONE, null)
        assertEquals(ConnectionMode.OFFLINE, r.mode)
        assertNull(r.status)
    }

    @Test fun offlineWhenConnectedButNoDoorYet() {
        assertEquals(ConnectionMode.OFFLINE, GarageApi.decide(null, Broker.LOCAL, null).mode)
    }

    // --- command validation + URL building ---
    @Test fun validCommands() {
        assertTrue(GarageApi.validCmd("open") && GarageApi.validCmd("close") && GarageApi.validCmd("toggle"))
        assertFalse(GarageApi.validCmd("banana"))
    }

    @Test fun urls() {
        assertEquals("http://192.0.2.160/script/1/state", GarageApi.stateUrl("192.0.2.160", 1))
        assertEquals("http://192.0.2.161/script/1/command?cmd=open", GarageApi.commandUrl("192.0.2.161", 1, "open"))
    }

    // --- ConnectionUi ---
    @Test fun labels() {
        assertEquals("Wi-Fi · direct", ConnectionUi.label(ConnectionMode.HTTP_DIRECT))
        assertEquals("Wi-Fi · broker", ConnectionUi.label(ConnectionMode.LOCAL_BROKER))
        assertEquals("Cloud", ConnectionUi.label(ConnectionMode.CLOUD))
        assertEquals("Offline", ConnectionUi.label(ConnectionMode.OFFLINE))
    }

    @Test fun logNewestFirstCappedNoDupes() {
        var log = emptyList<ConnectionUi.LogEntry>()
        log = ConnectionUi.pushIfChanged(log, ConnectionMode.OFFLINE, "t0")
        val same = ConnectionUi.pushIfChanged(log, ConnectionMode.OFFLINE, "t1")
        assertSame(log, same)  // unchanged mode → same list
        log = ConnectionUi.pushIfChanged(log, ConnectionMode.CLOUD, "t2")
        log = ConnectionUi.pushIfChanged(log, ConnectionMode.HTTP_DIRECT, "t3")
        log = ConnectionUi.pushIfChanged(log, ConnectionMode.LOCAL_BROKER, "t4")
        log = ConnectionUi.pushIfChanged(log, ConnectionMode.CLOUD, "t5")
        assertEquals(4, log.size)
        assertEquals(ConnectionMode.CLOUD, log[0].mode)  // newest first
    }

    // --- DoorModel ---
    @Test fun doorLabels() {
        assertEquals("Stopped (closing)", DoorModel.label("STOPPED_CLOSING"))
        assertEquals("Closed", DoorModel.label("CLOSED"))
        assertEquals("WUT", DoorModel.label("WUT"))
        assertTrue(DoorModel.isMoving("OPENING"))
        assertFalse(DoorModel.isMoving("OPEN"))
        assertTrue(DoorModel.isStopped("STOPPED_OPENING"))
    }

    @Test fun duration() {
        assertEquals(60L, DoorModel.durationSec(door("OPEN", since = 100), 160))
        assertEquals(0L, DoorModel.durationSec(door("OPEN", since = 0), 160))
        assertEquals(0L, DoorModel.durationSec(door("OPEN", since = 200), 160)) // clock behind
        assertEquals("45s", DoorModel.fmtDur(45))
        assertEquals("2m", DoorModel.fmtDur(120))
        assertEquals("1h 5m", DoorModel.fmtDur(3900))
    }
}
