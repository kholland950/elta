package com.kholland.race

import kotlin.random.Random
import kotlin.test.*

class ArchetypeTest {
    @Test
    fun wireStringsAreTheFiveLegalValues() =
        assertEquals(listOf("tower", "descent", "labyrinth", "speedway", "canyon"), Archetype.entries.map { it.wire })

    @Test
    fun thousandDrawsNeverRepeatAndEveryWindowOfFiveIsAPermutation() {
        for (seed in 0..4) {
            val rng = Random(seed)
            var bag = ArchetypeBag()
            val drawn = List(1000) { bag.draw(rng).let { (a, b) -> bag = b; a } }
            drawn.zipWithNext().forEach { (x, y) -> assertNotEquals(x, y) }
            drawn.chunked(5).forEach { assertEquals(Archetype.entries.toSet(), it.toSet()) }
        }
    }
}
