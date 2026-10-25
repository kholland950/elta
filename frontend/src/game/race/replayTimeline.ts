// Relative imports: vitest has no path aliases
import type { RoundEndReason } from './protocol'

/**
 * The round-end sequence every client plays from the server's `endedAt`: disintegrate, a pause,
 * zoom out to frame every player, the trail replay, zoom in on the winner, the winner's victory
 * lap, then the results panel. The fixed beats must match the server's Timings.kt, which sizes
 * the wait before the next round. The replay beat's length comes with the round end
 * (`RoundEndMessage.replayMs`, the race replayed at 2×); `replay` here is only the fallback for
 * an older server that doesn't send it.
 */
export const BEAT_MS = {
  disintegrate: 1200,
  pause: 500,
  zoomOut: 800,
  replay: 2500,
  zoomIn: 800,
  victoryLap: 4000,
  results: 3000,
} as const

export type BeatKind = keyof typeof BEAT_MS

const SEQUENCE: Record<RoundEndReason, readonly BeatKind[]> = {
  finish: ['disintegrate', 'pause', 'zoomOut', 'replay', 'zoomIn', 'victoryLap', 'results'],
  timeout: ['disintegrate', 'pause', 'zoomOut', 'replay', 'results'],
  skipped: ['results'],
}

export interface Segment {
  kind: BeatKind
  startAt: number
  endAt: number
}

/** The beat at some moment: `p` runs 0..1 through it, and `leftMs` is the time until it ends. */
export interface Beat {
  kind: BeatKind
  p: number
  leftMs: number
}

export type Timeline = readonly Segment[]

/** How much faster than real time the trail replay runs. */
export const REPLAY_SPEED = 2

const beatMs = (kind: BeatKind, replayBeatMs: number | undefined): number =>
  kind === 'replay' ? Math.max(0, replayBeatMs ?? BEAT_MS.replay) : BEAT_MS[kind]

/** `replayBeatMs` is the round end's `replayMs`; without it the replay beat is `BEAT_MS.replay`. */
export const replayTimeline = (reason: RoundEndReason, endedAt: number, replayBeatMs?: number): Timeline => {
  let at = endedAt
  return SEQUENCE[reason].map((kind) => {
    const startAt = at
    at += beatMs(kind, replayBeatMs)
    return { kind, startAt, endAt: at }
  })
}

/** Time from `endedAt` to the results panel (the whole sequence before it, for this reason). */
export const replayMs = (reason: RoundEndReason, replayBeatMs?: number): number =>
  SEQUENCE[reason].reduce((sum, kind) => (kind === 'results' ? sum : sum + beatMs(kind, replayBeatMs)), 0)

/** The fixed beats before the results panel: the server's sum, the replay beat left out. */
export const fixedReplayMs = (reason: RoundEndReason): number =>
  SEQUENCE[reason].reduce((sum, kind) => (kind === 'results' || kind === 'replay' ? sum : sum + BEAT_MS[kind]), 0)

const indexAt = (tl: Timeline, now: number): number => {
  for (let i = 0; i < tl.length; i++) if (now < tl[i].endAt) return i
  return tl.length - 1
}

/** Before `endedAt` this is the first beat at p = 0; after the end it stays on the last beat. */
export const beatAt = (tl: Timeline, now: number): Beat => {
  const seg = tl[indexAt(tl, now)]
  const len = seg.endAt - seg.startAt
  const p = len > 0 ? Math.min(1, Math.max(0, (now - seg.startAt) / len)) : 1
  return { kind: seg.kind, p, leftMs: Math.max(0, seg.endAt - now) }
}

/** When the results panel appears. `receivedAt` stands in for `endedAt` on older servers. */
export const resultsShownAt = (
  end: { reason: RoundEndReason; endedAt?: number; replayMs?: number },
  receivedAt: number,
): number => (end.endedAt ?? receivedAt) + replayMs(end.reason, end.replayMs)

/**
 * Walks a timeline frame by frame and reports every beat entered since the last call, in order,
 * so enter hooks still run when a hidden tab skips straight past a beat.
 */
export class ReplayCursor {
  private next = 0

  constructor(private readonly tl: Timeline) {}

  advance(now: number): { beat: Beat; entered: BeatKind[] } {
    const entered: BeatKind[] = []
    while (this.next < this.tl.length && now >= this.tl[this.next].startAt) entered.push(this.tl[this.next++].kind)
    return { beat: beatAt(this.tl, now), entered }
  }
}
