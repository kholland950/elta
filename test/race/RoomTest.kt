package com.kholland.race

import kotlin.random.Random
import kotlin.test.*

class RoomTest {
    private fun reject(room: Room, name: String = "okay", color: String = "Red", build: String = "b1") =
        (room.join("x", name, color, build) as JoinOutcome.Rejected).reason

    // --- join / leave / settings ---

    @Test
    fun firstJoinerIsHostAndStoresBuild() {
        val room = lobby("a", "b", build = "v9")
        assertEquals("a", room.hostId)
        assertEquals("v9", room.build)
        assertEquals(listOf("a", "b"), room.players.map { it.id })
        assertEquals(Settings(3, 4), room.settings)
    }

    @Test
    fun joinEmitsRoomState() {
        val out = Room("r").join("a", "alice", "Blue", "b") as JoinOutcome.Accepted
        assertIs<RoomEvent.StateChanged>(out.step.events.single())
        assertNull(out.step.wakeAt)
    }

    @Test
    fun rejectsBadNamesAndColors() {
        val room = lobby("a")
        assertEquals(JoinRejection.BadName, reject(room, name = "x"))
        assertEquals(JoinRejection.BadName, reject(room, name = "a".repeat(16)))
        assertEquals(JoinRejection.BadName, reject(room, name = "bad!name"))
        assertEquals(JoinRejection.BadName, reject(room, name = ""))
        assertEquals(JoinRejection.BadName, reject(room, color = "Pink"))
        assertEquals(JoinRejection.BadName, reject(room, color = "red"))
        assertTrue(room.join("x", "ab", "Violet", "b1") is JoinOutcome.Accepted)
        assertTrue(room.join("x", "a".repeat(15), "Yellow", "b1") is JoinOutcome.Accepted)
        assertTrue(room.join("x", "a_b 1", "Orange", "b1") is JoinOutcome.Accepted)
    }

    @Test
    fun rejectsStaleBuild() = assertEquals(JoinRejection.StaleBuild, reject(lobby("a"), build = "other"))

    @Test
    fun rejectsNinthPlayer() {
        val room = lobby(*(1..8).map { "p$it" }.toTypedArray())
        assertEquals(JoinRejection.Full, reject(room))
    }

    @Test
    fun rejectsJoinDuringMatchResultsAndMatchOver() {
        val running = started("a", "b")
        assertEquals(JoinRejection.InProgress, reject(running))
        val results = running.winRound("a")
        assertIs<Phase.Results>(results.phase)
        assertEquals(JoinRejection.InProgress, reject(results))
        val over = started("a", "b", settings = Settings(1, 4)).winRound("a")
        assertIs<Phase.MatchOver>(over.phase)
        assertEquals(JoinRejection.InProgress, reject(over))
    }

    @Test
    fun leaveEmitsPlayerLeftBeforeRoomState() {
        val step = lobby("a", "b").leave("b", 0, env)
        assertIs<RoomEvent.PlayerLeft>(step.events[0])
        assertIs<RoomEvent.StateChanged>(step.events[1])
        assertEquals(listOf("a"), step.room.players.map { it.id })
    }

    @Test
    fun hostMigratesToNextInJoinOrder() {
        val room = lobby("a", "b", "c")
        assertEquals("b", room.leave("a", 0, env).room.hostId)
        assertEquals("a", room.leave("b", 0, env).room.hostId)
        assertEquals("c", room.leave("a", 0, env).room.leave("b", 0, env).room.hostId)
    }

    @Test
    fun lastLeaverEmptiesRoom() {
        val step = started("a").leave("a", 5, env)
        assertTrue(step.room.players.isEmpty())
        assertTrue(step.events.isEmpty())
    }

    @Test
    fun leavingUnknownPlayerIsNoop() {
        val room = lobby("a")
        assertEquals(Step(room), room.leave("zzz", 0, env))
    }

