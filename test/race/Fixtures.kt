package com.kholland.race

import kotlin.random.Random

val env = RoomEnv(Timings(), Random(7))

fun lobby(vararg ids: String, build: String = "b1", id: String = "room1"): Room {
    var room = Room(id)
    ids.forEach { pid ->
        val outcome = room.join(pid, "name $pid", "Blue", build) as JoinOutcome.Accepted
        room = outcome.step.room
    }
    return room
}

/** Starts a match at now=0 with the host being the first id. Round 1 goAt = 500 + 15000 + 3500 = 19000. */
fun started(vararg ids: String, settings: Settings? = null): Room {
    var room = lobby(*ids)
    if (settings != null) room = room.updateSettings(ids.first(), settings.winsToMatch, settings.difficulty).room
    return room.startMatch(ids.first(), 0, env).room
}

const val GO_AT = 19_000L

fun Room.round() = phase as Phase.Round
inline fun <reified E : RoomEvent> Step.event(): E = events.filterIsInstance<E>().single()

/** Plays out one round where [winner] reports 1000ms and the window closes. */
fun Room.winRound(winner: String): Room {
    val p = round()
    val at = p.plan.goAt + 1000
    val reported = reportFinish(winner, p.plan.round, 1000.0, at, env).room
    return reported.tick(reported.round().windowEndsAt!!, env).room
}
