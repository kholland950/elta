package com.kholland.ws

import com.kholland.race.RoomEnv
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.SendChannel
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class RoomRegistry(
    private val scope: CoroutineScope,
    private val clock: () -> Long,
    private val env: RoomEnv,
    private val newId: () -> String = { UUID.randomUUID().toString().replace("-", "").take(12) },
) {
    private val rooms = ConcurrentHashMap<String, RoomActor>()

    val size: Int get() = rooms.size

    /** Creates the room on first join; retries if the room's actor closed concurrently. */
    suspend fun join(roomId: String, name: String, color: String, build: String, out: SendChannel<String>): JoinResult {
        while (true) {
            val actor = rooms.computeIfAbsent(roomId) {
                RoomActor(roomId, scope, clock, env, newId) { rooms.remove(roomId, it) }
            }
            val result = actor.join(name, color, build, out)
            if (result !is JoinResult.Closed) return result
        }
    }
}
