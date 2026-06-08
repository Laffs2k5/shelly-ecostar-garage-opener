package no.leiflan.garage.api

import no.leiflan.garage.api.GarageApi.ConnectionMode

/** Pure UI helpers for the connection indicator + event log (no Android deps) — JVM-unit-testable. */
object ConnectionUi {

    fun label(mode: ConnectionMode): String = when (mode) {
        ConnectionMode.HTTP_DIRECT -> "Wi-Fi · direct"
        ConnectionMode.LOCAL_BROKER -> "Wi-Fi · broker"
        ConnectionMode.CLOUD -> "Cloud"
        ConnectionMode.OFFLINE -> "Offline"
    }

    data class LogEntry(val mode: ConnectionMode, val time: String)

    /** Append (newest-first, capped at 4) only when the mode actually changed. */
    fun pushIfChanged(log: List<LogEntry>, mode: ConnectionMode, time: String): List<LogEntry> {
        if (log.isNotEmpty() && log[0].mode == mode) return log
        return (listOf(LogEntry(mode, time)) + log).take(4)
    }
}
