package com.kholland.chat

/** Rules for room chat. Chat never touches race state, so it lives outside the pure [com.kholland.race.Room]. */
object Chat {
    const val MAX_LENGTH = 120
    const val BURST = 5
    const val WINDOW_MS = 5_000L

    /** Quick-chat lines travel as ids; the client owns the text. */
    val QUICK_LINE_IDS = setOf("wow", "nooo", "tooSlow", "wtf", "niceTry", "ez", "noProblem")

    private val control = Regex("\\p{Cntrl}")

    /** Control characters become spaces, then trimmed and capped; null when nothing is left. */
    fun sanitize(raw: String): String? =
        raw.replace(control, " ").trim().take(MAX_LENGTH).trimEnd().ifEmpty { null }
}

/** At most [Chat.BURST] messages per player in any [Chat.WINDOW_MS]. Owned by one room actor, so not thread-safe. */
class ChatThrottle(private val burst: Int = Chat.BURST, private val windowMs: Long = Chat.WINDOW_MS) {
    private val sent = HashMap<String, ArrayDeque<Long>>()

    /** Records the message when it is allowed. */
    fun allow(playerId: String, nowMs: Long): Boolean {
        val times = sent.getOrPut(playerId) { ArrayDeque() }
        while (times.isNotEmpty() && nowMs - times.first() >= windowMs) times.removeFirst()
        if (times.size >= burst) return false
        times.addLast(nowMs)
        return true
    }

    fun forget(playerId: String) {
        sent.remove(playerId)
    }
}
