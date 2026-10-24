import { Archetype, archetypeForSeed } from './archetype'
import { clampDifficulty, difficultyKnobs, Knobs } from './difficulty'
import { boundaryEdges, buildGrid, Carve, CellGrid, CellRect, cellIndex, mergeCells, OPEN, PAD, SOLID } from './grid'
import { checkGrid, reachFrom, ReachOptions, ReachTargets, solidify, StageReach } from './reach'
import { Beat, BEAT_HEADROOM, BEAT_STEPS, BeatStep, PROFILES, Profile, withForks } from './profiles'
import { createRng, Rng } from './rng'
import {
  BUILDABLE_TYPES,
  BuildableType,
  CELL,
  CellPort,
  isHorizontal,
  LOWEST_FLOOR,
  planFinish,
  planSegment,
  planStart,
  REVERSING_TYPES,
  portCells,
  SEA_ROWS,
  SegmentPlan,
  START_COLS,
  clampBays,
} from './segments'
import type { Bounce, Point, Port, RaceStage, Rect, Segment, Solid } from './stage'
import { padApex } from './tuning'

/** Stop adding segments once the summed par reaches this. */
export const TARGET_PAR_MS = 55000
/** Rerolls of the first type picked at a position. */
export const MAX_REROLLS = 8

export const reachOptions: ReachOptions = { cellSize: CELL, padApexCells: Math.floor(padApex() / CELL) }

const px = (r: CellRect): Rect => ({ x: r.c0 * CELL, y: r.r0 * CELL, w: (r.c1 - r.c0) * CELL, h: (r.r1 - r.r0) * CELL })

/**
 * Base segment weights for the current tunnel: shafts up are favoured low down and offered only
 * with room above the band's ceiling; shafts down only with room below, favoured high up; the
 * stall chamber needs room for its tall room. Then scaled by the archetype's percentages.
 */
const weightsAt = (knobs: Knobs, port: CellPort, profile: Profile, floorRow: number): Record<BuildableType, number> => {
  const w = knobs.weights
  const ceiling = profile.ceilingRow
  const base: Record<BuildableType, number> = {
    run: 0,
    shaftUp: 0,
    shaftDown: 0,
    stallChamber: 0,
    switchback: 0,
    chimney: 0,
    chamber: 0,
    fork: 0,
  }
  if (isHorizontal(port)) {
    const roomAbove = port.top - ceiling
    const roomBelow = floorRow - port.bottom
    base.run = w.run
    base.shaftUp = roomAbove < 14 ? 0 : port.bottom > -12 ? w.shaftUp * 2 : w.shaftUp
    base.shaftDown = roomBelow < knobs.tunnelMin + 3 ? 0 : port.bottom < ceiling + 30 ? w.shaftDown * 2 : w.shaftDown
    base.stallChamber = roomAbove < 22 ? 0 : w.stallChamber
    base.switchback = roomAbove < 12 && roomBelow < 12 ? 0 : w.switchback
    base.chamber = roomAbove < 12 ? 0 : w.chamber
  } else {
    // Out of a vertical port only a chimney or a chamber can follow
    base.chimney = w.chimney
    base.chamber = w.chamber
  }
  const out = { ...base }
  // Percent scaling kept at a tenth of a unit, so small weights keep their ratios
  for (const t of BUILDABLE_TYPES) out[t] = Math.floor((base[t] * profile.weightPct[t]) / 10)
  return out
}

const spanOf = (plan: SegmentPlan) => {
  let c0 = Infinity
  let c1 = -Infinity
  let r0 = Infinity
  for (const r of plan.carves) {
    c0 = Math.min(c0, r.c0)
    c1 = Math.max(c1, r.c1)
    r0 = Math.min(r0, r.r0)
  }
  return { c0, c1, r0 }
}

/** Everything a plan opens: its carves and its pits. */
const openings = (plan: SegmentPlan): Array<CellRect> => [...plan.carves, ...plan.pits]

