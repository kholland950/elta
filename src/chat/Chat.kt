package com.kholland.chat

/** Rules for room chat. Chat never touches race state, so it lives outside the pure [com.kholland.race.Room]. */
object Chat {
    const val MAX_LENGTH = 120
    const val BURST = 5
    const val WINDOW_MS = 5_000L
    const val MUTE_MS = 3_000L

    /** Quick-chat lines travel as ids; the client owns the text. */
    val QUICK_LINE_IDS = setOf("wow", "nooo", "tooSlow", "wtf", "niceTry", "ez", "noProblem")

    private val control = Regex("\\p{Cntrl}")

    /** Control characters become spaces, then trimmed and capped; null when nothing is left. */
    fun sanitize(raw: String): String? =
        raw.replace(control, " ").trim().take(MAX_LENGTH).trimEnd().ifEmpty { null }
}

enum class ChatVerdict {
    Allowed,

    /** Over the limit: muted from now, and told so once. */
    Muted,

    /** Sent while muted: dropped without another notice. */
    Dropped,
}

/**
 * At most [Chat.BURST] messages per player in any [Chat.WINDOW_MS]; one more mutes them for [Chat.MUTE_MS],
 * after which they start afresh. Owned by one room actor, so not thread-safe.
 */
class ChatThrottle(
    private val burst: Int = Chat.BURST,
    private val windowMs: Long = Chat.WINDOW_MS,
    private val muteMs: Long = Chat.MUTE_MS,
) {
    private val sent = HashMap<String, ArrayDeque<Long>>()
    private val mutedUntil = HashMap<String, Long>()

    /** Records the message when it is allowed. */
    fun check(playerId: String, nowMs: Long): ChatVerdict {
        mutedUntil[playerId]?.let { until ->
            if (nowMs < until) return ChatVerdict.Dropped
            mutedUntil.remove(playerId)
        }
        val times = sent.getOrPut(playerId) { ArrayDeque() }
        while (times.isNotEmpty() && nowMs - times.first() >= windowMs) times.removeFirst()
        if (times.size >= burst) {
            times.clear()
            mutedUntil[playerId] = nowMs + muteMs
            return ChatVerdict.Muted
        }
        times.addLast(nowMs)
        return ChatVerdict.Allowed
    }

    fun forget(playerId: String) {
        sent.remove(playerId)
        mutedUntil.remove(playerId)
    }
}
