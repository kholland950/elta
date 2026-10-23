import type { Knobs } from './difficulty'
import type { CellRect } from './grid'
import type { Rng } from './rng'
import type { Point, SegmentType } from './stage'
import { ORB_RADIUS, padApex } from './tuning'

/**
 * Segment templates, laid out in grid cells. Each one carves tunnels and chambers out of rock to
 * the right of its entry mouth and hands over at an exit mouth, so segments never share columns.
 * Only integer arithmetic is used, so the same seed builds the same stage everywhere.
 */

/** Grid cell size in px. */
export const CELL = 50
export const SEA_ROWS = 2
/** Lowest floor row: keeps at least three rows of air between tunnels and the sea. */
export const LOWEST_FLOOR = -4
/** Highest open row (3000 px above the sea). */
export const HIGHEST_ROW = -60
export const START_FLOOR = -6
/** Start bays: one per player in the round, stacked upward from the start floor. */
export const MIN_BAYS = 1
export const MAX_BAYS = 8
/** Bay interior height and the pitch between bay floors (one row of rock between bays). */
export const BAY_ROWS = 2
export const BAY_PITCH = 3
/** Bay depth in cells, from the stage's left wall to the bay's opening. */
export const BAY_COLS = 4
/** The start room's width in cells: the bay stack plus the shared start chamber. */
export const START_COLS = 14
/** Gate barrier thickness in px, just inside each bay's opening. */
export const GATE_W = 16
/** Spawn x inside a bay (orb centre), clear of the gate. */
export const BAY_SPAWN_X = 80
/** Par speeds: average travel and climbing speed of a decent run. */
export const PAR_RUN_SPEED = 600
export const PAR_CLIMB_SPEED = 300

export type BuildableType = Exclude<SegmentType, 'start' | 'finish' | 'lobby'>
export const BUILDABLE_TYPES: ReadonlyArray<BuildableType> = ['run', 'shaftUp', 'shaftDown', 'stallChamber']

/** A tunnel mouth in cells: open rows [top, bottom) entering column x. */
export interface CellPort {
  x: number
  top: number
  bottom: number
}

/** One segment in cells, before it is placed into the stage grid. */
export interface SegmentPlan {
  type: SegmentType
  entry: CellPort
  exit: CellPort
  carves: Array<CellRect>
  tunnels: Array<CellRect>
  chambers: Array<CellRect>
  pads: Array<CellRect>
  pitCols: Array<number>
  spine: Array<Point>
  parMs: number
  /** Stall chamber mouth, in px (orb centres). */
  slot?: { x: number; top: number; bottom: number; apexY: number }
}

export interface BuildContext {
  rng: Rng
  entry: CellPort
  knobs: Knobs
}

const rect = (c0: number, r0: number, c1: number, r1: number): CellRect => ({ c0, r0, c1, r1 })

const half = (n: number) => (n / 2) | 0

/** A point on the floor of a cell span, at orb-centre height. */
const floorPoint = (c0: number, c1: number, floorRow: number): Point => ({
  x: half((c0 + c1) * CELL),
  y: floorRow * CELL - ORB_RADIUS,
})

const par = (cellsAcross: number, cellsUp: number) =>
  Math.round((cellsAcross * CELL * 1000) / PAR_RUN_SPEED + (Math.max(0, cellsUp) * CELL * 1000) / PAR_CLIMB_SPEED)

const clampFloor = (row: number) => Math.max(HIGHEST_ROW + 8, Math.min(LOWEST_FLOOR, row))

/** Bay count for a round: one per player in `startOrder`, clamped to 1–8. */
export const clampBays = (n: number): number =>
  Math.max(MIN_BAYS, Math.min(MAX_BAYS, Number.isFinite(n) ? Math.floor(n) : MIN_BAYS))

/** Floor row of bay i (bay 0 sits on the start floor). */
export const bayFloor = (i: number) => START_FLOOR - i * BAY_PITCH

/** A bay in cells: its open rows and spawn and gate in px. */
export interface CellBay {
  room: CellRect
  spawn: Point
  gate: { x: number; y: number; w: number; h: number }
}

