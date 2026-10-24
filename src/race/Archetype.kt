package com.kholland.race

import kotlin.random.Random

enum class Archetype(val wire: String) {
    Tower("tower"),
    Descent("descent"),
    Labyrinth("labyrinth"),
    Speedway("speedway"),
    Canyon("canyon"),
}

/**
 * Shuffle-bag of archetypes. Each bag holds all five once, so every aligned window of five draws is a
 * permutation, and a refill never starts with the archetype drawn just before it.
 */
data class ArchetypeBag(val pending: List<Archetype> = emptyList(), val last: Archetype? = null) {
    fun draw(rng: Random): Pair<Archetype, ArchetypeBag> {
        var bag = pending
        if (bag.isEmpty()) {
            val fresh = Archetype.entries.shuffled(rng).toMutableList()
            if (fresh.first() == last) {
                val j = rng.nextInt(1, fresh.size)
                fresh[0] = fresh[j].also { fresh[j] = fresh[0] }
            }
            bag = fresh
        }
        val picked = bag.first()
        return picked to ArchetypeBag(bag.drop(1), picked)
    }
}
