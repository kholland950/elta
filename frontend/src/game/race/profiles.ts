import type { Archetype } from './archetype'
import type { Knobs } from './difficulty'
import type { Rng } from './rng'
import type { BuildableType } from './segments'

/**
 * Stage archetype profiles: how each archetype bends the generator. All values are cells or
 * integer percentages, and every random choice draws from the stage's one stream.
 * See docs/plans/route-variety.md.
 */

/** Which way run floor steps may go. */
export type StepBias = 'both' | 'up' | 'down'

/** A forced stretch of route, placed once the summed par reaches `atPermille` of the target. */
export interface Beat {
  kind: 'switchbackPair' | 'doubleBack' | 'climb' | 'chamber' | 'stallChamber' | 'fork'
  atPermille: number
  /** Single-segment beats: the segment it forces (a climb is a shaft up or a stall chamber). */
  step?: BeatStep
}

export interface Profile {
  /** Highest row any carve may open (the top of the altitude band). */
  ceilingRow: number
  /** The start room's floor row (bay 0 sits on it). */
  startFloor: number
  /** Integer percentages scaling the difficulty's segment weights. */
  weightPct: Record<BuildableType, number>
  /** Knob changes, kept inside the 150–400 px tunnel range. */
  adjustKnobs: (k: Knobs) => Knobs
  stepBias: StepBias
  /** Most consecutive leftward segments (0: never leftward). */
  maxWest: number
  /** Whether the run and streak ceilings apply (Speedway is exempt). */
  runCaps: boolean
  /** Forks to place, drawn from the stream. */
  forkCount: (rng: Rng) => number
  /** Beats in par order (all at or below 700‰). */
  agenda: (rng: Rng) => Array<Beat>
  /** Percent chance a shaft up / down leaves through its end (a vertical port). */
  endPortPct: { up: number; down: number }
  /** Most rows a chamber's exit may sit above its floor. */
  chamberExitRiseMax: number
  /**
   * Descent: segments rising this many rows or more are climbs, allowed only as agenda beats, and
   * the stage may finish only once its total drop is at least twice its total climb.
   */
  climbRows?: number
  /** Descent: the lowest floor allowed slides from the start floor to LOWEST_FLOOR over the par. */
  glide?: boolean
}

/** Tunnel interior height limits in cells (150–400 px). */
export const TUNNEL_ROWS_MIN = 3
export const TUNNEL_ROWS_MAX = 8

/** Keeps knob changes legal: tunnel heights in range and ordered, sections at least 4 long. */
export const clampKnobs = (k: Knobs): Knobs => {
  const tunnelMin = Math.max(TUNNEL_ROWS_MIN, Math.min(TUNNEL_ROWS_MAX, k.tunnelMin))
  const tunnelMax = Math.max(tunnelMin, Math.min(TUNNEL_ROWS_MAX, k.tunnelMax))
  const sectionMin = Math.max(4, k.sectionMin)
  return { ...k, tunnelMin, tunnelMax, sectionMin, sectionMax: Math.max(sectionMin, k.sectionMax) }
}

const pct = (
  run: number,
  shaftUp: number,
  shaftDown: number,
  stallChamber: number,
  switchback: number,
  chimney: number,
  chamber: number,
): Record<BuildableType, number> => ({ run, shaftUp, shaftDown, stallChamber, switchback, chimney, chamber, fork: 0 })

/**
 * Fork beats for a profile: `count` forks spread over the par (one at 400‰, two at 200‰ and
 * 600‰), merged into the agenda in par order.
 */
export const withForks = (agenda: ReadonlyArray<Beat>, count: number): Array<Beat> => {
  const forks: Array<Beat> = []
  for (let i = 0; i < count; i++) {
    const at = count === 1 ? 400 : 200 + Math.floor((i * 400) / (count - 1))
    forks.push({ kind: 'fork', atPermille: at, step: { type: 'fork' } })
  }
  return [...agenda, ...forks].sort((a, b) => a.atPermille - b.atPermille)
}

/** One segment a beat forces, with the template options it needs. */
export interface BeatStep {
  type: BuildableType
  vertical?: 'up' | 'down'
  long?: boolean
  /** Runs: floor steps only away from the route this one doubles over (the way the last turn went). */
  away?: boolean
}

/** Rows of headroom ordinary segments leave for each pending beat that must climb. */
export const BEAT_HEADROOM: Partial<Record<Beat['kind'], number>> = {
  switchbackPair: 30,
  doubleBack: 24,
  chamber: 14,
  stallChamber: 20,
  climb: 20,
  fork: 20,
}