export const planBays = (bays: number): Array<CellBay> => {
  const out: Array<CellBay> = []
  for (let i = 0; i < bays; i++) {
    const f = bayFloor(i)
    out.push({
      room: rect(0, f - BAY_ROWS, BAY_COLS, f),
      spawn: { x: BAY_SPAWN_X, y: f * CELL - ORB_RADIUS - 1 },
      gate: { x: BAY_COLS * CELL - GATE_W, y: (f - BAY_ROWS) * CELL, w: GATE_W, h: BAY_ROWS * CELL },
    })
  }
  return out
}

/**
 * The start: a vertical stack of gate bays on the left, each opening right into one shared start
 * chamber, whose tunnel mouth on the right sits level with the middle of the stack (so no bay is
 * much further from it than another). With one or two bays the mouth is on the chamber floor.
 */
export const planStart = (bays: number): { plan: SegmentPlan; bays: Array<CellBay> } => {
  const f = START_FLOOR
  const cellBays = planBays(clampBays(bays))
  const topBay = cellBays[cellBays.length - 1].room.r0
  const room = rect(BAY_COLS, Math.min(f - 12, topBay - 2), START_COLS, f)
  const mid = Math.floor((f + topBay) / 2)
  const bottom = Math.min(f, mid + 3)
  const exit = { x: START_COLS, top: bottom - 5, bottom }
  return {
    plan: {
      type: 'start',
      entry: { x: 0, top: room.r0, bottom: f },
      exit,
      carves: [...cellBays.map((b) => b.room), room],
      tunnels: [],
      chambers: [...cellBays.map((b) => b.room), room],
      pads: [],
      pitCols: [],
      spine: [cellBays[0].spawn, floorPoint(START_COLS - 1, START_COLS, bottom)],
      parMs: par(START_COLS - 3, 0),
    },
    bays: cellBays,
  }
}

/** Keeps a new piece's floor so it shares at least two open rows with the previous piece. */
const linkedFloor = (prevFloor: number, prevHeight: number, floor: number, height: number) => {
  const shared = Math.min(prevFloor, floor) - Math.max(prevFloor - prevHeight, floor - height)
  return shared >= 2 ? floor : prevFloor
}

/** A horizontal tunnel of 2–4 sections with floor steps and the odd ceiling bump. */
export const planRun = ({ rng, entry, knobs }: BuildContext): SegmentPlan => {
  const sections = rng.int(2, 4)
  const carves: Array<CellRect> = []
  const spine: Array<Point> = []
  let x = entry.x
  let floor = entry.bottom
  let height = entry.bottom - entry.top
  let climb = 0
  for (let i = 0; i < sections; i++) {
    const len = rng.int(knobs.sectionMin, knobs.sectionMax)
    const h = rng.int(knobs.tunnelMin, knobs.tunnelMax)
    let f = clampFloor(floor + rng.int(-knobs.stepMax, knobs.stepMax))
    if (f - h < HIGHEST_ROW) f = floor
    f = linkedFloor(floor, height, f, h)
    if (f < floor) climb += floor - f
    const bump = rng.int(0, 1) === 1 && len >= 8 && h >= 5 ? rng.int(1, h - 3) : 0
    if (bump > 0) {
      // A lower stretch of ceiling in the middle of the section
      const a = x + rng.int(2, half(len) - 1)
      const b = a + rng.int(2, half(len) - 1)
      carves.push(rect(x, f - h, a, f), rect(a, f - h + bump, b, f), rect(b, f - h, x + len, f))
    } else {
      carves.push(rect(x, f - h, x + len, f))
    }
    spine.push(floorPoint(x, x + len, f))
    x += len
    floor = f
    height = h
  }
  spine.push(floorPoint(x - 1, x, floor))
  return {
    type: 'run',
    entry,
    exit: { x, top: floor - height, bottom: floor },
    carves,
    tunnels: [...carves],
    chambers: [],
    pads: [],
    pitCols: [],
    spine,
    parMs: par(x - entry.x, climb),
  }
}

