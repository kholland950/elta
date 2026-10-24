package com.kholland.race

data class RoundPlan(
    val round: Int,
    val seed: Int,
    val difficulty: Int,
    val startOrder: List<String>,
    val archetype: Archetype,
    val exploreAt: Long,
    val snapAt: Long,
    val goAt: Long,
)

sealed interface Phase {
    data object Lobby : Phase

    data class Round(
        val plan: RoundPlan,
        val timeoutAt: Long,
        val reports: List<Report> = emptyList(),
        val windowEndsAt: Long? = null,
        val skipVotes: Set<String> = emptySet(),
    ) : Phase

    data class Results(val nextAt: Long) : Phase

    data class MatchOver(val lobbyAt: Long, val returned: Set<String> = emptySet()) : Phase
}
