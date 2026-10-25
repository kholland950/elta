/** One line in the room chat, as shown. */
export interface ChatEntry {
  /** Unique within a log, for keyed lists. */
  key: number
  playerId: string
  name: string
  color: string
  text: string
  quick: boolean
  /** From the game, not a player: shown without a sender. */
  system: boolean
  /** Local time it arrived, in ms. */
  at: number
}

export const MAX_ENTRIES = 50
/** A closed chat shows a line this long, then fades it out over FADE_MS. */
export const SHOW_MS = 8_000
export const FADE_MS = 1_000

/** Keeps the newest MAX_ENTRIES. */
export const appendEntry = (log: ReadonlyArray<ChatEntry>, entry: ChatEntry): ChatEntry[] =>
  [...log, entry].slice(-MAX_ENTRIES)

export interface VisibleEntry {
  entry: ChatEntry
  alpha: number
}

/** Everything while chat is open; otherwise only recent lines, fading out. */
export const visibleEntries = (log: ReadonlyArray<ChatEntry>, now: number, open: boolean): VisibleEntry[] => {
  if (open) return log.map((entry) => ({ entry, alpha: 1 }))
  const out: VisibleEntry[] = []
  for (const entry of log) {
    const age = now - entry.at
    if (age >= SHOW_MS + FADE_MS) continue
    out.push({ entry, alpha: age <= SHOW_MS ? 1 : 1 - (age - SHOW_MS) / FADE_MS })
  }
  return out
}
