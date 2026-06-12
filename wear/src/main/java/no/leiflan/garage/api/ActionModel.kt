package no.leiflan.garage.api

/**
 * Pure mapping from door state to the morphing action button(s) — spec 16. The main screen shows ONE
 * action area whose label+action follow the door state; STOPPED_* is the single exception, shown as a
 * wide button split by a divider into Open ｜ Close. No Android deps → JVM-unit-tested.
 *
 * The button never offers a command the controller would suppress: it maps each state to exactly the
 * useful action(s) (mirrors `pulsesFor` on the device — D-19 / spec 14).
 */
object ActionModel {

    /** PRIMARY = neon cyan (open / close / engage); CAUTION = orange (stop). */
    enum class Tone { PRIMARY, CAUTION }

    /** One labelled action the button can fire. `cmd` is a controller command (open/close/stop/toggle). */
    data class Action(val label: String, val cmd: String, val tone: Tone, val arrow: String = "")

    /**
     * What the action band shows for [state]: one action (full-width button), or two (the STOPPED split
     * pair). UNKNOWN/null → a best-effort "Engage" (toggle), per the fail-open rule (D-19).
     */
    fun actionsFor(state: String?): List<Action> = when (state) {
        "CLOSED" -> listOf(Action("Open", "open", Tone.PRIMARY, "▲"))
        "OPEN" -> listOf(Action("Close", "close", Tone.PRIMARY, "▼"))
        "OPENING", "CLOSING" -> listOf(Action("Stop", "stop", Tone.CAUTION, "■"))
        "STOPPED_OPENING", "STOPPED_CLOSING" -> listOf(
            Action("Open", "open", Tone.PRIMARY, "▲"),
            Action("Close", "close", Tone.PRIMARY, "▼"),
        )
        else -> listOf(Action("Engage", "toggle", Tone.PRIMARY))
    }

    /** True when the action band is the STOPPED split pair (one wide button divided by a divider). */
    fun isSplit(state: String?): Boolean = state == "STOPPED_OPENING" || state == "STOPPED_CLOSING"
}
