package no.leiflan.garage

import no.leiflan.garage.api.NotifyRules
import no.leiflan.garage.api.NotifyRules.NotifyMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the pure notification/alarm rules. */
class NotifyRulesTest {

    @Test fun openishStates() {
        assertTrue(NotifyRules.isOpen("OPEN"))
        assertTrue(NotifyRules.isOpen("STOPPED_OPENING"))
        assertTrue(NotifyRules.isOpen("STOPPED_CLOSING"))
        assertFalse(NotifyRules.isOpen("CLOSED"))
        assertFalse(NotifyRules.isOpen("OPENING"))   // transient, excluded
        assertFalse(NotifyRules.isOpen(null))
    }

    @Test fun alwaysModeShowsWhenOpen() {
        assertTrue(NotifyRules.shouldShowOpen(NotifyMode.ALWAYS, "OPEN", 0, 5))
        assertFalse(NotifyRules.shouldShowOpen(NotifyMode.ALWAYS, "CLOSED", 0, 5))
    }

    @Test fun afterMinutesModeWaitsForThreshold() {
        assertFalse(NotifyRules.shouldShowOpen(NotifyMode.AFTER_MINUTES, "OPEN", 4 * 60, 5))
        assertTrue(NotifyRules.shouldShowOpen(NotifyMode.AFTER_MINUTES, "OPEN", 5 * 60, 5))
    }

    @Test fun offModeNeverShows() {
        assertFalse(NotifyRules.shouldShowOpen(NotifyMode.OFF, "OPEN", 99_999, 5))
    }

    @Test fun openTooLongAlarm() {
        assertFalse(NotifyRules.openTooLong(true, "OPEN", 9 * 60, 10))
        assertTrue(NotifyRules.openTooLong(true, "OPEN", 10 * 60, 10))
        assertFalse(NotifyRules.openTooLong(false, "OPEN", 99_999, 10))   // disabled
        assertFalse(NotifyRules.openTooLong(true, "CLOSED", 99_999, 10))  // not open
    }

    @Test fun timeAlarmFiresOncePerDayWhenOpen() {
        // 08:00 = 480 min-of-day
        assertFalse(NotifyRules.timeAlarmDue(true, "OPEN", 479, 480, false))  // before time
        assertTrue(NotifyRules.timeAlarmDue(true, "OPEN", 480, 480, false))   // at time, open, not fired
        assertFalse(NotifyRules.timeAlarmDue(true, "OPEN", 540, 480, true))   // already fired today
        assertFalse(NotifyRules.timeAlarmDue(true, "CLOSED", 540, 480, false)) // closed -> no alert
        assertFalse(NotifyRules.timeAlarmDue(false, "OPEN", 540, 480, false))  // disabled
    }

    @Test fun hhmmParseAndFormat() {
        assertEquals(8 * 60 + 30, NotifyRules.parseHhmm("08:30"))
        assertEquals(-1, NotifyRules.parseHhmm("99:99"))
        assertEquals(-1, NotifyRules.parseHhmm("garbage"))
        assertEquals("08:30", NotifyRules.fmtHhmm(8 * 60 + 30))
        assertEquals("00:05", NotifyRules.fmtHhmm(5))
    }
}
