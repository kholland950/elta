package com.kholland

import io.ktor.http.cio.websocket.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

data class ActiveWebSocket(val session: WebSocketSession)

@Serializable
data class GameStateMessage(val players: Collection<Player>)

@Serializable
data class NewPlayerMessage(val id: String, val color: String, val name: String)

@Serializable
data class PlayerMoveMessage(val playerId: String, val x: Double, val y: Double, val velocityX: Double, val velocityY: Double)

@Serializable
data class PlayerLeftMessage(val playerId: String)

@Serializable
data class WebSocketMessage(val event: String, val data: JsonElement)

@Serializable
data class Player(
        @Transient var session: WebSocketSession? = null,
        val id: String,
        val name: String,
        val color: String,
        var x: Double,
        var y: Double,
        var velocityX: Double,
        var velocityY: Double
)

object GameState {
    val players: HashMap<String, Player> = hashMapOf()
}

object MessageBroker {
    private val websockets = mutableListOf<ActiveWebSocket>()

    fun add(session: WebSocketSession) = websockets.add(ActiveWebSocket(session))

    suspend fun remove(session: WebSocketSession) {
        websockets.removeIf { it.session == session }

        val id = GameState.players.values.find {
            it.session == session
        }?.id ?: ""

        GameState.players.remove(id)

        broadcastToOthers("playerLeft", Json.encodeToJsonElement(PlayerLeftMessage(id)), session)
    }

    suspend fun receive(data: String, session: WebSocketSession) {
        val message: WebSocketMessage = Json.decodeFromString(data)
        when (message.event) {
            "newPlayer" -> handleNewPlayer(Json.decodeFromJsonElement<NewPlayerMessage>(message.data), session)
            "playerMove" -> handlePlayerMove(Json.decodeFromJsonElement<PlayerMoveMessage>(message.data), session)
        }
    }

    private suspend fun handleNewPlayer(message: NewPlayerMessage, session: WebSocketSession) {
        session.send(Json.encodeToString(
                WebSocketMessage(
                        "gameState",
                        Json.encodeToJsonElement(GameStateMessage(ArrayList(GameState.players.values)))
                )
        ))

        GameState.players[message.id] = Player(session, message.id, message.name, message.color, 0.0, 0.0, 0.0, 0.0)

        //tell other players about the new player
        broadcastToOthers("newPlayer", Json.encodeToJsonElement(message), session)
    }

    private suspend fun handlePlayerMove(message: PlayerMoveMessage, session: WebSocketSession) {
        val player = GameState.players[message.playerId]
        player?.x = message.x
        player?.y = message.y
        player?.velocityX = message.velocityX
        player?.velocityY = message.velocityY

        //tell other players about the move
        broadcastToOthers("playerMove", Json.encodeToJsonElement(message), session)
    }

    private suspend fun broadcastToOthers(event: String, message: JsonElement, sourceSession: WebSocketSession) {
        websockets.filter { it.session !== sourceSession }.map {
            it.session.send(Json.encodeToString(WebSocketMessage(event, message)))
        }
    }
}
