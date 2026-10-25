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
        val t = ChatThrottle(burst = 3, windowMs = 1_000, muteMs = 500)
        assertEquals(List(3) { ChatVerdict.Allowed }, (0..2).map { t.check("a", 100L + it) })
        assertEquals(ChatVerdict.Allowed, t.check("b", 103), "players are throttled separately")
        assertEquals(ChatVerdict.Allowed, t.check("a", 1_100), "the first message has left the window")
    }

    @Test
    fun goingOverTheLimitMutesOnceThenStartsAfresh() {
        val t = ChatThrottle(burst = 2, windowMs = 1_000, muteMs = 500)
        t.check("a", 0)
        t.check("a", 1)
        assertEquals(ChatVerdict.Muted, t.check("a", 2))
        assertEquals(ChatVerdict.Dropped, t.check("a", 3))
        assertEquals(ChatVerdict.Dropped, t.check("a", 501))
        assertEquals(ChatVerdict.Allowed, t.check("a", 502))
        assertEquals(ChatVerdict.Allowed, t.check("a", 503), "the burst before the mute no longer counts")
    }

    @Test
    fun forgetClearsAPlayer() {
        val t = ChatThrottle(burst = 1, windowMs = 1_000)
        t.check("a", 0)
        assertEquals(ChatVerdict.Muted, t.check("a", 1))
        t.forget("a")
        assertEquals(ChatVerdict.Allowed, t.check("a", 2))
    }
}
