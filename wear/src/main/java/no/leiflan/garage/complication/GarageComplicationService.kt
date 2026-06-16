package no.leiflan.garage.complication

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.MonochromaticImageComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.SmallImage
import androidx.wear.watchface.complications.data.SmallImageComplicationData
import androidx.wear.watchface.complications.data.SmallImageType
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import no.leiflan.garage.MainActivity
import no.leiflan.garage.R

/**
 * Watch-face complication that mirrors the door state and launches the app on tap (spec 17).
 *
 * State comes from the phone's RETAINED `/garage/state` DataItem — read directly here via [Wearable]'s
 * DataClient rather than from a persisted copy: it's the single source of truth, always current, and
 * available even when the Compose [MainActivity] process is dead (this service runs independently).
 * [GarageStateListenerService] calls back through ComplicationDataSourceUpdateRequester whenever the
 * phone publishes a change, so the complication refreshes without polling (UPDATE_PERIOD_SECONDS=0).
 *
 * SMALL_IMAGE is the primary type (full colour preserved — cyan/orange/grey survive); MONOCHROMATIC_ICON
 * and SHORT_TEXT are fallbacks for slots that only accept those (the slot, not the user, picks one).
 */
class GarageComplicationService : ComplicationDataSourceService() {

    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        // Called on the main thread; the DataItem read blocks, so do it off-thread, then deliver.
        Thread {
            val (state, mode) = readDoorState(applicationContext)
            listener.onComplicationData(build(request.complicationType, state, mode))
        }.start()
    }

    // MUST be static / no I/O: shows the CLOSED look in the provider picker preview.
    override fun getPreviewData(type: ComplicationType): ComplicationData? = build(type, "CLOSED", null)

    /** Read the phone's retained door state. Returns (state, mode); (null, null) when not linked yet. */
    private fun readDoorState(ctx: Context): Pair<String?, String?> = try {
        val items = Tasks.await(Wearable.getDataClient(ctx).dataItems)
        var state: String? = null
        var mode: String? = null
        for (item in items) {
            if (item.uri.path == ComplicationContent.STATE_PATH) {
                val m = DataMapItem.fromDataItem(item).dataMap
                state = m.getString(ComplicationContent.KEY_STATE, "UNKNOWN")
                mode = m.getString(ComplicationContent.KEY_MODE, "OFFLINE")
            }
        }
        items.release()
        state to mode
    } catch (_: Exception) {
        null to null
    }

    private fun build(type: ComplicationType, state: String?, mode: String?): ComplicationData? {
        val iconRes = iconRes(ComplicationContent.glyphFor(state, mode))
        val label = ComplicationContent.labelFor(state)
        val desc = PlainComplicationText.Builder("Garage door: $label").build()
        val tap = launchIntent(applicationContext)
        return when (type) {
            ComplicationType.SMALL_IMAGE -> SmallImageComplicationData.Builder(
                SmallImage.Builder(Icon.createWithResource(this, iconRes), SmallImageType.ICON).build(),
                desc,
            ).setTapAction(tap).build()

            // Manifest token is the legacy "ICON"; the OS maps it to this MONOCHROMATIC_IMAGE request type.
            ComplicationType.MONOCHROMATIC_IMAGE -> MonochromaticImageComplicationData.Builder(
                MonochromaticImage.Builder(Icon.createWithResource(this, iconRes)).build(),
                desc,
            ).setTapAction(tap).build()

            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(
                PlainComplicationText.Builder(label).build(),
                desc,
            ).setMonochromaticImage(MonochromaticImage.Builder(Icon.createWithResource(this, iconRes)).build())
                .setTapAction(tap)
                .build()

            else -> null // a type we didn't declare in SUPPORTED_TYPES
        }
    }

    private fun iconRes(glyph: GarageGlyph): Int = when (glyph) {
        GarageGlyph.CLOSED -> R.drawable.ic_comp_garage_closed
        GarageGlyph.MID -> R.drawable.ic_comp_garage_mid
        GarageGlyph.OPEN -> R.drawable.ic_comp_garage_open
        GarageGlyph.UNKNOWN -> R.drawable.ic_comp_garage_unknown
    }

    /** Tapping the complication opens the watch app, which (re)requests current state from the phone. */
    private fun launchIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            ctx, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
