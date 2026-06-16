package no.leiflan.garage.complication

import no.leiflan.garage.api.DoorModel

/**
 * Which garage glyph the complication shows. Bar count carries the door position; the service maps
 * each value to a coloured drawable (cyan settled / orange mid-travel / grey unknown).
 */
enum class GarageGlyph { CLOSED, MID, OPEN, UNKNOWN }

/**
 * Pure state -> complication-visual mapping (no Android deps) — JVM-unit-testable, like [DoorModel].
 * [GarageComplicationService] turns the result into an icon resource + tap action; the only reason this
 * is separate is so the mapping can be tested without a device. The DataItem path/keys mirror the phone's
 * [no.leiflan.garage.api] contract (also re-declared in MainActivity — not a shared file).
 */
object ComplicationContent {
    const val STATE_PATH = "/garage/state"
    const val KEY_STATE = "state"
    const val KEY_MODE = "mode"

    /**
     * Map door state (+ connection mode) to a glyph. Per the "group sensibly" decision: OPENING/CLOSING
     * and both STOPPED_* states collapse to [GarageGlyph.MID]; null/UNKNOWN/OFFLINE -> [GarageGlyph.UNKNOWN].
     */
    fun glyphFor(state: String?, mode: String?): GarageGlyph = when {
        state == null || state == "UNKNOWN" || mode == "OFFLINE" -> GarageGlyph.UNKNOWN
        state == "CLOSED" -> GarageGlyph.CLOSED
        state == "OPEN" -> GarageGlyph.OPEN
        DoorModel.isMoving(state) || DoorModel.isStopped(state) -> GarageGlyph.MID
        else -> GarageGlyph.UNKNOWN
    }

    /** Short text for the SHORT_TEXT fallback (e.g. "Closed"/"Open"/"Stopped"); "—" when unlinked. */
    fun labelFor(state: String?): String = if (state == null) "—" else DoorModel.shortLabel(state)
}
