package com.kholland.ws

import com.kholland.race.JoinOutcome
import com.kholland.race.JoinRejection
import com.kholland.race.Room
import com.kholland.race.RoomEnv
import com.kholland.race.Step
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory

sealed interface JoinResult {
    data class Accepted(val actor: RoomActor, val playerId: String) : JoinResult
    data class Rejected(val reason: JoinRejection) : JoinResult

    /** The actor shut down before handling the join; look the room up again. */
    data object Closed : JoinResult
}

/**
 * Owns one [Room]. Every mutation goes through [commands], so the pure core never sees concurrent access.
 * A single re-armed timeout on the receive provides the wake-up for [Step.wakeAt].
 */
class RoomActor(
    private val roomId: String,
    scope: CoroutineScope,
    private val clock: () -> Long,
    private val env: RoomEnv,
    private val newId: () -> String,
    private val onEmpty: (RoomActor) -> Unit,
) {
    private sealed interface Command {
        class Join(
            val name: String,
            val color: String,
            val build: String,
            val out: SendChannel<String>,
            val reply: CompletableDeferred<JoinResult>,
        ) : Command

        class Leave(val playerId: String) : Command
        class Message(val playerId: String, val message: ClientMessage) : Command
    }

    private val log = LoggerFactory.getLogger(RoomActor::class.java)
    private val commands = Channel<Command>(Channel.UNLIMITED)
    private val clients = LinkedHashMap<String, SendChannel<String>>()
    private var room = Room(id = roomId)
    private var wakeAt: Long? = null

    init {
        scope.launch {
            try {
                loop()
            } finally {
                shutdown()
            }
        }
    }

    suspend fun join(name: String, color: String, build: String, out: SendChannel<String>): JoinResult {
        val reply = CompletableDeferred<JoinResult>()
        if (!commands.trySend(Command.Join(name, color, build, out, reply)).isSuccess) return JoinResult.Closed
        return reply.await()
    }

    fun leave(playerId: String) {
        commands.trySend(Command.Leave(playerId))
    }

    fun send(playerId: String, message: ClientMessage) {
        commands.trySend(Command.Message(playerId, message))
    }

    private suspend fun loop() {
        while (true) {
            val wake = wakeAt
            val command = if (wake == null) {
                commands.receiveCatching().getOrNull() ?: return
            } else {
                val received = withTimeoutOrNull((wake - clock()).coerceAtLeast(0)) { commands.receiveCatching() }
                if (received == null) {
                    guarded { apply(room.tick(clock(), env)) }
                    continue
                }
                received.getOrNull() ?: return
            }
            guarded { handle(command) }
            if (room.players.isEmpty()) return
        }
    }

    private inline fun guarded(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            log.error("room $roomId: command failed", e)
        }
    }

    private fun shutdown() {
        onEmpty(this)
        commands.close()
        while (true) {
            val pending = commands.tryReceive().getOrNull() ?: break
            if (pending is Command.Join) pending.reply.complete(JoinResult.Closed)
        }
    }

    private fun handle(command: Command) {
        val now = clock()
        when (command) {
            is Command.Join -> {
                val id = newId()
                when (val outcome = room.join(id, command.name, command.color, command.build)) {
                    is JoinOutcome.Rejected -> command.reply.complete(JoinResult.Rejected(outcome.reason))
                    is JoinOutcome.Accepted -> {
                        clients[id] = command.out
                        command.out.trySend(frame("joined", Joined(id, roomId, now)))
                        apply(outcome.step)
                        command.reply.complete(JoinResult.Accepted(this, id))
                    }
                }
            }
            is Command.Leave -> if (clients.remove(command.playerId) != null) {
                apply(room.leave(command.playerId, now, env))
            }
            is Command.Message -> {
                val id = command.playerId
                if (id !in clients) return
                when (val m = command.message) {
                    is UpdateSettings -> apply(room.updateSettings(id, m.winsToMatch, m.difficulty))
                    ReturnToLobby -> apply(room.returnToLobby(id))
                    StartMatch -> apply(room.startMatch(id, now, env))
                    is VoteSkip -> apply(room.voteSkip(id, m.round, now, env))
                    is FinishReport -> apply(room.reportFinish(id, m.round, m.raceTimeMs, now, env))
                    is Relay -> {
                        val text = m.from(id)
                        clients.forEach { (other, out) -> if (other != id) out.trySend(text) }
                    }
                    is JoinRoom, is ClockPing -> Unit
                }
            }
        }
    }

    private fun apply(step: Step) {
        room = step.room
        wakeAt = step.wakeAt
        for (event in step.events) {
            val text = event.toFrame()
            clients.values.forEach { it.trySend(text) }
        }
    }
}