/** Passable as a whole and, for a fork, through each branch with the other one rock. */
export const planPassableEveryWay = (plan: SegmentPlan): boolean =>
  planPassable(plan) &&
  (!plan.branches || (planPassable(plan, plan.branches.high) && planPassable(plan, plan.branches.low)))

/**
 * Whether the orb can get from a segment's entry mouth to its exit mouth on its own geometry, for
 * any port direction: a mini-grid of the plan plus the cells just outside its entry (where the
 * orb comes from), padded with rock; the orb must reach the cells just inside its exit. `solid`
 * turns rectangles back to rock first (one fork branch, to check the other on its own).
 */

export const planPassable = (plan: SegmentPlan, solid: ReadonlyArray<CellRect> = []): boolean => {
  const mouth = portCells(plan.entry, 'out')
  const target = portCells(plan.exit, 'out')
  const carves = [mouth, ...openings(plan)]
  let c0 = Infinity
  let c1 = -Infinity
  let r0 = Infinity
  for (const r of [mouth, ...plan.carves]) {
    c0 = Math.min(c0, r.c0)
    c1 = Math.max(c1, r.c1)
    r0 = Math.min(r0, r.r0)
  }
  const built = buildGrid({ col0: c0 - 1, col1: c1 + 1, row0: r0 - 2, seaRows: SEA_ROWS, carves, pads: plan.pads })
  const grid = solid.length > 0 ? solidify(built, solid) : built
  const cells = (r: CellRect) => {
    const out: Array<number> = []
    for (let row = r.r0; row < r.r1; row++) for (let col = r.c0; col < r.c1; col++) out.push(cellIndex(grid, col, row))
    return out
  }
  const reach = reachFrom(grid, cells(mouth), reachOptions)
  return cells(target).some((i) => reach[i] >= 0)
}

/** Rock kept between a new segment's openings and every earlier one's, in cells. */
export const SEP = 2

/** A carve already in the stage, tagged with the index of the segment that made it. */
interface Placed {
  rect: CellRect
  seg: number
}

/** Cells of rock between two rectangles (0 when they touch or overlap), Chebyshev style. */
const gap = (a: CellRect, b: CellRect) =>
  Math.max(b.c0 - a.c1, a.c0 - b.c1, b.r0 - a.r1, a.r0 - b.r1, 0)

/** Whether `a` (the new segment) and `b` (its predecessor) meet across the port between them. */
const joins = (a: CellRect, b: CellRect, port: CellPort) => {
  const ahead = portCells(port, 'in')
  const behind = portCells(port, 'out')
  return overlapsRect(a, ahead) && overlapsRect(b, behind)
}

const overlapsRect = (a: CellRect, b: CellRect) => a.c0 < b.c1 && b.c0 < a.c1 && a.r0 < b.r1 && b.r0 < a.r1

/** Leftward travel never opens more than this many columns left of the furthest column reached. */
export const BACKTRACK_COLS = 60
/** No leftward exit until the route has reached this many columns past the start room. */
export const WEST_AFTER_COLS = 30

/**
 * Where a segment may open: below the band's ceiling, floors no lower than LOWEST_FLOOR, and no
 * further left than `minCol` (the frontier less BACKTRACK_COLS).
 */
interface Band {
  ceilingRow: number
  minCol: number
}

/**
 * Whether a plan can be placed after the segments so far: every opening at least SEP cells from
 * every earlier segment's (except the two carves that meet at the entry port), inside the band,
 * and right of the start room. Pure: never draws from the random stream.
 */
const fits = (plan: SegmentPlan, placed: ReadonlyArray<Placed>, prevSeg: number, band: Band): boolean => {
  for (const r of plan.carves) {
    if (r.r0 < band.ceilingRow || r.r1 > LOWEST_FLOOR || r.c0 < START_COLS || r.c0 < band.minCol) return false
  }
  for (const r of openings(plan)) {
    for (const p of placed) {
      if (gap(r, p.rect) >= SEP) continue
      if (p.seg === prevSeg && joins(r, p.rect, plan.entry)) continue
      return false
    }
  }
  return true
}

