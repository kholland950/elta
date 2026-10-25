package com.kholland.race

import java.io.File
import kotlin.test.*

class PaletteTest {
    @Test
    fun matchesTheFrontendPalette() {
        val source = File("frontend/src/game/profile/palette.ts").readText()
        val names = Regex("""name: '(\w+)'""").findAll(source).map { it.groupValues[1] }.toList()
        assertEquals(ORB_COLORS.toList(), names)
    }

    @Test
    fun hasThirtyTwoColorsIncludingTheOriginalSix() {
        assertEquals(32, ORB_COLORS.size)
        assertTrue(ORB_COLORS.containsAll(listOf("Blue", "Green", "Orange", "Red", "Violet", "Yellow")))
    }
}