/**
 * The column(s) of a vertical shaft between rows [r0, r1), optionally jogging sideways halfway
 * (a zigzag) with a two-row connector. The near leg (column `sx`) is the end the orb enters: the
 * bottom for a shaft going up, the top for one going down. Returns the carves and the far leg's
 * column, where the exit tunnel leaves.
 */
const shaftLegs = (
  rng: Rng,
  sx: number,
  width: number,
  r0: number,
  r1: number,
  minCol: number,
  enterAtBottom: boolean,
): { carves: Array<CellRect>; farCol: number } => {
  if (r1 - r0 < 8 || rng.int(0, 1) === 0) return { carves: [rect(sx, r0, sx + width, r1)], farCol: sx }
  const mid = r0 + half(r1 - r0)
  let off = rng.int(-2, 3)
  if (off === 0) off = 1
  const s2 = Math.max(minCol, sx + off)
  const lo = Math.min(sx, s2)
  const hi = Math.max(sx, s2) + width
  const upperCol = enterAtBottom ? s2 : sx
  const lowerCol = enterAtBottom ? sx : s2
  return {
    carves: [
      rect(upperCol, r0, upperCol + width, mid + 1),
      rect(lo, mid - 1, hi, mid + 1),
      rect(lowerCol, mid - 1, lowerCol + width, r1),
    ],
    farCol: s2,
  }
}