    @Test
    fun updateSettingsHostLobbyOnly() {
        val room = lobby("a", "b")
        val ok = room.updateSettings("a", 5, 7)
        assertEquals(Settings(5, 7), ok.room.settings)
        assertIs<RoomEvent.StateChanged>(ok.events.single())
        assertEquals(room, room.updateSettings("b", 5, 7).room)
        assertEquals(room, room.updateSettings("a", 2, 7).room)
        assertEquals(room, room.updateSettings("a", 5, 0).room)
        assertEquals(room, room.updateSettings("a", 5, 11).room)
        val running = started("a", "b")
        assertEquals(running, running.updateSettings("a", 5, 7).room)
    }

    // --- start ---

    @Test
    fun startMatchHostOnly() {
        val room = lobby("a", "b")
        assertEquals(room, room.startMatch("b", 0, env).room)
        assertEquals(room, room.startMatch("ghost", 0, env).room)
    }

    @Test
    fun startMatchWorksWithOnePlayerAndOnlyInLobby() {
        val step = lobby("a").startMatch("a", 1000, env)
        assertIs<Phase.Round>(step.room.phase)
        val again = step.room.startMatch("a", 2000, env)
        assertEquals(step.room, again.room)
        assertTrue(again.events.isEmpty())
    }

    @Test
    fun startMatchTimingsAndEvents() {
        val step = lobby("a", "b", "c").startMatch("a", 1000, env)
        assertIs<RoomEvent.StateChanged>(step.events[0])
        val plan = (step.events[1] as RoomEvent.RoundStarted).plan
        assertEquals(1, plan.round)
        assertEquals(1500, plan.exploreAt)
        assertEquals(16_500, plan.snapAt)
        assertEquals(20_000, plan.goAt)
        assertEquals(4, plan.difficulty)
        assertEquals(setOf("a", "b", "c"), plan.startOrder.toSet())
        assertEquals(3, plan.startOrder.size)
        assertTrue(plan.seed in 1..2_147_483_646)
        assertEquals(plan.goAt + 120_000, step.wakeAt)
    }

    @Test
    fun randomnessIsInjected() {
        fun plan(seed: Int) = lobby("a", "b", "c", "d").startMatch("a", 0, RoomEnv(Timings(), Random(seed))).room.round().plan
        assertEquals(plan(3), plan(3))
        assertNotEquals(plan(3).seed, plan(4).seed)
    }

    // --- finish reports ---

    private fun report(room: Room, who: String, t: Double, now: Long, round: Int = 1) =
        room.reportFinish(who, round, t, now, env)

    @Test
    fun rejectsReportBeforeGoAt() {
        val room = started("a", "b")
        assertEquals(room, report(room, "a", 100.0, GO_AT - 1).room)
        assertEquals(room, report(room, "a", 100.0, GO_AT).room)
    }

    @Test
    fun rejectsWrongRound() {
        val room = started("a", "b")
        assertEquals(room, report(room, "a", 100.0, GO_AT + 1000, round = 2).room)
        assertEquals(room, report(room, "a", 100.0, GO_AT + 1000, round = 0).room)
    }

    @Test
    fun rejectsImplausibleTimes() {
        val room = started("a", "b")
        val now = GO_AT + 1000
        assertEquals(room, report(room, "a", 1500.5, now).room)
        assertEquals(room, report(room, "a", 0.0, now).room)
        assertEquals(room, report(room, "a", -5.0, now).room)
        assertEquals(room, report(room, "a", Double.NaN, now).room)
        assertTrue(report(room, "a", 1500.0, now).room.round().reports.isNotEmpty())
    }

    @Test
    fun rejectsDuplicateAndUnknownPlayerAndNonRound() {
        val room = started("a", "b")
        val once = report(room, "a", 900.0, GO_AT + 1000).room
        val twice = report(once, "a", 800.0, GO_AT + 1010).room
        assertEquals(once, twice)
        assertEquals(room, report(room, "ghost", 900.0, GO_AT + 1000).room)
        val lob = lobby("a")
        assertEquals(lob, lob.reportFinish("a", 1, 900.0, 5000, env).room)
    }

    @Test
    fun firstReportOpensWindowAndSchedulesWake() {
        val room = started("a", "b")
        val step = report(room, "a", 900.0, GO_AT + 1000)
        assertEquals(GO_AT + 1150, step.room.round().windowEndsAt)
        assertEquals(GO_AT + 1150, step.wakeAt)
        assertTrue(step.events.isEmpty())
    }

