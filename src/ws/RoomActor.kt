package com.kholland.ws

import com.kholland.chat.Chat
import com.kholland.chat.ChatThrottle
import com.kholland.race.JoinOutcome
import com.kholland.race.JoinRejection
import com.kholland.race.Phase
import com.kholland.race.Room
import com.kholland.race.RoomEnv
import com.kholland.race.RoomEvent
import com.kholland.race.Step
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ChannelResult
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import org.slf4j.LoggerFactory

sealed interface JoinResult {
    data class Accepted(val actor: RoomActor, val playerId: String) : JoinResult
    data class Rejected(val reason: JoinRejection) : JoinResult

    /** The actor shut down before handling the join; look the room up again. */
    data object Closed : JoinResult
}

/**
 * Owns one [Room]. Every mutation goes through [commands], so the pure core never sees concurrent access.
 * A single re-armed timeout on the receive provides the wake-up for [Step.wakeAt] and for held seats.
 *
 * A player whose connection [drop]s keeps their seat for [graceMs], and [resume] with the seat's token
 * puts a new connection in it. Only [leave] or the hold running out takes them out of the room.
 */
class RoomActor(
    private val roomId: String,
    scope: CoroutineScope,
    private val clock: () -> Long,
    private val env: RoomEnv,
    private val newId: () -> String,
    private val newToken: () -> String,
    private val graceMs: Long,
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

        class Resume(val token: String, val out: SendChannel<String>, val reply: CompletableDeferred<JoinResult>) : Command

        /** [out] names the connection, so a replaced one can't touch the seat. */
        class Leave(val playerId: String, val out: SendChannel<String>) : Command
        class Drop(val playerId: String, val out: SendChannel<String>) : Command
        class Message(val playerId: String, val message: ClientMessage) : Command
    }

    /** A player's place in the room. While their connection is down [out] is null until [holdUntil]. */
    private class Seat(val name: String, val token: String, var out: SendChannel<String>?, var holdUntil: Long? = null)

    private val log = LoggerFactory.getLogger(RoomActor::class.java)
    private val commands = Channel<Command>(Channel.UNLIMITED)
    private val seats = LinkedHashMap<String, Seat>()
    private var room = Room(id = roomId)
    private val chatThrottle = ChatThrottle()
    private var wakeAt: Long? = null

    // The latest round frames, replayed to a player who resumes after the round has ended
    private var lastRoundStart: String? = null
    private var lastRoundEnd: String? = null

    init {
        scope.launch {
            try {
                loop()
            } finally {
                shutdown()
            }
        }
    }

    suspend fun join(name: String, color: String, build: String, out: SendChannel<String>): JoinResult =
        request { Command.Join(name, color, build, out, it) }

    suspend fun resume(token: String, out: SendChannel<String>): JoinResult = request { Command.Resume(token, out, it) }

    private suspend fun request(command: (CompletableDeferred<JoinResult>) -> Command): JoinResult {
        val reply = CompletableDeferred<JoinResult>()
        if (!commands.trySend(command(reply)).isSuccess) return JoinResult.Closed
        return reply.await()
    }

    fun leave(playerId: String, out: SendChannel<String>) {
        commands.trySend(Command.Leave(playerId, out))
    }

    fun drop(playerId: String, out: SendChannel<String>) {
        commands.trySend(Command.Drop(playerId, out))
    }

    fun send(playerId: String, message: ClientMessage) {
        commands.trySend(Command.Message(playerId, message))
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private suspend fun loop() {
        while (true) {
            val wake = listOfNotNull(wakeAt, seats.values.mapNotNull { it.holdUntil }.minOrNull()).minOrNull()
            // A select hands over the command or times out, never both, so no command is lost to the timeout
            val received = select<ChannelResult<Command>?> {
                commands.onReceiveCatching { it }
                if (wake != null) onTimeout((wake - clock()).coerceAtLeast(0)) { null }
            }
            if (received == null) {
                guarded { wakeUp(clock()) }
            } else {
                val command = received.getOrNull() ?: return
                guarded { handle(command) }
            }
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
            when (val pending = commands.tryReceive().getOrNull() ?: break) {
                is Command.Join -> pending.reply.complete(JoinResult.Closed)
                is Command.Resume -> pending.reply.complete(JoinResult.Closed)
                else -> Unit
            }
        }
    }

    private fun wakeUp(now: Long) {
        for ((id, seat) in seats.entries.filter { (_, s) -> s.holdUntil?.let { now >= it } == true }) {
            removeSeat(id, seat, "did not reconnect", now)
        }
        apply(room.tick(now, env))
    }

    private fun handle(command: Command) {
        val now = clock()
        when (command) {
            is Command.Join -> {
                val id = newId()
                when (val outcome = room.join(id, command.name, command.color, command.build)) {
                    is JoinOutcome.Rejected -> {
                        log.info("room $roomId: join rejected for '${command.name}' (${outcome.reason}, ${describe()})")
                        command.reply.complete(JoinResult.Rejected(outcome.reason))
                    }
                    is JoinOutcome.Accepted -> {
                        val seat = Seat(command.name, newToken(), command.out)
                        seats[id] = seat
                        command.out.trySend(frame("joined", Joined(id, roomId, now, seat.token)))
                        apply(outcome.step)
                        log.info("room $roomId: player $id '${command.name}' joined (${describe()})")
                        command.reply.complete(JoinResult.Accepted(this, id))
                    }
                }
            }
            is Command.Resume -> {
                val (id, seat) = seats.entries.find { it.value.token == command.token }
                    ?: run {
                        log.info("room $roomId: resume rejected, no seat for the token (${describe()})")
                        command.reply.complete(JoinResult.Rejected(JoinRejection.Expired))
                        return
                    }
                val away = seat.holdUntil?.let { "${(now - (it - graceMs)) / 1000}s" } ?: "a dropped connection not yet noticed"
                // Ends the old connection's writer, if the server hadn't noticed it was gone
                seat.out?.close()
                seat.out = command.out
                seat.holdUntil = null
                command.out.trySend(frame("joined", Joined(id, roomId, now, seat.token)))
                snapshot(command.out)
                log.info("room $roomId: player $id '${seat.name}' resumed after $away (${describe()})")
                command.reply.complete(JoinResult.Accepted(this, id))
            }
            is Command.Leave -> {
                val seat = seats[command.playerId]
                if (seat != null && seat.out === command.out) removeSeat(command.playerId, seat, "left", now)
            }
            is Command.Drop -> {
                val seat = seats[command.playerId]
                if (seat == null || seat.out !== command.out) return
                seat.out = null
                seat.holdUntil = now + graceMs
                log.info(
                    "room $roomId: player ${command.playerId} '${seat.name}' lost connection, " +
                        "holding seat for ${graceMs / 1000}s (${describe()})",
                )
            }
            is Command.Message -> {
                val id = command.playerId
                if (id !in seats) return
                when (val m = command.message) {
                    is UpdateSettings -> apply(room.updateSettings(id, m.winsToMatch, m.difficulty))
                    ReturnToLobby -> apply(room.returnToLobby(id))
                    StartMatch -> apply(room.startMatch(id, now, env))
                    is VoteSkip -> apply(room.voteSkip(id, m.round, now, env))
                    is FinishReport -> apply(room.reportFinish(id, m.round, m.raceTimeMs, now, env))
                    is Relay -> {
                        val text = m.from(id)
                        seats.forEach { (other, s) -> if (other != id) s.out?.trySend(text) }
                    }
                    is ChatSend -> Chat.sanitize(m.text)?.let { chat(id, ChatMessageDto(id, it, quick = false), now) }
                    is QuickChatSend ->
                        if (m.id in Chat.QUICK_LINE_IDS) chat(id, ChatMessageDto(id, m.id, quick = true), now)
                    is JoinRoom, is ClockPing -> Unit
                }
            }
        }
    }

    /** To everyone, the sender included, so all clients see the same order. */
    private fun chat(id: String, message: ChatMessageDto, now: Long) {
        if (!chatThrottle.allow(id, now)) return
        val text = frame("chatMessage", message)
        seats.values.forEach { it.out?.trySend(text) }
    }

    private fun removeSeat(id: String, seat: Seat, why: String, now: Long) {
        seats.remove(id)
        chatThrottle.forget(id)
        val phase = describe()
        apply(room.leave(id, now, env))
        log.info("room $roomId: player $id '${seat.name}' $why during $phase (now ${describe()})")
    }

    /** Everything a resumed player may have missed: the room, and the round it is in or has just ended. */
    private fun snapshot(out: SendChannel<String>) {
        out.trySend(RoomEvent.StateChanged(room).toFrame())
        when (val p = room.phase) {
            Phase.Lobby -> Unit
            is Phase.Round -> {
                out.trySend(RoomEvent.RoundStarted(p.plan).toFrame())
                if (p.skipVotes.isNotEmpty()) {
                    out.trySend(RoomEvent.SkipVotesChanged(p.plan.round, p.skipVotes.size, room.players.size).toFrame())
                }
            }
            is Phase.Results -> listOfNotNull(lastRoundStart, lastRoundEnd).forEach { out.trySend(it) }
            is Phase.MatchOver -> {
                listOfNotNull(lastRoundStart, lastRoundEnd).forEach { out.trySend(it) }
                out.trySend(RoomEvent.LobbyReturn(p.returned.toList(), p.lobbyAt).toFrame())
            }
        }
    }

    private fun describe(): String {
        val phase = room.phase.let { if (it is Phase.Round) "Round ${it.plan.round}" else it::class.simpleName }
        val away = seats.values.count { it.out == null }
        return "phase=$phase, players=${room.players.size}" + if (away > 0) ", reconnecting=$away" else ""
    }

    private fun apply(step: Step) {
        room = step.room
        wakeAt = step.wakeAt
        for (event in step.events) {
            val text = event.toFrame()
            when (event) {
                is RoomEvent.RoundStarted -> lastRoundStart = text
                is RoomEvent.RoundEnded -> lastRoundEnd = text
                else -> Unit
            }
            seats.values.forEach { it.out?.trySend(text) }
        }
    }
}
