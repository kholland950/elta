import type { FinishGate } from './stage'

export type { FinishGate }

/** Countdown length before GO. */
export const COUNTDOWN_MS = 3000

/**
 * When each phase of a round begins, in ms of one clock (the server clock in multiplayer; a step
 * clock for a local solo round). Explore runs from exploreAt to snapAt, the snap to start slots
 * lasts until the countdown, and the race begins at goAt.
 */
export interface RoundPlan {
  exploreAt: number
  snapAt: number
  goAt: number
}

export type RoundPhase =
  | { kind: 'waiting' }
  | { kind: 'explore' }
  | { kind: 'snap' }
  | { kind: 'countdown'; digit: number }
  | { kind: 'race' }

/** A solo round: straight to the start slot and the 3-2-1 countdown, with no explore phase. */
export const localPlan = (nowMs: number): RoundPlan => ({
  exploreAt: nowMs,
  snapAt: nowMs,
  goAt: nowMs + COUNTDOWN_MS,
})

export const roundPhaseAt = (plan: RoundPlan, nowMs: number): RoundPhase => {
  if (nowMs < plan.exploreAt) return { kind: 'waiting' }
  if (nowMs < plan.snapAt) return { kind: 'explore' }
  if (nowMs >= plan.goAt) return { kind: 'race' }
  const left = plan.goAt - nowMs
  if (left > COUNTDOWN_MS) return { kind: 'snap' }
  return { kind: 'countdown', digit: Math.ceil(left / 1000) }
}

/** Orbs are held at their start slots from the snap until GO. */
export const controlsLocked = (phase: RoundPhase): boolean =>
  phase.kind === 'snap' || phase.kind === 'countdown'

const inGate = (gate: FinishGate, p: { x: number; y: number }) =>
  p.x >= gate.x && p.y >= gate.top && p.y <= gate.bottom

/**
 * Race time of the step that moved the orb from `prev` into the finish region, interpolated to
 * where on that step it crossed. `step` counts physics steps since GO, so the orb was at `prev`
 * at (step - 1) × stepMs and at `cur` at step × stepMs. Undefined when this step did not finish.
 * The region is x ≥ gate.x within the chamber's rows, so entering it from above or below counts.
 */
export const finishCrossing = (
  prev: { x: number; y: number },
  cur: { x: number; y: number },
  gate: FinishGate,
  step: number,
  stepMs: number,
): number | undefined => {
  if (inGate(gate, prev) || !inGate(gate, cur)) return undefined
  // Entry fraction into the convex region: the latest of the boundary crossings prev was outside
  let t = 0
  if (prev.x < gate.x) t = Math.max(t, (gate.x - prev.x) / (cur.x - prev.x))
  if (prev.y > gate.bottom) t = Math.max(t, (prev.y - gate.bottom) / (prev.y - cur.y))
  if (prev.y < gate.top) t = Math.max(t, (gate.top - prev.y) / (cur.y - prev.y))
  return (step - 1 + t) * stepMs
}

/** Race time as m:ss.mmm, rounded down to the millisecond. */
export const formatRaceTime = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