/** Rerolls of each other type tried after the first pick fails. */
export const OTHER_REROLLS = 4
/** Rerolls of a type an agenda beat forces. */
export const BEAT_REROLLS = 16
/** Segments popped (and banned at their position) at one dead end before a restart. */
export const MAX_POPS = 12
/** Restarts from the start room, on the same stream, before the last-resort attempt. */
export const MAX_RESTARTS = 3
/** The longest par a stage may have. */
export const MAX_PAR_MS = 65000
/** Never plan past this par, leaving room for the finish. */
export const PAR_LIMIT_MS = MAX_PAR_MS - 2000

/** How hard the generator had to work for a stage (for the sweep and the gallery). */
export interface GenStats {
  /** Plans rejected (not passable, or not fitting) before one was accepted. */
  rerolls: number
  /** Positions where the picked type gave up and another eligible type was tried. */
  fallbacks: number
  /** Segments popped by backtracking. */
  pops: number
  /** Restarts from the start room. */
  restarts: number
  /** The last-resort attempt (ceilings off) was used. */
  relaxed: boolean
}

/** The route so far, with the running counts the rules need. */
interface Route {
  plans: Array<SegmentPlan>
  placed: Array<Placed>
  parMs: number
  /** Buildable segments so far, and how many are runs. */
  built: number
  runs: number
  /** One past the furthest column opened so far. */
  frontier: number
  /** Trailing segments that left heading W. */
  westStreak: number
  /** Agenda beats completed, and the step to place next inside the current beat (0: none begun). */
  beatsDone: number
  nextStep: number
}

const isBuildable = (t: string): t is BuildableType => (BUILDABLE_TYPES as ReadonlyArray<string>).includes(t)

const routeOf = (plans: Array<SegmentPlan>, agenda: ReadonlyArray<Beat>): Route => {
  const route: Route = { plans, placed: [], parMs: 0, built: 0, runs: 0, frontier: 0, westStreak: 0, beatsDone: 0, nextStep: 0 }
  plans.forEach((p, seg) => {
    for (const rect of openings(p)) {
      route.placed.push({ rect, seg })
      route.frontier = Math.max(route.frontier, rect.c1)
    }
    route.parMs += p.parMs
    if (isBuildable(p.type)) route.built++
    if (p.type === 'run') route.runs++
    route.westStreak = p.exit.dir === 'W' ? route.westStreak + 1 : 0
    if (p.beat) {
      const last = p.beat.step === stepsOf(agenda[p.beat.index]).length - 1
      route.beatsDone = last ? p.beat.index + 1 : p.beat.index
      route.nextStep = last ? 0 : p.beat.step + 1
    }
  })
  return route
}

/** The segments a beat forces (beats of later slices force none yet). */
const stepsOf = (beat: Beat): ReadonlyArray<BeatStep> =>
  beat.step ? [beat.step] : beat.kind === 'switchbackPair' || beat.kind === 'doubleBack' ? BEAT_STEPS[beat.kind] : []

interface Gen {
  rng: Rng
  knobs: Knobs
  profile: Profile
  agenda: ReadonlyArray<Beat>
  stats: GenStats
  /** Ceilings off (the last-resort attempt). */
  relaxed: boolean
}

/** One planned step: its type, which way a vertical entry turns, and whether it leaves heading W. */
interface Choice {
  type: BuildableType
  turn: 'E' | 'W'
  west: boolean
}

/** A choice for this entry: horizontal entries keep (or, reversing, flip) their heading. */
const choice = (type: BuildableType, entry: CellPort, turn: 'E' | 'W' = 'E'): Choice => ({
  type,
  turn,
  west: isHorizontal(entry) ? (entry.dir === 'W') !== REVERSING_TYPES.has(type) : turn === 'W',
})

/**
 * Whether these steps may follow the route in this order: each leftward exit inside the west
 * budget, and (unless exempt or relaxed) no type a third time in a row and the run ceiling
 * holding for every prefix, (runs + 1) × 5 ≤ (n + 1) × 2.
 */
