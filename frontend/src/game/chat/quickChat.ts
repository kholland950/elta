// Relative imports: vitest has no path aliases
import type { RoundEndReason } from '../race/protocol'
import { beatAt, replayTimeline, type BeatKind } from '../race/replayTimeline'

/** Quick-chat lines travel as ids (the server's whitelist, Chat.kt); the text lives here. */
export const QUICK_TEXT = {
  wow: 'Wow!',
  nooo: 'Nooo!',
  tooSlow: 'Too slow',
  wtf: 'WTF',
  niceTry: 'Nice try!',
  ez: 'ez',
  noProblem: 'No problem',
} as const

export type QuickLineId = keyof typeof QUICK_TEXT

const LINE_IDS: ReadonlySet<string> = new Set(Object.keys(QUICK_TEXT))

export const isQuickLineId = (id: string): id is QuickLineId => LINE_IDS.has(id)

/** Slots 1–4, in order. */
export const IN_GAME_SET: ReadonlyArray<QuickLineId> = ['wow', 'nooo', 'tooSlow', 'wtf']
export const WINNER_SET: ReadonlyArray<QuickLineId> = ['niceTry', 'ez', 'tooSlow', 'noProblem']

/** What quick chat can do right now: which lines, and whether they pop a bubble over the orb. */
export interface QuickChatMode {
  set: ReadonlyArray<QuickLineId>
  bubble: boolean
}

const LIVE: QuickChatMode = { set: IN_GAME_SET, bubble: true }
const REPLAY: QuickChatMode = { set: IN_GAME_SET, bubble: false }
const CELEBRATION: QuickChatMode = { set: WINNER_SET, bubble: true }

/**
 * By round-end beat (null: no round has ended, so live play). Everyone chats into the log during
 * the replay; the celebration belongs to the winner; the results are for typed chat only.
 */
export const modeForBeat = (beat: BeatKind | null, isWinner: boolean): QuickChatMode | null => {
  switch (beat) {
    case null:
      return LIVE
    case 'disintegrate':
    case 'pause':
    case 'zoomOut':
    case 'replay':
      return REPLAY
    case 'zoomIn':
    case 'victoryLap':
      return isWinner ? CELEBRATION : null
    case 'results':
      return null
  }
}

/** The round end being shown, timed on the server clock. */
export interface ShownEnd {
  reason: RoundEndReason
  winnerId: string | null
  endedAt: number
  replayMs?: number
}

/**
 * The quick-chat mode for `playerId` at `now`. The sender asks it for themself; a receiver asks it
 * for the sender, to decide on the bubble. Past the timeline it stays on `results`, until the next
 * round or the lobby takes the end away.
 */
export const quickChatMode = (end: ShownEnd | null, playerId: string | null, now: number): QuickChatMode | null => {
  if (!end) return modeForBeat(null, false)
  const beat = beatAt(replayTimeline(end.reason, end.endedAt, end.replayMs), now).kind
  return modeForBeat(beat, playerId !== null && playerId === end.winnerId)
}

/** The line for slot 1–4 in this mode, if any. */
export const lineForSlot = (mode: QuickChatMode | null, slot: number): QuickLineId | undefined =>
  mode?.set[slot - 1]