/** Lead-in tunnel, a shaft climbing to a higher tunnel, which leaves to the right. */
export const planShaftUp = ({ rng, entry, knobs }: BuildContext): SegmentPlan | undefined => {
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const hx = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  let rise = rng.int(knobs.riseMin, knobs.riseMax)
  // Exit floor `rise` rows above the lead tunnel's ceiling, inside the altitude band
  while (rise >= 3 && entry.top - rise - hx < HIGHEST_ROW) rise--
  if (rise < 3) return undefined
  const fx = entry.top - rise
  const sx = entry.x + lead
  const leadIn = rect(entry.x, entry.top, sx + width, entry.bottom)
  // The shaft runs from the lead's ceiling up through the exit tunnel's rows
  const legs = shaftLegs(rng, sx, width, fx - hx, entry.top, entry.x, true)
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const exitTunnel = rect(legs.farCol, fx - hx, legs.farCol + width + len, fx)
  const x = legs.farCol + width + len
  return {
    type: 'shaftUp',
    entry,
    exit: { x, top: fx - hx, bottom: fx },
    carves: [leadIn, ...legs.carves, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: legs.carves,
    pads: [],
    pitCols: [],
    spine: [
      floorPoint(sx, sx + width, entry.bottom),
      floorPoint(legs.farCol, legs.farCol + width, fx),
      floorPoint(x - 1, x, fx),
    ],
    parMs: par(x - entry.x, entry.bottom - fx),
  }
}

/** Lead-in tunnel, a shaft dropping to a lower tunnel, which leaves to the right. */
export const planShaftDown = ({ rng, entry, knobs }: BuildContext): SegmentPlan | undefined => {
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const drop = Math.min(rng.int(knobs.riseMin, knobs.riseMax), LOWEST_FLOOR - entry.bottom)
  // At least one row of rock between the lead's floor and the exit tunnel's ceiling
  const hx = Math.min(rng.int(knobs.tunnelMin, knobs.tunnelMax), drop - 1)
  if (hx < knobs.tunnelMin) return undefined
  const fb = entry.bottom + drop
  const sx = entry.x + lead
  const leadIn = rect(entry.x, entry.top, sx + width, entry.bottom)
  const legs = shaftLegs(rng, sx, width, entry.top, fb, entry.x, false)
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const exitTunnel = rect(legs.farCol, fb - hx, legs.farCol + width + len, fb)
  const x = legs.farCol + width + len
  return {
    type: 'shaftDown',
    entry,
    exit: { x, top: fb - hx, bottom: fb },
    carves: [leadIn, ...legs.carves, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: legs.carves,
    pads: [],
    pitCols: [],
    spine: [
      floorPoint(sx, sx + width, entry.bottom),
      floorPoint(legs.farCol, legs.farCol + width, fb),
      floorPoint(x - 1, x, fb),
    ],
    parMs: par(x - entry.x, 0),
  }
}

/**
 * Mouth rows for a pad launch peaking at `apexY`: the orb fits at the apex, and the apex sits as
 * close as possible to a quarter of the mouth above its centre (so a stall there leaves room to
 * drop while dashing in).
 */
export const mouthFor = (apexY: number, rows: number): number | undefined => {
  const h = rows * CELL
  let best: number | undefined
  let bestScore = Infinity
  const guess = Math.floor(apexY / CELL)
  for (let t = guess - rows - 1; t <= guess + 1; t++) {
    const top = t * CELL
    if (apexY - ORB_RADIUS < top || apexY + ORB_RADIUS > top + h) continue
    const centre = top + half(h)
    const score = Math.abs(centre - apexY - (h >> 2))
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  return best
}

/**
 * A small chamber: a landing, a pit in the floor onto the sea, then a bounce pad below a tunnel
 * mouth cut into the far wall at the pad's apex. Bounce, stall at the top, dash into the mouth; or
 * climb the far wall the slow way. The mouth narrows to a short slot, then opens into a tunnel.
 */
export const planStallChamber = ({ rng, entry, knobs }: BuildContext): SegmentPlan | undefined => {
  const f = entry.bottom
  const cx0 = entry.x + 2
  const pit0 = cx0 + 2
  const p0 = pit0 + 2 + rng.int(2, 3)
  const cx1 = p0 + 2 + rng.int(1, 3)
  const apexY = f * CELL - ORB_RADIUS - padApex()
  const m = knobs.mouthRows
  const t = mouthFor(apexY, m)
  if (t === undefined || t - 2 < HIGHEST_ROW) return undefined
  const hx = Math.max(m, rng.int(knobs.tunnelMin, knobs.tunnelMax))
  if (t + m - hx < HIGHEST_ROW) return undefined
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const leadIn = rect(entry.x, entry.top, cx0, f)
  const chamber = rect(cx0, t - 2, cx1, f)
  const slotTunnel = rect(cx1, t, cx1 + 2, t + m)
  const exitTunnel = rect(cx1 + 2, t + m - hx, cx1 + 2 + len, t + m)
  const x = cx1 + 2 + len
  return {
    type: 'stallChamber',
    entry,
    exit: { x, top: t + m - hx, bottom: t + m },
    carves: [leadIn, chamber, slotTunnel, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: [chamber, slotTunnel],
    pads: [rect(p0, f, p0 + 2, f + 1)],
    pitCols: [pit0, pit0 + 1],
    spine: [
      floorPoint(cx0, cx0 + 2, f),
      floorPoint(p0, p0 + 2, f),
      { x: (p0 + 1) * CELL, y: apexY },
      { x: (cx1 + 2) * CELL, y: apexY },
      floorPoint(x - 1, x, t + m),
    ],
    parMs: par(x - entry.x, f - (t + m)),
    slot: { x: cx1 * CELL, top: t * CELL, bottom: (t + m) * CELL, apexY },
  }
}

/** The finish chamber; the finish line crosses it. */
export const planFinish = ({ entry }: { entry: CellPort }): { plan: SegmentPlan; finishCol: number } => {
  const f = entry.bottom
  const h = Math.max(6, entry.bottom - entry.top)
  const leadIn = rect(entry.x, entry.top, entry.x + 2, f)
  const room = rect(entry.x + 2, f - h, entry.x + 14, f)
  const finishCol = entry.x + 8
  return {
    plan: {
      type: 'finish',
      entry,
      exit: { x: entry.x + 14, top: f - h, bottom: f },
      carves: [leadIn, room],
      tunnels: [leadIn],
      chambers: [room],
      pads: [],
      pitCols: [],
      spine: [floorPoint(finishCol, finishCol, f)],
      parMs: par(finishCol - entry.x, 0),
    },
    finishCol,
  }
}

export const planSegment = (type: BuildableType, ctx: BuildContext): SegmentPlan | undefined => {
  switch (type) {
    case 'run':
      return planRun(ctx)
    case 'shaftUp':
      return planShaftUp(ctx)
    case 'shaftDown':
      return planShaftDown(ctx)
    case 'stallChamber':
      return planStallChamber(ctx)
  }
}
