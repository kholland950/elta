package com.kholland.race

import kotlin.random.Random
import kotlin.test.*

class MatchTest {
    @Test
    fun rampAddsOnePerRoundUpToThree() {
        assertEquals(listOf(4, 5, 6, 7, 7, 7), (0..5).map { Match.difficultyFor(4, it) })
    }

    @Test
    fun rampCapsAtTen() {
        assertEquals(listOf(9, 10, 10, 10), (0..3).map { Match.difficultyFor(9, it) })
        assertEquals(10, Match.difficultyFor(10, 0))
    }

    @Test
    fun seedInRange() {
        val rng = Random(1)
        repeat(10_000) { assertTrue(Match.nextSeed(rng) in 1..2_147_483_646) }
    }

    @Test
    fun isOver() {
        assertFalse(Match.isOver(2, 3))
        assertTrue(Match.isOver(3, 3))
    }

    @Test
    fun roundsInARoomUseTheRamp() {
        var room = started("a", "b", settings = Settings(7, 4))
        val difficulties = mutableListOf(room.round().plan.difficulty)
        repeat(4) {
            room = room.winRound("a")
            room = room.tick(room.wakeAt!!, env).room
            difficulties += room.round().plan.difficulty
        }
        assertEquals(listOf(4, 5, 6, 7, 7), difficulties)
    }
}
