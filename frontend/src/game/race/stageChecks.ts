import type { Port, RaceStage, Segment } from './stage'

/**
 * Stage-level variety checks shared by the stage sweep and the dev gallery (contract §6). Pure:
 * they read only the stage's segments.
 */
export interface CheckResult {
  ok: boolean
  detail: string
}

export interface StageStats {
  segments: number
  runPct: number
  westSegments: number
  forks: number
  parMs: number
}

const BUILT_IN = new Set(['start', 'finish', 'lobby'])

/** The generated segments, without the start, the finish and the lobby room. */
export const builtSegments = (stage: RaceStage): Array<Segment> => stage.segments.filter((s) => !BUILT_IN.has(s.type))

/** Whether a segment travels leftward anywhere: it enters or leaves heading W. */
export const isWest = (s: Segment): boolean => s.entry.dir === 'W' || s.exit.dir === 'W'

export const stageStats = (stage: RaceStage): StageStats => {
  const built = builtSegments(stage)
  const runs = built.filter((s) => s.type === 'run').length
  return {
    segments: built.length,
    runPct: built.length ? Math.round((runs * 100) / built.length) : 0,
    westSegments: built.filter(isWest).length,
    forks: built.filter((s) => s.fork !== undefined).length,
    parMs: stage.parMs,
  }
}

/** Longest stretch of consecutive segments of one type (of `type` only, when given). */
const longestRepeat = (segs: ReadonlyArray<Segment>, type?: string): number => {
  let best = 0
  let run = 0
  segs.forEach((s, i) => {
    run = i > 0 && segs[i - 1].type === s.type ? run + 1 : 1
    if (type === undefined || s.type === type) best = Math.max(best, run)
  })
  return best
}

/** Runs ≤ 40% of the generated segments, ≤ 2 runs in a row, no type > 2× in a row. Speedway is exempt. */
export const checkCeilings = (stage: RaceStage): CheckResult => {
  if (stage.archetype === 'speedway') return { ok: true, detail: 'exempt' }
  const built = builtSegments(stage)
  const runs = built.filter((s) => s.type === 'run').length
  const runStreak = longestRepeat(built, 'run')
  const typeStreak = longestRepeat(built)
  const problems: Array<string> = []
  if (runs * 5 > built.length * 2) problems.push(`runs ${runs}/${built.length}`)
  if (runStreak > 2) problems.push(`${runStreak} runs in a row`)
  if (typeStreak > 2) problems.push(`a type ${typeStreak}× in a row`)
  return problems.length > 0
    ? { ok: false, detail: problems.join(', ') }
    : { ok: true, detail: `runs ${runs}/${built.length}, longest repeat ${typeStreak}` }
}

/** Floor row of a horizontal port, or the port line of a vertical one, in px. */
export const portLevel = (p: Port): number => ('bottom' in p ? p.bottom : p.y)

/** Up-left-up-right switchback pairs: a rising E→W switchback, then (after any leftward segments) a rising W→E one. */
export const switchbackPairs = (built: ReadonlyArray<Segment>): number => {
  const rising = (s: Segment) => s.type === 'switchback' && portLevel(s.exit) < portLevel(s.entry)
  let pairs = 0
  let open = false
  for (const s of built) {
    if (rising(s) && s.entry.dir === 'E' && s.exit.dir === 'W') open = true
    else if (open && rising(s) && s.entry.dir === 'W' && s.exit.dir === 'E') {
      pairs++
      open = false
    } else if (!(open && s.entry.dir === 'W' && s.exit.dir === 'W')) open = false
  }
  return pairs
}

/** Column span of a segment's open space, in px. */
const spanX = (s: Segment) => {
  let x0 = Infinity
  let x1 = -Infinity
  for (const r of [...s.tunnels, ...s.chambers]) {
    x0 = Math.min(x0, r.x)
    x1 = Math.max(x1, r.x + r.w)
  }
  return { x0, x1 }
}

/**
 * Double-backs: segments travelling W throughout (entering and leaving W) whose columns overlap
 * columns of a segment at least two before them, i.e. route laid before the turn that led here.
 */
export const doubleBacks = (segments: ReadonlyArray<Segment>): number => {
  let n = 0
  segments.forEach((s, i) => {
    if (s.entry.dir !== 'W' || s.exit.dir !== 'W') return
    const a = spanX(s)
    if (segments.slice(0, Math.max(0, i - 1)).some((t) => {
      const b = spanX(t)
      return a.x0 < b.x1 && b.x0 < a.x1
    })) n++
  })
  return n
}

/** The guarantee for the stage's archetype. */
export const checkGuarantee = (stage: RaceStage): CheckResult => {
  const built = builtSegments(stage)
  switch (stage.archetype) {
    case 'tower': {
      const pairs = switchbackPairs(built)
      return { ok: pairs >= 2, detail: `${pairs} switchback pairs (≥2)` }
    }
    case 'labyrinth': {
      const n = doubleBacks(stage.segments)
      return { ok: n >= 1, detail: `${n} double-backs (≥1)` }
    }
    case 'descent': {
      // Climbs are segments rising 3 rows (150 px) or more; drops and climbs summed per segment
      const cell = stage.cell
      let climbs = 0
      let climb = 0
      let drop = 0
      for (const seg of built) {
        const rise = portLevel(seg.entry) - portLevel(seg.exit)
        if (rise >= 3 * cell) climbs++
        if (rise > 0) climb += rise
        else drop -= rise
      }
      return {
        ok: climbs <= 2 && drop >= 2 * climb,
        detail: `${climbs} climbs (≤2), drop ${drop / cell} rows vs climb ${climb / cell} (≥2×)`,
      }
    }
    case 'canyon': {
      const chambers = built.filter((s) => s.type === 'chamber').length
      const stalls = built.filter((s) => s.type === 'stallChamber').length
      return { ok: chambers >= 2 && stalls >= 2, detail: `${chambers} chambers, ${stalls} stall chambers (≥2 each)` }
    }
    case 'speedway': {
      const west = built.filter(isWest).length
      return { ok: west === 0, detail: `${west} leftward segments (0)` }
    }
  }
}