    @Test
    fun windowCloseLowestTimeWins() {
        var room = started("a", "b")
        room = report(room, "a", 900.0, GO_AT + 1000).room
        room = report(room, "b", 880.0, GO_AT + 1100).room // arrives later, faster
        assertEquals(room.round().windowEndsAt, GO_AT + 1150)
        assertTrue(room.tick(GO_AT + 1149, env).events.isEmpty())
        val step = room.tick(GO_AT + 1150, env)
        val end = step.event<RoomEvent.RoundEnded>()
        assertEquals("b", end.winnerId)
        assertEquals(EndReason.Finish, end.reason)
        assertEquals(listOf("b", "a"), end.times.map { it.playerId })
        assertEquals(mapOf("a" to 0, "b" to 1), end.wins)
        assertEquals(GO_AT + 1150 + 5000, end.nextRoundAt)
        assertNull(end.matchWinnerId)
        assertEquals(1, step.room.players.first { it.id == "b" }.wins)
        assertEquals(GO_AT + 6150, step.wakeAt)
    }

    @Test
    fun tieGoesToEarlierArrival() {
        var room = started("a", "b")
        room = report(room, "b", 900.0, GO_AT + 1000).room
        room = report(room, "a", 900.0, GO_AT + 1010).room
        assertEquals("b", room.tick(GO_AT + 1150, env).event<RoomEvent.RoundEnded>().winnerId)
    }

    @Test
    fun reportAfterWindowIsRejected() {
        var room = started("a", "b")
        room = report(room, "a", 900.0, GO_AT + 1000).room
        assertEquals(room, report(room, "b", 800.0, GO_AT + 1150).room)
        assertNotEquals(room, report(room, "b", 800.0, GO_AT + 1149).room)
    }

    // --- timeout ---

    @Test
    fun timeoutAtGoAtPlus120000() {
        val room = started("a", "b")
        assertEquals(GO_AT + 120_000, room.wakeAt)
        assertTrue(room.tick(GO_AT + 119_999, env).events.isEmpty())
        val step = room.tick(GO_AT + 120_000, env)
        val end = step.event<RoomEvent.RoundEnded>()
        assertEquals(EndReason.Timeout, end.reason)
        assertNull(end.winnerId)
        assertTrue(end.times.isEmpty())
        assertEquals(GO_AT + 125_000, end.nextRoundAt)
        assertEquals(1, step.events.size) // no wins changed, so no roomState
    }

    @Test
    fun reportAtTimeoutIsRejected() {
        val room = started("a")
        assertEquals(room, room.reportFinish("a", 1, 100.0, GO_AT + 120_000, env).room)
    }

    // --- skip ---

    @Test
    fun skipVotesCountedIdempotentlyAndAnnounced() {
        val room = started("a", "b", "c")
        val one = room.voteSkip("a", 1, 100, env)
        assertEquals(RoomEvent.SkipVotesChanged(1, 1, 3), one.event<RoomEvent.SkipVotesChanged>())
        val dup = one.room.voteSkip("a", 1, 100, env)
        assertEquals(one.room, dup.room)
        assertTrue(dup.events.isEmpty())
    }

    @Test
    fun skipIgnoredForWrongRoundLobbyOrUnknownPlayer() {
        val room = started("a", "b")
        assertEquals(room, room.voteSkip("a", 2, 100, env).room)
        assertEquals(room, room.voteSkip("ghost", 1, 100, env).room)
        val lob = lobby("a")
        assertEquals(lob, lob.voteSkip("a", 1, 100, env).room)
    }

    @Test
    fun unanimousSkipEndsRoundWithNoWinner() {
        var room = started("a", "b")
        room = room.voteSkip("a", 1, 100, env).room
        val step = room.voteSkip("b", 1, 200, env)
        assertEquals(RoomEvent.SkipVotesChanged(1, 2, 2), step.events[0])
        val end = step.events[1] as RoomEvent.RoundEnded
        assertEquals(EndReason.Skipped, end.reason)
        assertNull(end.winnerId)
        assertEquals(5200, end.nextRoundAt)
        assertEquals(5200, step.wakeAt)
    }

