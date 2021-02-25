package com.kholland

import io.ktor.http.cio.websocket.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

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
