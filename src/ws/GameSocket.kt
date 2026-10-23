package com.kholland.ws

import io.ktor.server.routing.Route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

private val ROOM_ID = Regex("^[a-z0-9]{4,12}$")

fun Route.gameSocket(registry: RoomRegistry, clock: () -> Long) {
    webSocket("/ws/game") {
        val first = incoming.receiveCatching().getOrNull() as? Frame.Text
        val join = first?.let { decodeClient(it.readText()) } as? JoinRoom
        if (join == null) {
            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "joinRoom expected"))
            return@webSocket
        }

        val out = Channel<String>(Channel.UNLIMITED)
        // A malformed roomId has no reason of its own in the contract; badName is the closest.
        val result = if (ROOM_ID.matches(join.roomId)) {
            registry.join(join.roomId, join.name, join.color, join.build, out)
        } else {
            JoinResult.Rejected(com.kholland.race.JoinRejection.BadName)
        }
        when (result) {
            is JoinResult.Rejected -> {
                send(Frame.Text(frame("joinRejected", JoinRejected(result.reason.wire()))))
                close(CloseReason(CloseReason.Codes.NORMAL, "rejected"))
            }
            is JoinResult.Closed -> close(CloseReason(CloseReason.Codes.TRY_AGAIN_LATER, "room closed"))
            is JoinResult.Accepted -> {
                val actor = result.actor
                val id = result.playerId
                val writer = launch { for (text in out) send(Frame.Text(text)) }
                try {
                    for (f in incoming) {
                        if (f !is Frame.Text) continue
                        when (val m = decodeClient(f.readText())) {
                            null, is JoinRoom -> Unit
                            is ClockPing -> out.trySend(frame("clockPong", ClockPong(m.t0, clock())))
                            else -> actor.send(id, m)
                        }
                    }
                } finally {
                    actor.leave(id)
                    out.close()
                }
                writer.join()
            }
        }
    }
}
