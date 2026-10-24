export const MIN_DIFFICULTY = 1
export const MAX_DIFFICULTY = 10

/** Generator knobs for one difficulty, in grid cells unless named otherwise. */
export interface Knobs {
  difficulty: number
  /** Tunnel interior height range. */
  tunnelMin: number
  tunnelMax: number
  /** Length range of one tunnel section. */
  sectionMin: number
  sectionMax: number
  /** Largest floor step between tunnel sections. */
  stepMax: number
  /** Vertical shaft width range. */
  shaftMin: number
  shaftMax: number
  /** Vertical shaft rise or drop range. */
  riseMin: number
  riseMax: number
  /** Height of the stall chamber's tunnel mouth. */
  mouthRows: number
  weights: { run: number; shaftUp: number; shaftDown: number; stallChamber: number; switchback: number; chimney: number; chamber: number; fork: number }
}

export const clampDifficulty = (d: number): number => {
  if (!Number.isFinite(d)) return MIN_DIFFICULTY
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, Math.round(d)))
}

/** Integer interpolation from `easy` at difficulty 1 to `hard` at difficulty 10. */
const ramp = (easy: number, hard: number, d: number) =>
  easy + Math.round(((hard - easy) * (d - MIN_DIFFICULTY)) / (MAX_DIFFICULTY - MIN_DIFFICULTY))

export const difficultyKnobs = (difficulty: number): Knobs => {
  const d = clampDifficulty(difficulty)
  return {
    difficulty: d,
    // 50 px cells: 200–400 px tunnels when easy, 150–250 px when hard
    tunnelMin: ramp(4, 3, d),
    tunnelMax: ramp(8, 5, d),
    sectionMin: ramp(8, 5, d),
    sectionMax: ramp(16, 11, d),
    stepMax: ramp(1, 2, d),
    shaftMin: ramp(3, 2, d),
    shaftMax: ramp(4, 3, d),
    riseMin: ramp(5, 7, d),
    riseMax: ramp(10, 16, d),
    mouthRows: d < 6 ? 3 : 2,
    weights: {
      run: ramp(6, 4, d),
      shaftUp: ramp(2, 3, d),
      shaftDown: 2,
      stallChamber: ramp(1, 3, d),
      switchback: ramp(1, 2, d),
      chimney: 2,
      chamber: 1,
      // Forks come only from agenda beats (exact counts per archetype)
      fork: 0,
    },
  }
}
