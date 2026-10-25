package com.kholland.race

import kotlin.random.Random

/** All durations in milliseconds. Defaults are the production values from the slice 2 contract. */
data class Timings(
    val exploreLeadMs: Long = 500,
    val exploreMs: Long = 15_000,
    val goDelayMs: Long = 3_500,
    val finishWindowMs: Long = 150,
    /** The results panel, shown after any replay sequence. */
    val resultsMs: Long = 3_000,
    /**
     * The fixed beats of the client replay after a finish: disintegrate, pause, zoom out, zoom in
     * and victory lap (see frontend race/replayTimeline.ts). The trail replay comes on top.
     */
    val replayFinishMs: Long = 7_300,
    /** The fixed beats after a timeout: disintegrate, pause, zoom out. */
    val replayTimeoutMs: Long = 2_500,
    /** The trail replay plays the race this many times faster than it ran. */
    val replaySpeed: Long = 2,
    val matchOverMs: Long = 30_000,
    val roundTimeoutMs: Long = 120_000,
    val plausibilitySlackMs: Long = 500,
) {
    /** Length of the trail replay for a race that ran [raceMs]; none after a skip. */
    fun trailReplayMs(reason: EndReason, raceMs: Long): Long =
        if (reason == EndReason.Skipped) 0 else raceMs.coerceAtLeast(0) / replaySpeed

    /** From the round's end to the results panel. */
    fun replayMs(reason: EndReason, raceMs: Long): Long = trailReplayMs(reason, raceMs) + when (reason) {
        EndReason.Finish -> replayFinishMs
        EndReason.Timeout -> replayTimeoutMs
        EndReason.Skipped -> 0
    }

    fun resultsWaitMs(reason: EndReason, raceMs: Long): Long = replayMs(reason, raceMs) + resultsMs
}

/** Everything the pure core needs from the outside world besides `now`. */
data class RoomEnv(val timings: Timings = Timings(), val rng: Random = Random.Default)
