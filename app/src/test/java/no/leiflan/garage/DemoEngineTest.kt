package no.leiflan.garage

import no.leiflan.garage.api.DemoEngine
import no.leiflan.garage.api.GarageApi.ConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** JVM unit tests for the demo simulation — pure, no Android/IO. */
class DemoEngineTest {

    @Test fun startsClosed() {
        assertEquals("CLOSED", DemoEngine().door(0).state)
    }

    @Test fun openThenAutoCompletesAfterTravel() {
        val e = DemoEngine(travelMs = 4000)
        e.command("open", 0)
        assertEquals("OPENING", e.door(1000).state)   // mid travel
        assertEquals("OPENING", e.door(3999).state)
        assertEquals("OPEN", e.door(4000).state)       // travel done
        assertEquals("OPEN", e.door(9000).state)       // dwells open
    }

    @Test fun closeFromOpenCompletes() {
        val e = DemoEngine(travelMs = 2000)
        e.command("open", 0); e.door(2000)             // now OPEN
        e.command("close", 2000)
        assertEquals("CLOSING", e.door(2500).state)
        assertEquals("CLOSED", e.door(4000).state)
    }

    @Test fun stopMidTravelYieldsDirectionalStopped() {
        val e = DemoEngine(travelMs = 4000)
        e.command("open", 0)
        e.command("stop", 1500)
        assertEquals("STOPPED_OPENING", e.door(2000).state)
        // from STOPPED, open resumes motion
        e.command("open", 2500)
        assertEquals("OPENING", e.door(3000).state)
    }

    @Test fun stopWhenNotMovingIsNoop() {
        val e = DemoEngine()
        e.command("stop", 0)
        assertEquals("CLOSED", e.door(100).state)
    }

    @Test fun transportRotates() {
        val e = DemoEngine()
        assertEquals(ConnectionMode.HTTP_DIRECT, e.modeAt(0))
        assertEquals(ConnectionMode.LOCAL_BROKER, e.modeAt(15_000))
        assertEquals(ConnectionMode.CLOUD, e.modeAt(30_000))
        assertEquals(ConnectionMode.HTTP_DIRECT, e.modeAt(45_000))
        assertNotEquals(e.modeAt(0), e.modeAt(15_000))
    }
}
