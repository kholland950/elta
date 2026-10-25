package com.kholland.race

enum class EndReason { Finish, Timeout, Skipped }

/** [Expired] is the ws layer's: a resume whose seat is gone. The others come from [Room.join]. */
enum class JoinRejection { InProgress, Full, BadName, StaleBuild, Expired }

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
        val endedAt: Long,
        /** Length of the clients' trail replay beat. */
        val replayMs: Long,
        val nextRoundAt: Long?,
        val matchWinnerId: String?,
    ) : RoomEvent
}
