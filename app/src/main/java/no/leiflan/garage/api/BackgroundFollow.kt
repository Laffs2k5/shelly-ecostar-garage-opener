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
    const val MAX_MS = 12_000L   // motion-follow window: > one full travel (~8 s) + departure/settle margin
    const val WAIT_MS = 10_000L  // cold-connect grace: how long to keep polling for the FIRST real reading
    const val POLL_MS = 1_000L

    /** True once the door has reached a resting state AFTER we observed it moving — the operation is
     *  complete and there's nothing left to follow. A rest state seen BEFORE any motion is just the
     *  pre-command picture (e.g. still CLOSED during the departure overlap), so [seenMoving] gates it. */
    fun settled(seenMoving: Boolean, state: String?): Boolean = seenMoving && !DoorModel.isMoving(state)

    /** Keep following while still inside the window and not yet settled. */
    fun keepFollowing(elapsedMs: Long, seenMoving: Boolean, state: String?): Boolean =
        elapsedMs < MAX_MS && !settled(seenMoving, state)

    /** Command warm-up: keep polling until ANY real reading lands (or [WAIT_MS] elapses). The motion follow
     *  must start from a warm connection — on a cold broker/cloud wake the first poll(s) read null (the
     *  retained heartbeat hasn't arrived yet); counting those against the follow window above would let a
     *  slow connect eat it and we'd never see the door reach its resting state. Pure (JVM-tested). */
    fun keepWaiting(elapsedMs: Long, gotReading: Boolean): Boolean = elapsedMs < WAIT_MS && !gotReading

    /** Launch-refresh policy: keep polling until we have a RESTING reading to publish (or [WAIT_MS] elapses).
     *  Fixes the old single-poll refresh — on a cold broker/cloud wake that one poll read null (heartbeat not
     *  arrived) and published nothing, leaving the watch stuck on its last-known (often still-moving) state.
     *  A null keeps us waiting; a moving reading keeps us following until the door comes to rest, so the
     *  watch lands on a settled picture. Pure (JVM-tested). */
    fun keepRefreshing(elapsedMs: Long, state: String?): Boolean =
        elapsedMs < WAIT_MS && !(state != null && !DoorModel.isMoving(state))
}