const allowedSequence = (gen: Gen, route: Route, steps: ReadonlyArray<Choice>): boolean => {
  const capped = gen.profile.runCaps && !gen.relaxed
  const recent = route.plans.slice(-2).map((p) => p.type as string)
  let { runs, built, westStreak } = route
  for (const { type: t, west } of steps) {
    if (west && (westStreak + 1 > gen.profile.maxWest || route.frontier < START_COLS + WEST_AFTER_COLS)) return false
    if (capped) {
      if (recent.length >= 2 && recent[recent.length - 1] === t && recent[recent.length - 2] === t) return false
      if (t === 'run' && (runs + 1) * 5 > (built + 1) * 2) return false
    }
    if (t === 'run') runs++
    built++
    westStreak = west ? westStreak + 1 : 0
    recent.push(t)
  }
  return true
}

/** The choices allowed next, with their weights (above 0, not banned here, allowed in sequence). */
const eligible = (gen: Gen, route: Route, entry: CellPort, banned: ReadonlySet<BuildableType>) => {
  const weights = weightsAt(gen.knobs, entry, gen.profile, floorRowAt(gen, route))
  // Heading left, turning back gets likelier with every leftward segment
  if (route.westStreak > 0) weights.switchback = (weights.switchback + gen.knobs.weights.switchback * 10) * (1 + route.westStreak)
  // Heading left, an ordinary pick only turns back: carrying on left is for agenda beats
  const turnOnly = entry.dir === 'W'
  const out: Array<Choice & { weight: number }> = []
  for (const t of BUILDABLE_TYPES) {
    if (weights[t] <= 0 || banned.has(t) || (turnOnly && !REVERSING_TYPES.has(t))) continue
    // Out of a vertical port: mostly turn right; up a shaft, sometimes left (up, then left)
    const turns: Array<['E' | 'W', number]> = entry.dir === 'N' ? [['E', 3], ['W', 1]] : [['E', 1]]
    for (const [turn, k] of turns) {
      const c = choice(t, entry, turn)
      if (allowedSequence(gen, route, [c])) out.push({ ...c, weight: weights[t] * k })
    }
  }
  return out
}

/**
 * The lowest floor allowed now: LOWEST_FLOOR, or for a gliding profile a line sliding from the
 * start floor down to it as the par grows (reached at 80% of the target), so a descent spreads
 * its drop over the whole stage instead of hitting bottom early.
 */
const floorRowAt = (gen: Gen, route: Route): number => {
  if (!gen.profile.glide) return LOWEST_FLOOR
  const start = gen.profile.startFloor
  const t = Math.min(route.parMs + 8000, TARGET_PAR_MS)
  return Math.min(LOWEST_FLOOR, start + Math.floor(((LOWEST_FLOOR - start) * t * 5) / (TARGET_PAR_MS * 4)))
}

/** Level of a port in rows: a horizontal port's floor, a vertical port's line. */
const levelOf = (p: CellPort) => (isHorizontal(p) ? p.bottom : p.y)

/** Rows a plan rises from entry to exit (negative when it drops). */
const riseOf = (plan: SegmentPlan) => levelOf(plan.entry) - levelOf(plan.exit)

/** Total rows climbed and dropped over the route's generated segments. */
const climbAndDrop = (route: Route) => {
  let climb = 0
  let drop = 0
  for (const p of route.plans) {
    if (!isBuildable(p.type)) continue
    const r = riseOf(p)
    if (r > 0) climb += r
    else drop -= r
  }
  return { climb, drop }
}

const bandOf = (gen: Gen, route: Route): Band => ({
  ceilingRow: gen.profile.ceilingRow,
  minCol: route.frontier - BACKTRACK_COLS,
})

/**
 * Columns a switchback's return must clear, relative to its entry: turning left, the leftward
 * layer that follows may run back as far as the backtrack limit; turning back right, only the
 * stretch its own lead and return span.
 */
export const CLEAR_WEST = { behind: BACKTRACK_COLS, ahead: 25 }
export const CLEAR_EAST = { behind: 5, ahead: 30 }

