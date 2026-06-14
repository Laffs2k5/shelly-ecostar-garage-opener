package no.leiflan.garage

import no.leiflan.garage.api.ConnectionUi
import no.leiflan.garage.api.DoorModel
import no.leiflan.garage.api.DoorModel.DoorStatus
import no.leiflan.garage.api.GarageApi
import no.leiflan.garage.api.GarageApi.Broker
import no.leiflan.garage.api.GarageApi.ConnectionMode
import no.leiflan.garage.api.resolveClientId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the pure logic (no Android/Paho). Run: ./gradlew testDebugUnitTest */
class GarageLogicTest {

    private fun door(state: String = "OPEN", since: Long = 0) = DoorStatus(state, "", since, 0)

    // --- resolveClientId(): client_id pref > cloud_user pref > generic fallback (B2 scrub regression guard) ---
    @Test fun clientIdPrefersExplicitThenCloudUserThenFallback() {
        assertEquals("ci", resolveClientId("ci", "cu", "fb"))   // explicit client_id wins
        assertEquals("cu", resolveClientId("", "cu", "fb"))     // else cloud_user
        assertEquals("fb", resolveClientId("", "", "fb"))       // else fallback
        assertEquals("cu", resolveClientId("   ", "cu", "fb"))  // blank client_id ignored
        assertEquals("garage-app", resolveClientId("", ""))     // default fallback is the generic id (not a name)
    }

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
        assertTrue(GarageApi.validCmd("stop"))   // safety stop (spec 14)
        assertFalse(GarageApi.validCmd("banana"))
    }

    // --- ActionModel: morphing button + STOPPED split pair (spec 16) ---
    @Test fun actionClosedOffersOpen() {
        val a = no.leiflan.garage.api.ActionModel.actionsFor("CLOSED")
        assertEquals(1, a.size); assertEquals("open", a[0].cmd)
        assertEquals(no.leiflan.garage.api.ActionModel.Tone.PRIMARY, a[0].tone)
    }
    @Test fun actionOpenOffersClose() {
        val a = no.leiflan.garage.api.ActionModel.actionsFor("OPEN")
        assertEquals(1, a.size); assertEquals("close", a[0].cmd)
    }
    @Test fun actionMovingOffersStopInCaution() {
        for (s in listOf("OPENING", "CLOSING")) {
            val a = no.leiflan.garage.api.ActionModel.actionsFor(s)
            assertEquals(1, a.size); assertEquals("stop", a[0].cmd)
            assertEquals(no.leiflan.garage.api.ActionModel.Tone.CAUTION, a[0].tone)
        }
    }
    @Test fun actionStoppedIsSplitOpenClose() {
        for (s in listOf("STOPPED_OPENING", "STOPPED_CLOSING")) {
            assertTrue(no.leiflan.garage.api.ActionModel.isSplit(s))
            val a = no.leiflan.garage.api.ActionModel.actionsFor(s)
            assertEquals(2, a.size)
            assertEquals(listOf("open", "close"), a.map { it.cmd })
        }
    }
    @Test fun actionUnknownIsBestEffortToggle() {
        val a = no.leiflan.garage.api.ActionModel.actionsFor(null)
        assertEquals(1, a.size); assertEquals("toggle", a[0].cmd)
        assertFalse(no.leiflan.garage.api.ActionModel.isSplit("UNKNOWN"))
    }

    @Test fun heartbeatTopicAndParse() {
        assertEquals("devices/garage-monitor/heartbeat", GarageApi.heartbeatTopic("garage-monitor"))
        val d = GarageApi.parseHeartbeat("devices/garage-monitor/heartbeat", "garage-monitor", "{\"state\":\"OPENING\",\"since\":5}")
        assertEquals("OPENING", d?.state)
        // wrong topic -> ignored (the push path must only react to OUR monitor's heartbeat)
        assertNull(GarageApi.parseHeartbeat("devices/other/heartbeat", "garage-monitor", "{\"state\":\"OPEN\"}"))
        // bad payload -> null (no crash)
        assertNull(GarageApi.parseHeartbeat("devices/garage-monitor/heartbeat", "garage-monitor", "garbage"))
    }

    @Test fun staleHeartbeatDetection() {
        assertTrue(GarageApi.isStale(5, 10))      // older than last -> stale, drop
        assertFalse(GarageApi.isStale(10, 10))    // same second -> apply
        assertFalse(GarageApi.isStale(11, 10))    // newer -> apply
        assertFalse(GarageApi.isStale(0, 10))     // missing ts -> never stale
        assertFalse(GarageApi.isStale(5, 0))      // no baseline yet -> apply
    }

    // --- BackgroundFollow: the watch-service post-command follow policy ---
    @Test fun followNotSettledUntilMovementSeen() {
        // pre-command rest state (still CLOSED during departure) must NOT end the follow
        assertFalse(no.leiflan.garage.api.BackgroundFollow.settled(false, "CLOSED"))
        assertFalse(no.leiflan.garage.api.BackgroundFollow.settled(false, "OPENING"))
        // while moving, never settled
        assertFalse(no.leiflan.garage.api.BackgroundFollow.settled(true, "OPENING"))
        assertFalse(no.leiflan.garage.api.BackgroundFollow.settled(true, "CLOSING"))
    }

    @Test fun followSettlesOnceMovedThenAtRest() {
        assertTrue(no.leiflan.garage.api.BackgroundFollow.settled(true, "OPEN"))
        assertTrue(no.leiflan.garage.api.BackgroundFollow.settled(true, "CLOSED"))
        // a stop command: moving -> STOPPED_* is a resting end state
        assertTrue(no.leiflan.garage.api.BackgroundFollow.settled(true, "STOPPED_OPENING"))
        assertTrue(no.leiflan.garage.api.BackgroundFollow.settled(true, "STOPPED_CLOSING"))
    }

    @Test fun followLoopStartsContinuesAndStops() {
        val f = no.leiflan.garage.api.BackgroundFollow
        assertTrue(f.keepFollowing(0, false, null))            // start: nothing yet -> follow
        assertTrue(f.keepFollowing(2000, false, "CLOSED"))     // departure overlap, still in window
        assertTrue(f.keepFollowing(3000, true, "OPENING"))     // moving -> keep
        assertFalse(f.keepFollowing(4000, true, "OPEN"))       // moved + at rest -> stop
        assertFalse(f.keepFollowing(f.MAX_MS, false, "OPENING")) // timeout caps a door that never settles
    }

    @Test fun commandWarmUpWaitsForFirstReadingThenStops() {
        val f = no.leiflan.garage.api.BackgroundFollow
        assertTrue(f.keepWaiting(0, false))           // cold connect, no reading yet -> keep polling
        assertTrue(f.keepWaiting(3000, false))        // still none, in window -> keep
        assertFalse(f.keepWaiting(0, true))           // first reading landed -> warm-up done
        assertFalse(f.keepWaiting(f.WAIT_MS, false))  // grace cap: give up even if nothing ever answers
    }

    @Test fun refreshWaitsThroughNullAndMotionUntilRest() {
        val f = no.leiflan.garage.api.BackgroundFollow
        assertTrue(f.keepRefreshing(0, null))                   // cold connect, null read -> keep polling
        assertTrue(f.keepRefreshing(2000, "OPENING"))           // moving -> follow until it rests
        assertTrue(f.keepRefreshing(2000, "CLOSING"))
        assertFalse(f.keepRefreshing(2000, "OPEN"))             // resting reading -> publish + stop
        assertFalse(f.keepRefreshing(2000, "CLOSED"))
        assertFalse(f.keepRefreshing(2000, "STOPPED_OPENING"))  // a stopped state is at rest -> stop
        assertFalse(f.keepRefreshing(2000, "STOPPED_CLOSING"))
        assertFalse(f.keepRefreshing(f.WAIT_MS, null))          // grace cap: stop rather than spin forever
    }

    @Test fun wearPublishSkipsNullStateNotRealUnknown() {
        // a null/blank reading must NOT clobber the watch's known state with a bogus "Unknown"
        assertFalse(no.leiflan.garage.wear.WearLink.shouldPublish(null))
        assertFalse(no.leiflan.garage.wear.WearLink.shouldPublish(""))
        assertFalse(no.leiflan.garage.wear.WearLink.shouldPublish("   "))
        // a real i4 state — including the literal UNKNOWN door state — still publishes
        assertTrue(no.leiflan.garage.wear.WearLink.shouldPublish("UNKNOWN"))
        assertTrue(no.leiflan.garage.wear.WearLink.shouldPublish("OPENING"))
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

    @Test fun shortLabelDropsParenthetical() {
        assertEquals("Stopped", DoorModel.shortLabel("STOPPED_OPENING"))
        assertEquals("Stopped", DoorModel.shortLabel("STOPPED_CLOSING"))
        assertEquals("Opening…", DoorModel.shortLabel("OPENING"))  // unchanged
        assertEquals("Closed", DoorModel.shortLabel("CLOSED"))
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
