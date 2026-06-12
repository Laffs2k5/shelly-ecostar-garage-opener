package no.leiflan.garage.wear

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * Phone side of the Wear Data Layer relay (spec 17, Phase 2b). The phone is the brain: it publishes the
 * current door picture as a retained DataItem the watch mirrors, and receives open/close/stop command
 * messages from the watch (handled in MainActivity, which runs them through the same path as the on-phone
 * buttons — real or demo). The watch never does its own networking.
 */
object WearLink {
    const val STATE_PATH = "/garage/state"
    const val CMD_PATH = "/garage/cmd"

    @Volatile private var last = ""

    /** Publish the door picture for the watch — only when it actually changes (DataItems aren't free). */
    fun publishIfChanged(ctx: Context, state: String?, dir: String, since: Long, mode: String, demo: Boolean) {
        val s = state ?: "UNKNOWN"
        val key = "$s|$dir|$since|$mode|$demo"
        if (key == last) return
        last = key
        val req = PutDataMapRequest.create(STATE_PATH).apply {
            dataMap.putString("state", s)
            dataMap.putString("dir", dir)
            dataMap.putLong("since", since)
            dataMap.putString("mode", mode)
            dataMap.putBoolean("demo", demo)
        }.asPutDataRequest().setUrgent()
        try {
            Wearable.getDataClient(ctx).putDataItem(req)
        } catch (_: Exception) { /* no watch / Play services — ignore */ }
    }
}
