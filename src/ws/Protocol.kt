package com.kholland.ws

import com.kholland.race.EndReason
import com.kholland.race.JoinRejection
import com.kholland.race.Phase
import com.kholland.race.RoomEvent
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

val wireJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
data class Envelope(val event: String, val data: JsonElement = JsonObject(emptyMap()))

// Client -> server

sealed interface ClientMessage

@Serializable
data class JoinRoom(val roomId: String, val name: String, val color: String, val build: String) : ClientMessage

@Serializable
data class ClockPing(val t0: JsonElement) : ClientMessage

@Serializable
data class UpdateSettings(val winsToMatch: Int, val difficulty: Int) : ClientMessage

data object StartMatch : ClientMessage

data object ReturnToLobby : ClientMessage

@Serializable
data class VoteSkip(val round: Int) : ClientMessage

@Serializable
data class FinishReport(val round: Int, val raceTimeMs: Double) : ClientMessage

/** playerMove / playerAction: relayed as-is apart from `playerId`, so unknown fields survive. */
data class Relay(val event: String, val data: JsonObject) : ClientMessage {
    fun from(senderId: String): String =
        frame(event, JsonObject(data + ("playerId" to JsonPrimitive(senderId))))
}

/** Returns null for anything malformed or unknown; callers ignore it. */
fun decodeClient(text: String): ClientMessage? = try {
    val envelope = wireJson.decodeFromString<Envelope>(text)
    val data = envelope.data
    when (envelope.event) {
        "joinRoom" -> wireJson.decodeFromJsonElement<JoinRoom>(data)
        "clockPing" -> wireJson.decodeFromJsonElement<ClockPing>(data)
        "updateSettings" -> wireJson.decodeFromJsonElement<UpdateSettings>(data)
        "startMatch" -> StartMatch
        "returnToLobby" -> ReturnToLobby
        "voteSkip" -> wireJson.decodeFromJsonElement<VoteSkip>(data)
        "finishReport" -> wireJson.decodeFromJsonElement<FinishReport>(data)
        "playerMove", "playerAction" -> (data as? JsonObject)?.let { Relay(envelope.event, it) }
        else -> null
    }
} catch (_: IllegalArgumentException) { // SerializationException is one
    null
}

// Server -> client

@Serializable
data class Joined(val playerId: String, val roomId: String, val serverTime: Long)

@Serializable
data class JoinRejected(val reason: String)

@Serializable
data class ClockPong(val t0: JsonElement, val serverTime: Long)

@Serializable
data class SettingsDto(val winsToMatch: Int, val difficulty: Int)

@Serializable
data class PlayerDto(val id: String, val name: String, val color: String, val wins: Int)

@Serializable
data class RoomStateDto(
    val roomId: String,
    val hostId: String,
    val phase: String,
    val settings: SettingsDto,
    val players: List<PlayerDto>,
)

@Serializable
data class PlayerLeftDto(val playerId: String)

@Serializable
data class RoundStartDto(
    val round: Int,
    val seed: Int,
    val difficulty: Int,
    val startOrder: List<String>,
    val archetype: String,
    val exploreAt: Long,
    val snapAt: Long,
    val goAt: Long,
)

@Serializable
data class LobbyReturnDto(val returned: List<String>, val lobbyAt: Long)

@Serializable
data class SkipVotesDto(val round: Int, val votes: Int, val needed: Int)

@Serializable
data class TimeDto(val playerId: String, val raceTimeMs: Double)

@Serializable
data class RoundEndDto(
    val round: Int,
    val winnerId: String?,
    val reason: String,
    val times: List<TimeDto>,
    val wins: Map<String, Int>,
    val nextRoundAt: Long?,
    val matchWinnerId: String?,
)

inline fun <reified T> frame(event: String, data: T): String =
    frame(event, wireJson.encodeToJsonElement(data))

fun frame(event: String, data: JsonElement): String = wireJson.encodeToString(Envelope(event, data))

fun JoinRejection.wire(): String = when (this) {
    JoinRejection.InProgress -> "inProgress"
    JoinRejection.Full -> "full"
    JoinRejection.BadName -> "badName"
    JoinRejection.StaleBuild -> "staleBuild"
}

fun RoomEvent.toFrame(): String = when (this) {
    is RoomEvent.StateChanged -> frame(
        "roomState",
        RoomStateDto(
            roomId = room.id,
            hostId = room.hostId.orEmpty(),
            phase = if (room.phase is Phase.Lobby) "lobby" else "match",
            settings = SettingsDto(room.settings.winsToMatch, room.settings.difficulty),
            players = room.players.map { PlayerDto(it.id, it.name, it.color, it.wins) },
        ),
    )
    is RoomEvent.PlayerLeft -> frame("playerLeft", PlayerLeftDto(playerId))
    is RoomEvent.RoundStarted -> frame(
        "roundStart",
        RoundStartDto(
            plan.round, plan.seed, plan.difficulty, plan.startOrder, plan.archetype.wire,
            plan.exploreAt, plan.snapAt, plan.goAt,
        ),
    )
    is RoomEvent.LobbyReturn -> frame("lobbyReturn", LobbyReturnDto(returned, lobbyAt))
    is RoomEvent.SkipVotesChanged -> frame("skipVotes", SkipVotesDto(round, votes, needed))
    is RoomEvent.RoundEnded -> frame(
        "roundEnd",
        RoundEndDto(
            round = round,
            winnerId = winnerId,
            reason = when (reason) {
                EndReason.Finish -> "finish"
                EndReason.Timeout -> "timeout"
                EndReason.Skipped -> "skipped"
            },
            times = times.map { TimeDto(it.playerId, it.raceTimeMs) },
            wins = wins,
            nextRoundAt = nextRoundAt,
            matchWinnerId = matchWinnerId,
        ),
    )
}
