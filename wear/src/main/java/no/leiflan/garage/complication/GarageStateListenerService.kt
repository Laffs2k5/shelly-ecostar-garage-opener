package no.leiflan.garage.complication

import android.content.ComponentName
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

/**
 * Pushes a complication refresh whenever the phone publishes a new door state. The system binds this
 * service on a `/garage/state` DataItem change even when the watch app isn't foregrounded — the same
 * Data Layer mechanism the phone's GarageWearService uses for `/garage/cmd`. This keeps the complication
 * live in the background without periodic polling (the service declares UPDATE_PERIOD_SECONDS=0).
 */
class GarageStateListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        val changed = events.any {
            it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == ComplicationContent.STATE_PATH
        }
        events.release()
        if (!changed) return

        val component = ComponentName(this, GarageComplicationService::class.java)
        ComplicationDataSourceUpdateRequester.create(applicationContext, component).requestUpdateAll()
    }
}
