package com.kholland.ws

import com.kholland.race.JoinRejection
import com.kholland.race.RoomEnv
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.SendChannel
import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class RoomRegistry(
    private val scope: CoroutineScope,
    private val clock: () -> Long,
    private val env: RoomEnv,
    /** How long a dropped player's seat waits for them to resume. */
    private val graceMs: Long = 30_000,
    private val newId: () -> String = { UUID.randomUUID().toString().replace("-", "").take(12) },
    private val newToken: () -> String = { UUID.randomUUID().toString() },
) {
    private val log = LoggerFactory.getLogger(RoomRegistry::class.java)
    private val rooms = ConcurrentHashMap<String, RoomActor>()

    val size: Int get() = rooms.size

    /** Creates the room on first join; retries if the room's actor closed concurrently. */
    suspend fun join(roomId: String, name: String, color: String, build: String, out: SendChannel<String>): JoinResult {
        while (true) {
            val actor = rooms.computeIfAbsent(roomId) {
                log.info("room $roomId: created (rooms=${rooms.size + 1})")
                RoomActor(roomId, scope, clock, env, newId, newToken, graceMs) {
                    if (rooms.remove(roomId, it)) log.info("room $roomId: deleted (rooms=${rooms.size})")
                }
            }
            val result = actor.join(name, color, build, out)
            if (result !is JoinResult.Closed) return result
        }
    }

    /** Reattaches to a held seat. Never creates a room: a room that's gone took the seat with it. */
    suspend fun resume(roomId: String, token: String, out: SendChannel<String>): JoinResult =
        when (val result = rooms[roomId]?.resume(token, out) ?: JoinResult.Closed) {
            JoinResult.Closed -> JoinResult.Rejected(JoinRejection.Expired)
            else -> result
        }
}