    @Test
    fun singlePlayerSkipsAlone() {
        val end = started("a").voteSkip("a", 1, 100, env).events.last()
        assertEquals(EndReason.Skipped, (end as RoomEvent.RoundEnded).reason)
    }

    @Test
    fun leaveRecomputesNeededAndCanTriggerSkip() {
        var room = started("a", "b", "c")
        room = room.voteSkip("a", 1, 100, env).room
        room = room.voteSkip("b", 1, 100, env).room
        val step = room.leave("c", 200, env)
        assertIs<RoomEvent.PlayerLeft>(step.events[0])
        assertIs<RoomEvent.StateChanged>(step.events[1])
        assertEquals(RoomEvent.SkipVotesChanged(1, 2, 2), step.events[2])
        assertEquals(EndReason.Skipped, step.event<RoomEvent.RoundEnded>().reason)
    }

    @Test
    fun leaveRemovesTheLeaversVote() {
        var room = started("a", "b", "c")
        room = room.voteSkip("a", 1, 100, env).room
        val step = room.leave("a", 200, env)
        assertEquals(RoomEvent.SkipVotesChanged(1, 0, 2), step.event<RoomEvent.SkipVotesChanged>())
        assertTrue(step.events.none { it is RoomEvent.RoundEnded })
    }

    // --- leave mid-round ---

    @Test
    fun leaverReportIsDroppedAndWindowReopensToTimeout() {
        var room = started("a", "b")
        room = report(room, "a", 900.0, GO_AT + 1000).room
        val step = room.leave("a", GO_AT + 1050, env)
        assertNull(step.room.round().windowEndsAt)
        assertEquals(GO_AT + 120_000, step.wakeAt)
    }

    // --- after round / match ---

    @Test
    fun nextRoundStartsAtNextRoundAt() {
        val room = started("a", "b").winRound("a")
        val nextAt = room.wakeAt!!
        assertTrue(room.tick(nextAt - 1, env).events.isEmpty())
        val step = room.tick(nextAt, env)
        val plan = step.event<RoomEvent.RoundStarted>().plan
        assertEquals(2, plan.round)
        assertEquals(5, plan.difficulty)
        assertEquals(nextAt + 500, plan.exploreAt)
        assertEquals(1, step.room.players.first { it.id == "a" }.wins)
    }

    @Test
    fun matchOverThenLobbyAfter5000WithWinsReset() {
        var room = started("a", "b", settings = Settings(1, 4))
        room = room.reportFinish("a", 1, 1000.0, GO_AT + 1000, env).room
        val ended = room.tick(GO_AT + 1150, env)
        val end = ended.event<RoomEvent.RoundEnded>()
        assertEquals("a", end.matchWinnerId)
        assertNull(end.nextRoundAt)
        assertIs<RoomEvent.StateChanged>(ended.events.last())
        assertEquals(GO_AT + 31_150, ended.wakeAt)
        val over = ended.room
        assertTrue(over.tick(GO_AT + 31_149, env).events.isEmpty())
        val back = over.tick(GO_AT + 31_150, env)
        assertEquals(Phase.Lobby, back.room.phase)
        assertTrue(back.room.players.all { it.wins == 0 })
        assertIs<RoomEvent.StateChanged>(back.events.single())
        assertNull(back.wakeAt)
        // rematch works and starts again at round 1
        assertEquals(1, back.room.startMatch("a", 0, env).event<RoomEvent.RoundStarted>().plan.round)
        // and joins are allowed again
        assertTrue(back.room.join("c", "carol", "Red", "b1") is JoinOutcome.Accepted)
    }

    @Test
    fun matchContinuesUntilWinsToMatchReached() {
        var room = started("a", "b", settings = Settings(3, 4))
        repeat(2) {
            room = room.winRound("a")
            assertIs<Phase.Results>(room.phase)
            room = room.tick(room.wakeAt!!, env).room
        }
        val last = room.round()
        val r = room.reportFinish("a", last.plan.round, 500.0, last.plan.goAt + 600, env).room
        val end = r.tick(r.round().windowEndsAt!!, env).event<RoomEvent.RoundEnded>()
        assertEquals(3, end.wins["a"])
        assertEquals("a", end.matchWinnerId)
    }

