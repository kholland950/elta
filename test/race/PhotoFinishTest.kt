package com.kholland.race

import kotlin.test.*

class PhotoFinishTest {
    @Test
    fun lowestTimeWins() {
        val r = listOf(Report("a", 5000.0, 10), Report("b", 4900.0, 20))
        assertEquals("b", PhotoFinish.winner(r)?.playerId)
    }

    @Test
    fun tieGoesToEarlierArrival() {
        val r = listOf(Report("a", 5000.0, 10), Report("b", 5000.0, 20))
        assertEquals("a", PhotoFinish.winner(r)?.playerId)
        assertEquals(listOf("a", "b"), PhotoFinish.ranked(r).map { it.playerId })
        assertEquals("b", PhotoFinish.winner(r.reversed())?.playerId)
    }

    @Test
    fun noReportsNoWinner() = assertNull(PhotoFinish.winner(emptyList()))

    @Test
    fun plausibility() {
        assertTrue(PhotoFinish.isPlausible(1000.0, 11_000, 10_000, 500))
        assertTrue(PhotoFinish.isPlausible(1500.0, 11_000, 10_000, 500))
        assertFalse(PhotoFinish.isPlausible(1500.1, 11_000, 10_000, 500))
        assertFalse(PhotoFinish.isPlausible(0.0, 11_000, 10_000, 500))
        assertFalse(PhotoFinish.isPlausible(-1.0, 11_000, 10_000, 500))
        assertFalse(PhotoFinish.isPlausible(Double.NaN, 11_000, 10_000, 500))
        assertFalse(PhotoFinish.isPlausible(Double.POSITIVE_INFINITY, 11_000, 10_000, 500))
    }
}
