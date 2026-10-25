package com.kholland.chat

import kotlin.test.*

class ChatTest {
    @Test
    fun sanitizeTrimsAndDropsEmpty() {
        assertEquals("hi there", Chat.sanitize("  hi there \n"))
        assertNull(Chat.sanitize("   "))
        assertNull(Chat.sanitize("\u0000\t\n"))
    }

    @Test
    fun sanitizeReplacesControlCharacters() {
        assertEquals("a b", Chat.sanitize("a\u0007b"))
    }

    @Test
    fun sanitizeCapsLength() {
        assertEquals(Chat.MAX_LENGTH, Chat.sanitize("x".repeat(500))!!.length)
    }

    @Test
    fun quickLinesAreAWhitelist() {
        assertTrue("ez" in Chat.QUICK_LINE_IDS)
        assertFalse("Wow!" in Chat.QUICK_LINE_IDS)
    }

    @Test
    fun throttleAllowsABurstPerWindow() {
        val t = ChatThrottle(burst = 3, windowMs = 1_000)
        assertEquals(listOf(true, true, true, false), (0..3).map { t.allow("a", 100L + it) })
        assertTrue(t.allow("b", 103), "players are throttled separately")
        assertFalse(t.allow("a", 1_099))
        assertTrue(t.allow("a", 1_100), "the first message has left the window")
    }

    @Test
    fun forgetClearsAPlayer() {
        val t = ChatThrottle(burst = 1, windowMs = 1_000)
        assertTrue(t.allow("a", 0))
        t.forget("a")
        assertTrue(t.allow("a", 1))
    }
}