/** Highest open row and one past the lowest, among earlier openings in columns [c0, c1). */
const skylineIn = (route: Route, c0: number, c1: number) => {
  let top = Infinity
  let bottom = -Infinity
  for (const p of route.placed) {
    if (p.rect.c1 <= c0 || p.rect.c0 >= c1) continue
    top = Math.min(top, p.rect.r0)
    bottom = Math.max(bottom, p.rect.r1)
  }
  return { top, bottom }
}

/**
 * The ceiling ordinary segments keep to: the band's, lowered to leave headroom for every pending
 * beat that climbs, but never below the current tunnel (so the route can carry on level).
 */
/** Rows above the start floor ordinary segments may always use, whatever the beats reserve. */
export const START_HEADROOM = 24

const ordinaryCeiling = (gen: Gen, route: Route, entry: CellPort): number => {
  // Switchback pairs climb one after another, so theirs add up; other beats need one at a time
  let pairs = 0
  let single = 0
  for (let i = route.beatsDone; i < gen.agenda.length; i++) {
    const room = BEAT_HEADROOM[gen.agenda[i].kind] ?? 0
    if (gen.agenda[i].kind === 'switchbackPair') pairs += room
    else single = Math.max(single, room)
  }
  // Never so low that the first segments out of the start room have nowhere to go
  const reserved = Math.min(gen.profile.ceilingRow + pairs + single, gen.profile.startFloor - START_HEADROOM)
  return Math.min(reserved, levelOf(entry) - gen.knobs.tunnelMax - gen.knobs.stepMax)
}

/** A plan of this type that is passable, fits, and keeps par under the limit; undefined if none. */
const tryType = (
  gen: Gen,
  route: Route,
  entry: CellPort,
  step: BeatStep,
  tries: number,
  beat?: SegmentPlan['beat'],
  turn: 'E' | 'W' = 'E',
): SegmentPlan | undefined => {
  const prevSeg = route.plans.length - 1
  const band = bandOf(gen, route)
  const prev = route.plans[prevSeg]
  // A run doubling back steps away from the route it passes: up if the last turn went up
  const away = step.away ? (riseOf(prev) > 0 ? 'up' : 'down') : undefined
  const bias = away ?? gen.profile.stepBias
  // Travel direction is entry.dir; the window reaches back along it
  const sky =
    step.type !== 'switchback' || !isHorizontal(entry)
      ? undefined
      : entry.dir === 'E'
        ? skylineIn(route, entry.x - CLEAR_WEST.behind, entry.x + CLEAR_WEST.ahead)
        : skylineIn(route, entry.x - CLEAR_EAST.ahead, entry.x + CLEAR_EAST.behind)
  const ceilingRow = beat ? gen.profile.ceilingRow : ordinaryCeiling(gen, route, entry)
  const floorRow = beat ? LOWEST_FLOOR : floorRowAt(gen, route)
  // Descent: only beats may climb
  const climbCap = gen.profile.climbRows !== undefined && !beat ? gen.profile.climbRows : undefined
  const endPct = step.type === 'shaftUp' ? gen.profile.endPortPct.up : step.type === 'shaftDown' ? gen.profile.endPortPct.down : 0
  for (let attempt = 0; attempt < tries; attempt++) {
    const plan = planSegment(step.type, {
      rng: gen.rng,
      entry,
      knobs: gen.knobs,
      ceilingRow,
      floorRow,
      stepBias: bias,
      vertical: step.vertical ?? (bias === 'up' ? 'up' : bias === 'down' ? 'down' : undefined),
      long: step.long,
      ...(sky ? { upFloorMax: sky.top - SEP, downTopMin: sky.bottom + SEP } : {}),
      // Turning left, leave room on that side for the turn back
      reserveRows: entry.dir === 'E' ? gen.knobs.tunnelMax + SEP : 0,
      endPort: endPct > 0 && !beat && gen.rng.int(0, 99) < endPct,
      turn,
      exitRiseMax: gen.profile.chamberExitRiseMax,
    })
    if (
      plan &&
      (climbCap === undefined || riseOf(plan) < climbCap) &&
      route.parMs + plan.parMs <= PAR_LIMIT_MS &&
      planPassableEveryWay(plan) &&
      fits(plan, route.placed, prevSeg, band)
    ) {
      return beat ? { ...plan, beat } : plan
    }
    gen.stats.rerolls++
  }
  return undefined
}

