package com.kholland.race

import kotlin.random.Random

object Match {
    const val MAX_DIFFICULTY = 10
    const val MAX_RAMP = 3
    const val MAX_SEED = 2_147_483_646

    /** Difficulty for a round; [roundIndex] is 0-based, so round 1 uses [base]. */
    fun difficultyFor(base: Int, roundIndex: Int): Int = minOf(MAX_DIFFICULTY, base + minOf(roundIndex, MAX_RAMP))

    fun isOver(wins: Int, winsToMatch: Int): Boolean = wins >= winsToMatch

    /** Random integer in [1, MAX_SEED]. */
    fun nextSeed(rng: Random): Int = rng.nextInt(1, MAX_SEED + 1)
}
