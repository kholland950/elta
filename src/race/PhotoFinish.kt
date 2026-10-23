package com.kholland.race

/** An accepted finish report. Lists of reports are kept in arrival order. */
data class Report(val playerId: String, val raceTimeMs: Double, val arrivedAt: Long)

object PhotoFinish {
    /** Lowest time wins; on a tie the earlier arrival (earlier in the list) wins. */
    fun winner(reports: List<Report>): Report? = reports.minByOrNull { it.raceTimeMs }

    /** Sorted by time; stable, so ties keep arrival order. */
    fun ranked(reports: List<Report>): List<Report> = reports.sortedBy { it.raceTimeMs }

    /** `0 < raceTimeMs <= (now - goAt) + slack`. NaN and infinity fail. */
    fun isPlausible(raceTimeMs: Double, now: Long, goAt: Long, slackMs: Long): Boolean =
        raceTimeMs > 0.0 && raceTimeMs <= (now - goAt) + slackMs
}