    @Test
    fun roomStateFollowsWinsAfterRound() {
        val step = started("a", "b").let {
            val r = it.reportFinish("b", 1, 800.0, GO_AT + 900, env).room
            r.tick(GO_AT + 1050, env)
        }
        assertIs<RoomEvent.RoundEnded>(step.events[0])
        assertEquals(listOf(0, 1), (step.events[1] as RoomEvent.StateChanged).room.players.map { it.wins })
    }

    // --- return to lobby ---

    private fun matchOver(vararg ids: String): Room =
        started(*ids, settings = Settings(1, 4)).winRound(ids.first())

    @Test
    fun matchEndSendsEmptyLobbyReturnRightAfterRoundEnd() {
        var room = started("a", "b", settings = Settings(1, 4))
        room = room.reportFinish("a", 1, 1000.0, GO_AT + 1000, env).room
        val step = room.tick(GO_AT + 1150, env)
        assertIs<RoomEvent.RoundEnded>(step.events[0])
        assertEquals(RoomEvent.LobbyReturn(emptyList(), GO_AT + 31_150), step.events[1])
    }

    @Test
    fun allReturnedGoesToLobbyEarly() {
        val over = matchOver("a", "b")
        val one = over.returnToLobby("a")
        assertEquals(RoomEvent.LobbyReturn(listOf("a"), (over.phase as Phase.MatchOver).lobbyAt), one.events.single())
        assertIs<Phase.MatchOver>(one.room.phase)
        val two = one.room.returnToLobby("b")
        assertEquals(listOf("a", "b"), (two.events[0] as RoomEvent.LobbyReturn).returned)
        val state = (two.events[1] as RoomEvent.StateChanged).room
        assertEquals(Phase.Lobby, state.phase)
        assertTrue(state.players.all { it.wins == 0 })
        assertNull(two.wakeAt)
    }

    @Test
    fun duplicateReturnIsNoop() {
        val one = matchOver("a", "b").returnToLobby("a").room
        val again = one.returnToLobby("a")
        assertEquals(one, again.room)
        assertTrue(again.events.isEmpty())
    }

    @Test
    fun returnOutsideWaitIsIgnored() {
        for (room in listOf(lobby("a"), started("a", "b"), started("a", "b").winRound("a"))) {
            val step = room.returnToLobby("a")
            assertEquals(room, step.room)
            assertTrue(step.events.isEmpty())
        }
        val over = matchOver("a", "b")
        assertTrue(over.returnToLobby("ghost").events.isEmpty())
    }

    @Test
    fun leaveCanCompleteTheWait() {
        val over = matchOver("a", "b", "c").returnToLobby("a").room.returnToLobby("b").room
        val step = over.leave("c", 0, env)
        assertIs<RoomEvent.PlayerLeft>(step.events[0])
        assertIs<RoomEvent.StateChanged>(step.events[1])
        assertEquals(listOf("a", "b"), (step.events[2] as RoomEvent.LobbyReturn).returned)
        assertEquals(Phase.Lobby, (step.events[3] as RoomEvent.StateChanged).room.phase)
        assertEquals(Phase.Lobby, step.room.phase)
    }

    @Test
    fun leaveDropsReturnedPlayerAndAnnounces() {
        val over = matchOver("a", "b", "c").returnToLobby("a").room
        val step = over.leave("a", 0, env)
        assertEquals(emptyList(), step.event<RoomEvent.LobbyReturn>().returned)
        assertIs<Phase.MatchOver>(step.room.phase)
    }

    @Test
    fun joinDuringWaitStillInProgress() =
        assertEquals(JoinRejection.InProgress, reject(matchOver("a", "b").returnToLobby("a").room))

    @Test
    fun timeoutAtLobbyAtForcesLobby() {
        val over = matchOver("a", "b").returnToLobby("a").room
        val at = (over.phase as Phase.MatchOver).lobbyAt
        assertEquals(at, over.wakeAt)
        assertTrue(over.tick(at - 1, env).events.isEmpty())
        assertEquals(Phase.Lobby, over.tick(at, env).room.phase)
    }
}