/** The beat due now, if its whole sequence may start here; undefined otherwise. */
const dueBeat = (gen: Gen, route: Route, entry: CellPort, banned: ReadonlySet<BuildableType>) => {
  if (route.beatsDone >= gen.agenda.length || entry.dir !== 'E') return undefined
  const beat = gen.agenda[route.beatsDone]
  const steps = stepsOf(beat)
  if (steps.length === 0 || route.parMs * 1000 < beat.atPermille * TARGET_PAR_MS) return undefined
  // Simulate the sequence's headings: each step keeps or flips it
  const choices: Array<Choice> = []
  let dir: 'E' | 'W' = 'E'
  for (const st of steps) {
    const c = choice(st.type, { dir, x: 0, top: 0, bottom: 0 })
    choices.push(c)
    dir = c.west ? 'W' : 'E'
  }
  if (banned.has(steps[0].type) || !allowedSequence(gen, route, choices)) return undefined
  return { index: route.beatsDone, steps }
}

/**
 * The next segment. Inside a beat, its next forced step. When a beat is due and its whole
 * sequence may follow here, its first step. Otherwise a weighted pick among the eligible types,
 * re-rolled on the same stream, then the other eligible types in weighted order. Undefined at a
 * dead end.
 */
const nextPlan = (gen: Gen, route: Route, banned: ReadonlySet<BuildableType>): SegmentPlan | undefined => {
  const entry = route.plans[route.plans.length - 1].exit
  if (route.nextStep > 0) {
    const index = route.beatsDone
    const step = stepsOf(gen.agenda[index])[route.nextStep]
    if (banned.has(step.type)) return undefined
    return tryType(gen, route, entry, step, BEAT_REROLLS, { index, step: route.nextStep })
  }
  const due = dueBeat(gen, route, entry, banned)
  if (due) {
    const plan = tryType(gen, route, entry, due.steps[0], BEAT_REROLLS, { index: due.index, step: 0 })
    if (plan) return plan
  }
  let options = eligible(gen, route, entry, banned)
  let tries = MAX_REROLLS
  while (options.length > 0) {
    const pick = gen.rng.weighted(options.map((o) => o.weight))
    const o = options[pick]
    const plan = tryType(gen, route, entry, { type: o.type }, tries, undefined, o.turn)
    if (plan) return plan
    gen.stats.fallbacks++
    options = options.filter((_, i) => i !== pick)
    tries = OTHER_REROLLS
  }
  return undefined
}

/** The finish after the route, heading right with its room past every opening, if it fits. */
const finishFor = (gen: Gen, route: Route) => {
  const entry = route.plans[route.plans.length - 1].exit
  if (!isHorizontal(entry) || entry.dir !== 'E') return undefined
  const finish = planFinish({ entry, clearCol: route.frontier + SEP })
  if (route.parMs + finish.plan.parMs > MAX_PAR_MS) return undefined
  return fits(finish.plan, route.placed, route.plans.length - 1, bandOf(gen, route)) ? finish : undefined
}

/** Profile conditions for finishing: a descent has dropped at least twice what it climbed. */
const ready = (gen: Gen, route: Route): boolean => {
  if (gen.profile.climbRows === undefined) return true
  const { climb, drop } = climbAndDrop(route)
  return drop >= 2 * climb
}

/**
 * One attempt from the start room: add segments until the summed par reaches TARGET_PAR_MS, the
 * agenda is done, the route heads right and the finish fits. At a dead end, pop the last segment
 * and ban its type at that position, up to MAX_POPS times before the route gets past its deepest
 * point again. Undefined when the attempt gives up.
 */
