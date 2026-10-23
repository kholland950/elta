package com.kholland.race

enum class EndReason { Finish, Timeout, Skipped }

enum class JoinRejection { InProgress, Full, BadName, StaleBuild }

sealed interface RoomEvent {
    data class StateChanged(val room: Room) : RoomEvent
    data class PlayerLeft(val playerId: String) : RoomEvent
    data class RoundStarted(val plan: RoundPlan) : RoomEvent
    data class SkipVotesChanged(val round: Int, val votes: Int, val needed: Int) : RoomEvent
    data class LobbyReturn(val returned: List<String>, val lobbyAt: Long) : RoomEvent
    data class RoundEnded(
        val round: Int,
        val winnerId: String?,
        val reason: EndReason,
        val times: List<Report>,
        val wins: Map<String, Int>,
        val nextRoundAt: Long?,
        val matchWinnerId: String?,
    ) : RoomEvent
}
