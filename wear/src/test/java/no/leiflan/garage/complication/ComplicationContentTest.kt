package no.leiflan.garage.complication

import org.junit.Assert.assertEquals
import org.junit.Test

/** Covers the pure state -> complication-glyph/label mapping (spec 17). No Android deps. */
class ComplicationContentTest {

    @Test fun closed_state_shows_closed_glyph() {
        assertEquals(GarageGlyph.CLOSED, ComplicationContent.glyphFor("CLOSED", "HTTP_DIRECT"))
    }

    @Test fun open_state_shows_open_glyph() {
        assertEquals(GarageGlyph.OPEN, ComplicationContent.glyphFor("OPEN", "LOCAL_BROKER"))
    }

    @Test fun moving_states_collapse_to_mid() {
        assertEquals(GarageGlyph.MID, ComplicationContent.glyphFor("OPENING", "CLOUD"))
        assertEquals(GarageGlyph.MID, ComplicationContent.glyphFor("CLOSING", "CLOUD"))
    }

    @Test fun stopped_states_collapse_to_mid() {
        assertEquals(GarageGlyph.MID, ComplicationContent.glyphFor("STOPPED_OPENING", "HTTP_DIRECT"))
        assertEquals(GarageGlyph.MID, ComplicationContent.glyphFor("STOPPED_CLOSING", "HTTP_DIRECT"))
    }

    @Test fun unknown_null_and_offline_show_unknown_glyph() {
        assertEquals(GarageGlyph.UNKNOWN, ComplicationContent.glyphFor("UNKNOWN", "HTTP_DIRECT"))
        assertEquals(GarageGlyph.UNKNOWN, ComplicationContent.glyphFor(null, null))
        // Offline outranks a known state — the live picture is stale, so don't imply it's settled.
        assertEquals(GarageGlyph.UNKNOWN, ComplicationContent.glyphFor("CLOSED", "OFFLINE"))
    }

    @Test fun label_falls_back_to_dash_when_unlinked() {
        assertEquals("—", ComplicationContent.labelFor(null))
    }

    @Test fun label_uses_door_model_short_labels() {
        assertEquals("Closed", ComplicationContent.labelFor("CLOSED"))
        assertEquals("Open", ComplicationContent.labelFor("OPEN"))
        assertEquals("Stopped", ComplicationContent.labelFor("STOPPED_OPENING"))
    }
}
