package com.kholland.race

import kotlin.random.Random

/** All durations in milliseconds. Defaults are the production values from the slice 2 contract. */
data class Timings(
    val exploreLeadMs: Long = 500,
    val exploreMs: Long = 15_000,
    val goDelayMs: Long = 3_500,
    val finishWindowMs: Long = 150,
    val resultsMs: Long = 5_000,
    val matchOverMs: Long = 30_000,
    val roundTimeoutMs: Long = 120_000,
    val plausibilitySlackMs: Long = 500,
)

/** Everything the pure core needs from the outside world besides `now`. */
data class RoomEnv(val timings: Timings = Timings(), val rng: Random = Random.Default)
