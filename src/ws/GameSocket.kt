package com.kholland.ws

import io.ktor.server.routing.Route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory

private val ROOM_ID = Regex("^[a-z0-9]{4,12}$")
private val log = LoggerFactory.getLogger("com.kholland.ws.GameSocket")
private val CLEAN_CLOSES = setOf(CloseReason.Codes.NORMAL, CloseReason.Codes.GOING_AWAY)

fun Route.gameSocket(registry: RoomRegistry, clock: () -> Long) {
    webSocket("/ws/game") {
        val first = incoming.receiveCatching().getOrNull() as? Frame.Text
        val join = first?.let { decodeClient(it.readText()) } as? JoinRoom
        if (join == null) {
            log.info("socket closed: first frame was not joinRoom")
            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "joinRoom expected"))
            return@webSocket
        }

        val out = Channel<String>(Channel.UNLIMITED)
        // A malformed roomId has no reason of its own in the contract; badName is the closest.
        val result = when {
            !ROOM_ID.matches(join.roomId) -> JoinResult.Rejected(com.kholland.race.JoinRejection.BadName)
            join.resumeToken != null -> registry.resume(join.roomId, join.resumeToken, out)
            else -> registry.join(join.roomId, join.name, join.color, join.build, out)
        }
        when (result) {
            is JoinResult.Rejected -> {
                send(Frame.Text(frame("joinRejected", JoinRejected(result.reason.wire()))))
                close(CloseReason(CloseReason.Codes.NORMAL, "rejected"))
            }
            is JoinResult.Closed -> {
                log.info("room ${join.roomId}: join for '${join.name}' hit a closing room")
                close(CloseReason(CloseReason.Codes.TRY_AGAIN_LATER, "room closed"))
            }
            is JoinResult.Accepted -> {
                val actor = result.actor
                val id = result.playerId
                val writer = launch {
                    for (text in out) send(Frame.Text(text))
                    // The actor closes `out` early when a resume replaced this connection
                    runCatching { close(CloseReason(CloseReason.Codes.NORMAL, "replaced")) }
                }
                val joinedAt = clock()
                var lastFrameAt = joinedAt
                var failure: Throwable? = null
                try {
                    for (f in incoming) {
                        lastFrameAt = clock()
                        if (f !is Frame.Text) continue
                        when (val m = decodeClient(f.readText())) {
                            null, is JoinRoom -> Unit
                            is ClockPing -> out.trySend(frame("clockPong", ClockPong(m.t0, clock())))
                            else -> actor.send(id, m)
                        }
                    }
                } catch (e: Throwable) {
                    failure = e
                    throw e
                } finally {
                    // A missing close reason means the connection dropped without a close frame
                    val reason = withContext(NonCancellable) {
                        runCatching { withTimeoutOrNull(1_000) { closeReason.await() } }.getOrNull()
                    }
                    // Closing the tab or leaving the page is a clean close; anything else may come back
                    val left = reason?.knownReason in CLEAN_CLOSES
                    if (left) actor.leave(id, out) else actor.drop(id, out)
                    out.close()
                    val now = clock()
                    log.info(
                        "room ${join.roomId}: player $id '${join.name}' ${if (left) "closed the connection" else "disconnected"} " +
                            "(reason=${reason ?: "none"}, error=${failure?.let { "${it::class.simpleName}: ${it.message}" } ?: "none"}, " +
                            "session=${(now - joinedAt) / 1000}s, lastFrame=${now - lastFrameAt}ms ago)",
                    )
                }
                writer.join()
            }
        }
    }
}
