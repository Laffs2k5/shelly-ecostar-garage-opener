package no.leiflan.garage.api

/**
 * After a backgrounded watch command, [no.leiflan.garage.wear.GarageWearService] must keep the watch's
 * displayed state correct even though the foreground app — the normal heartbeat→DataItem publisher —
 * isn't running. A single poll right after the command is unreliable: over the broker/cloud transport a
 * freshly-opened MQTT connection often hasn't received a heartbeat yet (so the read is OFFLINE/stale), and
 * the door hasn't begun to move anyway. So instead the service FOLLOWS the door for a short window: poll,
 * publish each change, and stop once the door has moved and settled back to rest (or a timeout).
 *
 * This object holds the pure follow policy so it's unit-testable without Android/MQTT; the timing + IO
 * (sleep, poll, publish) live in the service.
 */
object BackgroundFollow {
    const val MAX_MS = 12_000L   // > one full travel (~8 s) + departure/settle margin
    const val POLL_MS = 1_000L

    /** True once the door has reached a resting state AFTER we observed it moving — the operation is
     *  complete and there's nothing left to follow. A rest state seen BEFORE any motion is just the
     *  pre-command picture (e.g. still CLOSED during the departure overlap), so [seenMoving] gates it. */
    fun settled(seenMoving: Boolean, state: String?): Boolean = seenMoving && !DoorModel.isMoving(state)

    /** Keep following while still inside the window and not yet settled. */
    fun keepFollowing(elapsedMs: Long, seenMoving: Boolean, state: String?): Boolean =
        elapsedMs < MAX_MS && !settled(seenMoving, state)
}
