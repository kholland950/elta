import type { Rect } from 'game/race/stage'

/** Brightness range of the idle breathing glow. */
export const PULSE_MIN = 0.7
export const PULSE_MAX = 1
/** About one breath a second. */
export const PULSE_PERIOD_MS = 1000
/** One full phase turn across this many px of stage, so pads ripple left to right. */
const PHASE_SPAN = 800
/** A launch point counts as on a pad when it is within this many px of the pad's top. */
export const PAD_TOP_TOLERANCE = 6
/** How long a pad flashes after a launch. */
export const FLASH_MS = 150

/** Per-pad phase (radians) from its x, so neighbouring pads breathe slightly out of step. */
export const padPhase = (x: number): number => (x / PHASE_SPAN) * 2 * Math.PI

/**
 * Brightness factor for a pad's idle glow at `tMs`: a ~1 Hz sine between PULSE_MIN and PULSE_MAX.
 * Reduced motion holds it steady at the middle of the range.
 */
export const padPulse = (tMs: number, phase: number, reducedMotion: boolean): number => {
  const mid = (PULSE_MIN + PULSE_MAX) / 2
  if (reducedMotion) return mid
  const half = (PULSE_MAX - PULSE_MIN) / 2
  return mid + half * Math.sin((tMs / PULSE_PERIOD_MS) * 2 * Math.PI - phase)
}

/** The pad whose top span contains x, with y within PAD_TOP_TOLERANCE of its top. */
export const padAt = <R extends Rect>(
  pads: ReadonlyArray<R>,
  x: number,
  y: number,
): R | undefined => {
  for (const pad of pads) {
    if (x >= pad.x && x <= pad.x + pad.w && Math.abs(y - pad.y) <= PAD_TOP_TOLERANCE) return pad
  }
  return undefined
}

/** Launch flash level: 1 at the launch, easing out to 0 over FLASH_MS. */
export const flashLevel = (elapsedMs: number): number => {
  if (elapsedMs <= 0) return 1
  if (elapsedMs >= FLASH_MS) return 0
  return (1 - elapsedMs / FLASH_MS) ** 2
}
