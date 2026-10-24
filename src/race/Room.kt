package com.kholland.race

data class Player(val id: String, val name: String, val color: String, val wins: Int = 0)

data class Settings(val winsToMatch: Int = 3, val difficulty: Int = 4)

/** Result of a transition: the new room, events to broadcast in order, and when to call [Room.tick] next. */
data class Step(val room: Room, val events: List<RoomEvent> = emptyList(), val wakeAt: Long? = room.wakeAt)

sealed interface JoinOutcome {
    data class Accepted(val step: Step) : JoinOutcome
    data class Rejected(val reason: JoinRejection) : JoinOutcome
}

data class Room(
    val id: String,
    val build: String? = null,
    val hostId: String? = null,
    val settings: Settings = Settings(),
    val players: List<Player> = emptyList(),
    val phase: Phase = Phase.Lobby,
    val round: Int = 0,
    val archetypeBag: ArchetypeBag = ArchetypeBag(),
) {
    val wakeAt: Long?
        get() = when (val p = phase) {
            Phase.Lobby -> null
            is Phase.Round -> p.windowEndsAt ?: p.timeoutAt
            is Phase.Results -> p.nextAt
            is Phase.MatchOver -> p.lobbyAt
        }

    fun join(playerId: String, name: String, color: String, build: String): JoinOutcome {
        if (!validName(name) || color !in COLORS) return JoinOutcome.Rejected(JoinRejection.BadName)
        if (this.build != null && this.build != build) return JoinOutcome.Rejected(JoinRejection.StaleBuild)
        if (phase != Phase.Lobby) return JoinOutcome.Rejected(JoinRejection.InProgress)
        if (players.size >= MAX_PLAYERS) return JoinOutcome.Rejected(JoinRejection.Full)
        val next = copy(
            build = this.build ?: build,
            hostId = hostId ?: playerId,
            players = players + Player(playerId, name, color),
        )
        return JoinOutcome.Accepted(Step(next, listOf(RoomEvent.StateChanged(next))))
    }

    fun leave(playerId: String, now: Long, env: RoomEnv): Step {
        if (players.none { it.id == playerId }) return Step(this)
        val remaining = players.filterNot { it.id == playerId }
        val host = if (hostId == playerId) remaining.firstOrNull()?.id else hostId
        var next = copy(players = remaining, hostId = host)
        if (remaining.isEmpty()) return Step(next.copy(phase = Phase.Lobby, round = 0))

        val tail = mutableListOf<RoomEvent>()
        val p = next.phase
        if (p is Phase.Round) {
            val reports = p.reports.filterNot { it.playerId == playerId }
            val votes = p.skipVotes - playerId
            val updated = p.copy(
                reports = reports,
                skipVotes = votes,
                windowEndsAt = if (reports.isEmpty()) null else p.windowEndsAt,
            )
            next = next.copy(phase = updated)
            tail += RoomEvent.SkipVotesChanged(p.plan.round, votes.size, remaining.size)
            if (updated.windowEndsAt == null && votes.size >= remaining.size) {
                val (ended, events) = next.finishRound(updated, EndReason.Skipped, null, now, env)
                next = ended
                tail += events
            }
        }
        var leftState = next
        if (p is Phase.MatchOver) {
            leftState = next
            val returned = p.returned - playerId
            next = next.copy(phase = p.copy(returned = returned))
            tail += RoomEvent.LobbyReturn(returned.toList(), p.lobbyAt)
            if (returned.size >= remaining.size) {
                val lobby = next.backToLobby()
                next = lobby
                tail += RoomEvent.StateChanged(lobby)
            }
        }
        // The room state is built from the final `next`, but must be sent before the round events.
        val state = RoomEvent.StateChanged(if (p is Phase.MatchOver) leftState else next)
        return Step(next, listOf(RoomEvent.PlayerLeft(playerId), state) + tail)
    }

    fun updateSettings(playerId: String, winsToMatch: Int, difficulty: Int): Step {
        if (playerId != hostId || phase != Phase.Lobby) return Step(this)
        if (winsToMatch !in WINS_TO_MATCH || difficulty !in 1..Match.MAX_DIFFICULTY) return Step(this)
        val s = Settings(winsToMatch, difficulty)
        if (s == settings) return Step(this)
        val next = copy(settings = s)
        return Step(next, listOf(RoomEvent.StateChanged(next)))
    }

    fun startMatch(playerId: String, now: Long, env: RoomEnv): Step {
        if (playerId != hostId || phase != Phase.Lobby || players.isEmpty()) return Step(this)
        val fresh = copy(players = players.map { it.copy(wins = 0) }, round = 0)
        val (next, started) = fresh.beginRound(now, env)
        return Step(next, listOf(RoomEvent.StateChanged(next), started))
    }

    fun reportFinish(playerId: String, round: Int, raceTimeMs: Double, now: Long, env: RoomEnv): Step {
        val p = phase as? Phase.Round ?: return Step(this)
        if (players.none { it.id == playerId } || p.plan.round != round) return Step(this)
        if (now <= p.plan.goAt) return Step(this)
        if (!PhotoFinish.isPlausible(raceTimeMs, now, p.plan.goAt, env.timings.plausibilitySlackMs)) return Step(this)
        if (p.reports.any { it.playerId == playerId }) return Step(this)
        val closesAt = p.windowEndsAt
        if (closesAt != null && now >= closesAt) return Step(this)
        if (closesAt == null && now >= p.timeoutAt) return Step(this)
        val updated = p.copy(
            reports = p.reports + Report(playerId, raceTimeMs, now),
            windowEndsAt = closesAt ?: (now + env.timings.finishWindowMs),
        )
        return Step(copy(phase = updated))
    }

    fun voteSkip(playerId: String, round: Int, now: Long, env: RoomEnv): Step {
        val p = phase as? Phase.Round ?: return Step(this)
        if (players.none { it.id == playerId } || p.plan.round != round) return Step(this)
        if (p.windowEndsAt != null || playerId in p.skipVotes) return Step(this)
        val updated = p.copy(skipVotes = p.skipVotes + playerId)
        val changed = copy(phase = updated)
        val votesEvent = RoomEvent.SkipVotesChanged(round, updated.skipVotes.size, players.size)
        if (updated.skipVotes.size < players.size) return Step(changed, listOf(votesEvent))
        val (ended, events) = changed.finishRound(updated, EndReason.Skipped, null, now, env)
        return Step(ended, listOf(votesEvent) + events)
    }

    fun returnToLobby(playerId: String): Step {
        val p = phase as? Phase.MatchOver ?: return Step(this)
        if (players.none { it.id == playerId } || playerId in p.returned) return Step(this)
        val returned = p.returned + playerId
        val next = copy(phase = p.copy(returned = returned))
        val announce = RoomEvent.LobbyReturn(returned.toList(), p.lobbyAt)
        if (returned.size < players.size) return Step(next, listOf(announce))
        val lobby = next.backToLobby()
        return Step(lobby, listOf(announce, RoomEvent.StateChanged(lobby)))
    }

    private fun backToLobby(): Room =
        copy(players = players.map { it.copy(wins = 0) }, phase = Phase.Lobby, round = 0)

    fun tick(now: Long, env: RoomEnv): Step = when (val p = phase) {
        Phase.Lobby -> Step(this)
        is Phase.Round -> {
            val closesAt = p.windowEndsAt
            if (closesAt != null) {
                if (now >= closesAt) {
                    val winner = PhotoFinish.winner(p.reports)?.playerId
                    val (ended, events) = finishRound(p, EndReason.Finish, winner, now, env)
                    Step(ended, events)
                } else Step(this)
            } else if (now >= p.timeoutAt) {
                val (ended, events) = finishRound(p, EndReason.Timeout, null, now, env)
                Step(ended, events)
            } else Step(this)
        }
        is Phase.Results ->
            if (now >= p.nextAt) {
                val (next, started) = beginRound(now, env)
                Step(next, listOf(started))
            } else Step(this)
        is Phase.MatchOver ->
            if (now >= p.lobbyAt) {
                val next = backToLobby()
                Step(next, listOf(RoomEvent.StateChanged(next)))
            } else Step(this)
    }

    private fun beginRound(now: Long, env: RoomEnv): Pair<Room, RoomEvent.RoundStarted> {
        val t = env.timings
        val n = round + 1
        val exploreAt = now + t.exploreLeadMs
        val snapAt = exploreAt + t.exploreMs
        val goAt = snapAt + t.goDelayMs
        val seed = Match.nextSeed(env.rng)
        val startOrder = players.map { it.id }.shuffled(env.rng)
        val (archetype, bag) = archetypeBag.draw(env.rng)
        val plan = RoundPlan(
            round = n,
            seed = seed,
            difficulty = Match.difficultyFor(settings.difficulty, n - 1),
            startOrder = startOrder,
            archetype = archetype,
            exploreAt = exploreAt,
            snapAt = snapAt,
            goAt = goAt,
        )
        val next = copy(round = n, archetypeBag = bag, phase = Phase.Round(plan, timeoutAt = goAt + t.roundTimeoutMs))
        return next to RoomEvent.RoundStarted(plan)
    }

    private fun finishRound(
        p: Phase.Round,
        reason: EndReason,
        winnerId: String?,
        now: Long,
        env: RoomEnv,
    ): Pair<Room, List<RoomEvent>> {
        val scored = if (winnerId == null) players else players.map { if (it.id == winnerId) it.copy(wins = it.wins + 1) else it }
        val over = winnerId != null && Match.isOver(scored.first { it.id == winnerId }.wins, settings.winsToMatch)
        val at = now + (if (over) env.timings.matchOverMs else env.timings.resultsMs)
        val next = copy(players = scored, phase = if (over) Phase.MatchOver(at) else Phase.Results(at))
        val ended = RoomEvent.RoundEnded(
            round = p.plan.round,
            winnerId = winnerId,
            reason = reason,
            times = PhotoFinish.ranked(p.reports),
            wins = scored.associate { it.id to it.wins },
            nextRoundAt = if (over) null else at,
            matchWinnerId = if (over) winnerId else null,
        )
        val events = when {
            winnerId == null -> listOf(ended)
            over -> listOf(ended, RoomEvent.LobbyReturn(emptyList(), at), RoomEvent.StateChanged(next))
            else -> listOf(ended, RoomEvent.StateChanged(next))
        }
        return next to events
    }

    companion object {
        const val MAX_PLAYERS = 8
        val COLORS = setOf("Blue", "Green", "Orange", "Red", "Violet", "Yellow")
        val WINS_TO_MATCH = setOf(1, 3, 5, 7)
        private val NAME = Regex("^[\\w ]+$")

        fun validName(name: String): Boolean = name.length in 2..15 && NAME.matches(name)
    }
}