const attempt = (gen: Gen, start: SegmentPlan) => {
  const plans: Array<SegmentPlan> = [start]
  // banned[i]: types that dead-ended at position i
  const banned: Array<Set<BuildableType>> = [new Set(), new Set()]
  // Pops since the route last reached a new depth: each dead end gets MAX_POPS, and par bounds the
  // depth, so this ends
  let pops = 0
  let deepest = 1
  for (;;) {
    const route = routeOf(plans, gen.agenda)
    const finished = route.parMs >= TARGET_PAR_MS && route.beatsDone >= gen.agenda.length && route.nextStep === 0 && ready(gen, route)
    const finish = finished ? finishFor(gen, route) : undefined
    if (finish) return { route, finish }
    // Not done, heading left, or the finish does not fit yet: one more segment
    const plan = nextPlan(gen, route, banned[plans.length])
    if (plan) {
      plans.push(plan)
      banned[plans.length] = new Set()
      if (plans.length > deepest) {
        deepest = plans.length
        pops = 0
      }
      continue
    }
    // Dead end: pop and ban
    if (plans.length <= 1 || pops >= MAX_POPS) return undefined
    const popped = plans.pop()!
    pops++
    gen.stats.pops++
    if (isBuildable(popped.type)) banned[plans.length].add(popped.type)
  }
}

/** The planned stage before it is turned into a grid: segment plans from start to finish. */
export interface StagePlan {
  plans: Array<SegmentPlan>
  bays: ReturnType<typeof planStart>['bays']
  finishCol: number
  parMs: number
  stats: GenStats
}

/**
 * Plans the route: the bay stack and start chamber, segments picked by the archetype's profile and
 * joined mouth to mouth until the summed par reaches TARGET_PAR_MS, then the finish chamber. Dead
 * ends backtrack, then restart from the start room on the same stream; the last resort drops the
 * ceilings.
 */
export const generateStagePlan = (seed: number, difficulty: number, bays: number, archetype: Archetype): StagePlan => {
  const profile = PROFILES[archetype]
  const knobs = profile.adjustKnobs(difficultyKnobs(difficulty))
  const rng = createRng(seed >>> 0)
  const start = planStart(clampBays(bays), profile.startFloor)
  const stats: GenStats = { rerolls: 0, fallbacks: 0, pops: 0, restarts: 0, relaxed: false }
  const agenda = profile.agenda(rng)
  const gen: Gen = { rng, knobs, profile, agenda: withForks(agenda, profile.forkCount(rng)), stats, relaxed: false }
  for (;;) {
    const done = attempt(gen, start.plan)
    if (done) {
      const plans = [...done.route.plans, done.finish.plan]
      return { plans, bays: start.bays, finishCol: done.finish.finishCol, parMs: done.route.parMs + done.finish.plan.parMs, stats }
    }
    if (gen.relaxed) throw new Error(`stage ${seed >>> 0} (${archetype}, d${difficulty}) cannot be generated`)
    if (stats.restarts >= MAX_RESTARTS) {
      gen.relaxed = true
      stats.relaxed = true
    } else {
      stats.restarts++
    }
  }
}

const toSegment = (plan: SegmentPlan): Segment => {
  const span = spanOf(plan)
  let r1 = -Infinity
  for (const r of plan.carves) r1 = Math.max(r1, r.r1)
  const port = (p: CellPort): Port =>
    isHorizontal(p)
      ? { dir: p.dir, x: p.x * CELL, top: p.top * CELL, bottom: p.bottom * CELL }
      : { dir: p.dir, y: p.y * CELL, left: p.left * CELL, right: p.right * CELL }
  return {
    type: plan.type,
    bounds: px({ c0: span.c0, r0: span.r0, c1: span.c1, r1 }),
    entry: port(plan.entry),
    exit: port(plan.exit),
    tunnels: plan.tunnels.map(px),
    chambers: plan.chambers.map(px),
    pads: plan.pads.map((r) => ({ kind: 'bounce', ...px(r) }) as Bounce),
    spine: plan.spine,
    parMs: plan.parMs,
    pits: plan.pits.map((r) => ({ x0: r.c0 * CELL, x1: r.c1 * CELL })),
    ...(plan.slot ? { slot: plan.slot } : {}),
    ...(plan.branches ? { fork: { high: plan.branches.high.map(px), low: plan.branches.low.map(px) } } : {}),
  }
}