/**
 * The segments each beat forces, in order. A switchback pair climbs up-left then up-right; a
 * double-back reverses, runs a long way left over or under the route already built, and reverses.
 */
export const BEAT_STEPS: Record<'switchbackPair' | 'doubleBack', ReadonlyArray<BeatStep>> = {
  switchbackPair: [
    { type: 'switchback', vertical: 'up' },
    { type: 'switchback', vertical: 'up' },
  ],
  doubleBack: [{ type: 'switchback' }, { type: 'run', long: true, away: true }, { type: 'switchback' }],
}

export const PROFILES: Record<Archetype, Profile> = {
  // Mostly up: climbing segments favoured, the band reaches about 5000 px
  tower: {
    ceilingRow: -100,
    startFloor: -6,
    weightPct: pct(60, 220, 20, 160, 150, 100, 60),
    adjustKnobs: (k) => clampKnobs({ ...k, riseMax: k.riseMax + 2 }),
    stepBias: 'up',
    maxWest: 1,
    runCaps: true,
    forkCount: () => 1,
    agenda: () => [
      { kind: 'switchbackPair', atPermille: 150 },
      { kind: 'switchbackPair', atPermille: 450 },
    ],
    endPortPct: { up: 35, down: 15 },
    chamberExitRiseMax: 6,
  },
  // Starts high and mostly drops
  descent: {
    ceilingRow: -110,
    startFloor: -80,
    weightPct: pct(100, 0, 250, 0, 80, 100, 120),
    adjustKnobs: (k) => clampKnobs(k),
    stepBias: 'down',
    maxWest: 1,
    runCaps: true,
    forkCount: () => 1,
    // Up to two climbs, each a shaft up or a stall chamber
    agenda: (rng) => {
      const n = rng.int(0, 2)
      const out: Array<Beat> = []
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'climb', atPermille: 250 + i * 300, step: { type: rng.int(0, 1) === 0 ? 'shaftUp' : 'stallChamber' } })
      }
      return out
    },
    endPortPct: { up: 0, down: 35 },
    chamberExitRiseMax: 0,
    climbRows: 3,
    glide: true,
  },
  // Tight tunnels and many turns
  labyrinth: {
    ceilingRow: -80,
    startFloor: -40,
    weightPct: pct(70, 120, 120, 80, 150, 100, 40),
    adjustKnobs: (k) =>
      clampKnobs({ ...k, tunnelMax: k.tunnelMax - 2, sectionMin: k.sectionMin - 2, sectionMax: k.sectionMax - 4 }),
    stepBias: 'both',
    maxWest: 2,
    runCaps: true,
    forkCount: () => 2,
    agenda: (rng) => [{ kind: 'doubleBack', atPermille: rng.int(250, 450) }],
    endPortPct: { up: 20, down: 20 },
    chamberExitRiseMax: 4,
  },
  // Long runs, gentle height, never leftward; exempt from the run ceilings
  speedway: {
    ceilingRow: -45,
    startFloor: -6,
    weightPct: pct(300, 40, 40, 30, 0, 0, 0),
    adjustKnobs: (k) =>
      clampKnobs({ ...k, tunnelMin: k.tunnelMin + 1, sectionMin: k.sectionMin + 4, sectionMax: k.sectionMax + 6, stepMax: 1 }),
    stepBias: 'both',
    maxWest: 0,
    runCaps: false,
    forkCount: (rng) => rng.int(0, 1),
    agenda: () => [],
    endPortPct: { up: 0, down: 0 },
    chamberExitRiseMax: 0,
  },
  // Big chambers
  canyon: {
    ceilingRow: -70,
    startFloor: -6,
    weightPct: pct(80, 80, 80, 160, 50, 100, 300),
    adjustKnobs: (k) => clampKnobs({ ...k, tunnelMin: k.tunnelMin + 1, tunnelMax: k.tunnelMax + 1 }),
    stepBias: 'both',
    maxWest: 1,
    runCaps: true,
    forkCount: () => 1,
    agenda: () => [
      { kind: 'chamber', atPermille: 120, step: { type: 'chamber' } },
      { kind: 'stallChamber', atPermille: 300, step: { type: 'stallChamber' } },
      { kind: 'chamber', atPermille: 480, step: { type: 'chamber' } },
      { kind: 'stallChamber', atPermille: 650, step: { type: 'stallChamber' } },
    ],
    endPortPct: { up: 25, down: 25 },
    chamberExitRiseMax: 6,
  },
}