/**
 * Generates the stage for a seed, difficulty and bay count (one start bay per player in the
 * round, clamped to 1–8; solo uses 1): the bay stack and start chamber, weighted tunnel segments
 * joined mouth to mouth until the summed par reaches TARGET_PAR_MS, then the finish chamber. Rock
 * fills everything else; the air and sea under the tunnels are split by curtains (pillars down to the
 * sea floor) at every segment start. One PRNG stream and integer arithmetic only, so every client
 * builds the identical stage.
 */
export const generateStage = (
  rawSeed: number,
  difficulty: number,
  bays: number,
  archetype: Archetype = archetypeForSeed(rawSeed),
): RaceStage => {
  const seed = rawSeed >>> 0
  return stageFromPlan(generateStagePlan(seed, difficulty, bays, archetype), seed, difficulty, archetype)
}

/** Turns a stage plan into the stage: the grid, its merged rock and pads, edges and segments. */
export const stageFromPlan = (plan: StagePlan, seed: number, difficulty: number, archetype: Archetype): RaceStage => {
  const { plans, bays: cellBays, finishCol, parMs } = plan
  const finish = plans[plans.length - 1]

  let topRow = 0
  for (const p of plans) topRow = Math.min(topRow, spanOf(p).r0)
  const col0 = -1
  const col1 = spanOf(finish).c1 + 1
  const grid = buildGrid({
    col0,
    col1,
    row0: topRow - 2,
    seaRows: SEA_ROWS,
    carves: plans.flatMap((p, owner) => openings(p).map((r): Carve => ({ ...r, owner }))),
    pads: plans.flatMap((p) => p.pads),
  })

  const solids: Array<Solid> = mergeCells(grid, SOLID).map((r) => ({ kind: 'solid', ...px(r) }))
  const pads: Array<Bounce> = mergeCells(grid, PAD).map((r) => ({ kind: 'bounce', ...px(r) }))
  const edges = boundaryEdges(grid).map((e) => ({
    x0: e.c0 * CELL,
    y0: e.r0 * CELL,
    x1: e.c1 * CELL,
    y1: e.r1 * CELL,
    pad: e.pad,
  }))
  const segments = plans.map(toSegment)
  const spine: Array<Point> = []
  for (const s of segments) spine.push(...s.spine)
  const finishPlan = finish.chambers[0]

  return {
    kind: 'race',
    seed,
    difficulty: clampDifficulty(difficulty),
    cell: CELL,
    bounds: { x: col0 * CELL, y: grid.row0 * CELL, w: grid.cols * CELL, h: grid.rows * CELL },
    seaY: 0,
    segments,
    solids,
    pads,
    edges,
    grid,
    spine,
    startSlots: cellBays.map((b) => b.spawn),
    bays: cellBays.map((b) => ({ spawn: b.spawn, gate: b.gate })),
    finish: { x: finishCol * CELL, top: finishPlan.r0 * CELL, bottom: finishPlan.r1 * CELL, right: finishPlan.c1 * CELL },
    parMs,
    archetype,
  }
}

/** Start cells (one per bay) and the finish room's cells past the line, for the reach check. */
export const reachTargets = (stage: RaceStage): ReachTargets => {
  const g: CellGrid = stage.grid
  const starts = stage.startSlots.map((slot) => cellIndex(g, Math.floor(slot.x / CELL), Math.floor(slot.y / CELL)))
  const finish: Array<number> = []
  const c0 = stage.finish.x / CELL
  for (let row = stage.finish.top / CELL; row < stage.finish.bottom / CELL; row++) {
    for (let col = c0; col < stage.finish.right / CELL; col++) {
      if (g.cells[cellIndex(g, col, row)] === OPEN) finish.push(cellIndex(g, col, row))
    }
  }
  return { starts, finish }
}

export const checkStage = (stage: RaceStage): StageReach => checkGrid(stage.grid, reachTargets(stage), reachOptions)
