import type { Knobs } from './difficulty'
import type { CellRect } from './grid'
import type { Rng } from './rng'
import type { Point, SegmentType } from './stage'
import { ORB_RADIUS, padApex } from './tuning'

export const rect = (c0: number, r0: number, c1: number, r1: number): CellRect => ({ c0, r0, c1, r1 })

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
export const BUILDABLE_TYPES: ReadonlyArray<BuildableType> = [
  'run',
  'shaftUp',
  'shaftDown',
  'stallChamber',
  'switchback',
  'chimney',
  'chamber',
  'fork',
]

/** Types that can take a vertical (N/S) entry; only `chamber` takes both kinds. */
export const VERTICAL_ENTRY_TYPES: ReadonlySet<BuildableType> = new Set(['chimney', 'chamber'])
export const HORIZONTAL_ENTRY_TYPES: ReadonlySet<BuildableType> = new Set(BUILDABLE_TYPES.filter((t) => t !== 'chimney'))

/** Types whose exit heads back the way they came in. */
export const REVERSING_TYPES: ReadonlySet<BuildableType> = new Set(['switchback'])

/** Travel direction through a port: E/W cross a column line, N/S a row line. */
export type Dir = 'E' | 'W' | 'N' | 'S'

/**
 * A tunnel mouth in cells, crossed heading `dir`. E/W: open rows [top, bottom) on the line between
 * columns x-1 and x. N/S: open columns [left, right) on the line between rows y-1 and y.
 */
export interface HPort {
  dir: 'E' | 'W'
  x: number
  top: number
  bottom: number
}
export interface VPort {
  dir: 'N' | 'S'
  y: number
  left: number
  right: number
}
export type CellPort = HPort | VPort

export const isHorizontal = (p: CellPort): p is HPort => p.dir === 'E' || p.dir === 'W'

/**
 * The line of cells on one side of a port: 'out' is the side the orb leaves (before crossing,
 * heading `dir`), 'in' the side it arrives in. The only place that knows which side is which.
 */
export const portCells = (port: CellPort, side: 'in' | 'out'): CellRect => {
  const ahead = side === 'in'
  switch (port.dir) {
    case 'E':
      return ahead ? rect(port.x, port.top, port.x + 1, port.bottom) : rect(port.x - 1, port.top, port.x, port.bottom)
    case 'W':
      return ahead ? rect(port.x - 1, port.top, port.x, port.bottom) : rect(port.x, port.top, port.x + 1, port.bottom)
    case 'N':
      return ahead ? rect(port.left, port.y - 1, port.right, port.y) : rect(port.left, port.y, port.right, port.y + 1)
    case 'S':
      return ahead ? rect(port.left, port.y, port.right, port.y + 1) : rect(port.left, port.y - 1, port.right, port.y)
  }
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
  /** Floor openings onto the sea: carves from a chamber floor down to the sea surface. */
  pits: Array<CellRect>
  spine: Array<Point>
  parMs: number
  /** Stall chamber mouth, in px (orb centres). */
  slot?: { x: number; top: number; bottom: number; apexY: number }
  /** Set on segments placed by an agenda beat: which beat and which of its steps. */
  beat?: { index: number; step: number }
  /** Forks only: each branch's openings (the junctions and the exit belong to neither). */
  branches?: { high: Array<CellRect>; low: Array<CellRect> }
}

/** Floor points every few cells along a stretch of floor, in travel order (short spine legs). */
const SPINE_STEP = 6
const alongFloor = (from: number, to: number, floorRow: number): Array<Point> => {
  const out: Array<Point> = []
  const dir = to >= from ? 1 : -1
  for (let c = from; dir * (to - c) > 0; c += dir * SPINE_STEP) out.push(floorPoint(c, c + dir, floorRow))
  out.push(floorPoint(to - dir, to, floorRow))
  return out
}

/**
 * The plan reflected about the vertical line x = `axis` (cells): a right-facing template turned
 * into its leftward twin. Integer arithmetic only; E and W swap, N and S keep their sense.
 */
export const mirrorPlan = (plan: SegmentPlan, axis: number): SegmentPlan => {
  const flip = (r: CellRect): CellRect => rect(2 * axis - r.c1, r.r0, 2 * axis - r.c0, r.r1)
  const flipPort = (p: CellPort): CellPort =>
    isHorizontal(p)
      ? { dir: p.dir === 'E' ? 'W' : 'E', x: 2 * axis - p.x, top: p.top, bottom: p.bottom }
      : { dir: p.dir, y: p.y, left: 2 * axis - p.right, right: 2 * axis - p.left }
  const ax = 2 * axis * CELL
  return {
    ...plan,
    entry: flipPort(plan.entry),
    exit: flipPort(plan.exit),
    carves: plan.carves.map(flip),
    tunnels: plan.tunnels.map(flip),
    chambers: plan.chambers.map(flip),
    pads: plan.pads.map(flip),
    pits: plan.pits.map(flip),
    ...(plan.branches ? { branches: { high: plan.branches.high.map(flip), low: plan.branches.low.map(flip) } } : {}),
    spine: plan.spine.map((p) => ({ x: ax - p.x, y: p.y })),
    ...(plan.slot ? { slot: { ...plan.slot, x: ax - plan.slot.x } } : {}),
  }
}

export interface BuildContext<P extends CellPort = HPort> {
  rng: Rng
  entry: P
  knobs: Knobs
  /** Highest row a carve may open (the archetype's band); HIGHEST_ROW when omitted. */
  ceilingRow?: number
  /** Lowest floor a carve may have (above the sea); LOWEST_FLOOR when omitted. */
  floorRow?: number
  /** Shafts: leave through the shaft's end (up through the top, down through the bottom). */
  endPort?: boolean
  /** Chimneys and chambers entered from below or above: which way the tunnel leaves. */
  turn?: 'E' | 'W'
  /** Chambers: most rows the exit floor may sit above the chamber floor. */
  exitRiseMax?: number
  /** Which way run floor steps may go; both when omitted. */
  stepBias?: 'both' | 'up' | 'down'
  /** Switchbacks: return above ('up') or below ('down'); drawn from the stream when omitted. */
  vertical?: 'up' | 'down'
  /** Runs: three or four sections rather than two to four. */
  long?: boolean
  /**
   * Switchbacks: the return tunnel must clear the route it doubles over, so its floor is at or
   * above `upFloorMax` going up, and its ceiling at or below `downTopMin` going down.
   */
  upFloorMax?: number
  downTopMin?: number
  /** Switchbacks: extra rows the chosen side must still have beyond the return (room to turn back). */
  reserveRows?: number
}

const half = (n: number) => (n / 2) | 0

/** A point on the floor of a cell span, at orb-centre height. */
const floorPoint = (c0: number, c1: number, floorRow: number): Point => ({
  x: half((c0 + c1) * CELL),
  y: floorRow * CELL - ORB_RADIUS,
})

const par = (cellsAcross: number, cellsUp: number) =>
  Math.round((cellsAcross * CELL * 1000) / PAR_RUN_SPEED + (Math.max(0, cellsUp) * CELL * 1000) / PAR_CLIMB_SPEED)

const clampFloor = (row: number, ceilingRow: number) => Math.max(ceilingRow + 8, Math.min(LOWEST_FLOOR, row))

/** Bay count for a round: one per player in `startOrder`, clamped to 1–8. */
export const clampBays = (n: number): number =>
  Math.max(MIN_BAYS, Math.min(MAX_BAYS, Number.isFinite(n) ? Math.floor(n) : MIN_BAYS))

/** Floor row of bay i (bay 0 sits on the start floor). */
export const bayFloor = (i: number, startFloor = START_FLOOR) => startFloor - i * BAY_PITCH

/** A bay in cells: its open rows and spawn and gate in px. */
export interface CellBay {
  room: CellRect
  spawn: Point
  gate: { x: number; y: number; w: number; h: number }
}

export const planBays = (bays: number, startFloor = START_FLOOR): Array<CellBay> => {
  const out: Array<CellBay> = []
  for (let i = 0; i < bays; i++) {
    const f = bayFloor(i, startFloor)
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
export const planStart = (bays: number, startFloor = START_FLOOR): { plan: SegmentPlan; bays: Array<CellBay> } => {
  const f = startFloor
  const cellBays = planBays(clampBays(bays), startFloor)
  const topBay = cellBays[cellBays.length - 1].room.r0
  const room = rect(BAY_COLS, Math.min(f - 12, topBay - 2), START_COLS, f)
  const mid = Math.floor((f + topBay) / 2)
  const bottom = Math.min(f, mid + 3)
  const exit: HPort = { dir: 'E', x: START_COLS, top: bottom - 5, bottom }
  return {
    plan: {
      type: 'start',
      entry: { dir: 'E', x: 0, top: room.r0, bottom: f },
      exit,
      carves: [...cellBays.map((b) => b.room), room],
      tunnels: [],
      chambers: [...cellBays.map((b) => b.room), room],
      pads: [],
      pits: [],
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
export const planRun = ({
  rng,
  entry,
  knobs,
  ceilingRow = HIGHEST_ROW,
  stepBias = 'both',
  long = false,
}: BuildContext): SegmentPlan | undefined => {
  const sections = long ? rng.int(3, 4) : rng.int(2, 4)
  const carves: Array<CellRect> = []
  const spine: Array<Point> = []
  let x = entry.x
  let floor = entry.bottom
  let height = entry.bottom - entry.top
  let climb = 0
  for (let i = 0; i < sections; i++) {
    const len = rng.int(knobs.sectionMin, knobs.sectionMax)
    const h = rng.int(knobs.tunnelMin, knobs.tunnelMax)
    const step =
      stepBias === 'both' ? rng.int(-knobs.stepMax, knobs.stepMax) : stepBias === 'up' ? -rng.int(0, knobs.stepMax) : rng.int(0, knobs.stepMax)
    let f = clampFloor(floor + step, ceilingRow)
    if (f - h < ceilingRow) f = floor
    f = linkedFloor(floor, height, f, h)
    // Still poking above the band (a tall section on a high floor): not here
    if (f - h < ceilingRow) return undefined
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
    exit: { dir: 'E', x, top: floor - height, bottom: floor },
    carves,
    tunnels: [...carves],
    chambers: [],
    pads: [],
    pits: [],
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
export const planShaftUp = ({ rng, entry, knobs, ceilingRow = HIGHEST_ROW, endPort }: BuildContext): SegmentPlan | undefined => {
  if (endPort) return shaftUpTop(rng, entry, knobs, ceilingRow)
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const hx = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  let rise = rng.int(knobs.riseMin, knobs.riseMax)
  // Exit floor `rise` rows above the lead tunnel's ceiling, inside the altitude band
  while (rise >= 3 && entry.top - rise - hx < ceilingRow) rise--
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
    exit: { dir: 'E', x, top: fx - hx, bottom: fx },
    carves: [leadIn, ...legs.carves, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: legs.carves,
    pads: [],
    pits: [],
    spine: [
      floorPoint(sx, sx + width, entry.bottom),
      floorPoint(legs.farCol, legs.farCol + width, fx),
      floorPoint(x - 1, x, fx),
    ],
    parMs: par(x - entry.x, entry.bottom - fx),
  }
}

/** Lead-in tunnel, a shaft dropping to a lower tunnel, which leaves to the right. */
export const planShaftDown = ({ rng, entry, knobs, floorRow = LOWEST_FLOOR, endPort }: BuildContext): SegmentPlan | undefined => {
  if (endPort) return shaftDownBottom(rng, entry, knobs, floorRow)
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const drop = Math.min(rng.int(knobs.riseMin, knobs.riseMax), floorRow - entry.bottom)
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
    exit: { dir: 'E', x, top: fb - hx, bottom: fb },
    carves: [leadIn, ...legs.carves, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: legs.carves,
    pads: [],
    pits: [],
    spine: [
      floorPoint(sx, sx + width, entry.bottom),
      floorPoint(legs.farCol, legs.farCol + width, fb),
      floorPoint(x - 1, x, fb),
    ],
    parMs: par(x - entry.x, 0),
  }
}

/** Orb centre in the middle of a shaft's columns at row line `y`, just inside on the side `below`. */
const shaftPoint = (left: number, right: number, y: number, below: boolean): Point => ({
  x: half((left + right) * CELL),
  y: y * CELL + (below ? ORB_RADIUS : -ORB_RADIUS),
})

/** Lead-in tunnel and a straight shaft climbing out through its top: an N port for a chimney or chamber. */
const shaftUpTop = (rng: Rng, entry: HPort, knobs: Knobs, ceilingRow: number): SegmentPlan | undefined => {
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const rise = rng.int(knobs.riseMin, knobs.riseMax)
  // Room above the port for what follows (a chimney's tunnel or a chamber)
  const y = entry.top - rise
  if (y - 10 < ceilingRow) return undefined
  const sx = entry.x + lead
  const leadIn = rect(entry.x, entry.top, sx + width, entry.bottom)
  const shaft = rect(sx, y, sx + width, entry.top)
  return {
    type: 'shaftUp',
    entry,
    exit: { dir: 'N', y, left: sx, right: sx + width },
    carves: [leadIn, shaft],
    tunnels: [leadIn],
    chambers: [shaft],
    pads: [],
    pits: [],
    spine: [floorPoint(sx, sx + width, entry.bottom), shaftPoint(sx, sx + width, y, true)],
    parMs: par(lead + width, entry.bottom - y),
  }
}

/** Lead-in tunnel and a straight shaft dropping out through its bottom: an S port. */
const shaftDownBottom = (rng: Rng, entry: HPort, knobs: Knobs, floorRow: number): SegmentPlan | undefined => {
  const lead = rng.int(2, 4)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  // Room below the port for a chimney's tunnel, with a few rows to spare
  const y = Math.min(entry.bottom + rng.int(knobs.riseMin, knobs.riseMax), floorRow - knobs.tunnelMax - 4)
  if (y - entry.bottom < 3) return undefined
  const sx = entry.x + lead
  const leadIn = rect(entry.x, entry.top, sx + width, entry.bottom)
  const shaft = rect(sx, entry.bottom, sx + width, y)
  return {
    type: 'shaftDown',
    entry,
    exit: { dir: 'S', y, left: sx, right: sx + width },
    carves: [leadIn, shaft],
    tunnels: [leadIn],
    chambers: [shaft],
    pads: [],
    pits: [],
    spine: [floorPoint(sx, sx + width, entry.bottom), shaftPoint(sx, sx + width, y, false)],
    parMs: par(lead + width, 0),
  }
}

/**
 * The corner piece: the shaft arriving through a vertical port carries on a few rows and turns
 * into a tunnel leaving right or left. Going up, the tunnel sits on top of the shaft; going down,
 * the orb drops into the tunnel at its bottom.
 */
export const planChimney = ({
  rng,
  entry,
  knobs,
  ceilingRow = HIGHEST_ROW,
  floorRow = LOWEST_FLOOR,
  turn = 'E',
}: BuildContext<VPort>): SegmentPlan | undefined => {
  const { left, right, y } = entry
  const h = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const up = entry.dir === 'N'
  // Going down, the shaft shortens to keep the tunnel above the band's floor
  const shaftRows = up ? rng.int(1, 4) : Math.max(0, Math.min(rng.int(0, 4), floorRow - y - h))
  // Tunnel floor and the shaft between the port and the tunnel
  const fl = up ? y - shaftRows : y + shaftRows + h
  if (fl - h < ceilingRow || fl > floorRow) return undefined
  const shaft = up ? rect(left, fl, right, y) : rect(left, y, right, fl - h)
  const tunnel = turn === 'E' ? rect(left, fl - h, right + len, fl) : rect(left - len, fl - h, right, fl)
  const x = turn === 'E' ? right + len : left - len
  const shafts = shaft.r1 > shaft.r0 ? [shaft] : []
  return {
    type: 'chimney',
    entry,
    exit: { dir: turn, x, top: fl - h, bottom: fl },
    carves: [...shafts, tunnel],
    tunnels: [tunnel],
    chambers: shafts,
    pads: [],
    pits: [],
    spine: [
      shaftPoint(left, right, y, !up),
      turn === 'E' ? floorPoint(left, right, fl) : floorPoint(left, right, fl),
      ...alongFloor(turn === 'E' ? right : left, x, fl),
    ],
    parMs: par(len + right - left, up ? y - fl : 0),
  }
}

/**
 * Canyon's big room: 10–18 × 9–14 cells, entered through a side wall, its floor (from below) or
 * its ceiling (from above). One or two bounce pads on the floor, maybe a ledge island and a pit
 * onto the sea; it leaves through a side wall at most `exitRiseMax` rows above its floor. Its open
 * space is a chamber, not a tunnel, so the tunnel height limit does not apply.
 */
export const planChamber = ({
  rng,
  entry,
  knobs,
  ceilingRow = HIGHEST_ROW,
  floorRow = LOWEST_FLOOR,
  turn = 'E',
  exitRiseMax = 6,
}: BuildContext<CellPort>): SegmentPlan | undefined => {
  const W = rng.int(10, 18)
  let H = rng.int(9, 14)
  const hx = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const lead: Array<CellRect> = []
  let c0: number
  let f: number
  let entryLevel: number
  let hole: { c0: number; c1: number } | undefined
  if (isHorizontal(entry)) {
    // Entering through the left wall (a leftward entry is mirrored before it gets here)
    f = Math.max(entry.bottom, Math.min(entry.bottom + rng.int(0, 2), floorRow))
    H = Math.max(H, f - entry.top + 2)
    lead.push(rect(entry.x, entry.top, entry.x + 2, entry.bottom))
    c0 = entry.x + 2
    entryLevel = entry.bottom
  } else {
    const w = entry.right - entry.left
    c0 = entry.left - rng.int(2, W - w - 2)
    hole = { c0: entry.left, c1: entry.right }
    f = entry.dir === 'N' ? entry.y : Math.min(entry.y + H, floorRow)
    if (entry.dir === 'S') H = f - entry.y
    entryLevel = entry.y
    if (H < 9) return undefined
  }
  const c1 = c0 + W
  const top = f - H
  if (top < ceilingRow) return undefined
  const rise = Math.max(0, Math.min(rng.int(0, exitRiseMax), H - hx - 2))
  const ef = f - rise
  const exitTunnel = turn === 'E' ? rect(c1, ef - hx, c1 + len, ef) : rect(c0 - len, ef - hx, c0, ef)
  const x = turn === 'E' ? c1 + len : c0 - len
  // Floor features, kept off the hole and the walls: pads, then maybe a pit
  const free = (a: number) => a >= c0 + 1 && a + 2 <= c1 - 1 && (!hole || a + 2 <= hole.c0 - 1 || a >= hole.c1 + 1)
  const taken: Array<number> = []
  const spot = () => {
    for (let tries = 0; tries < 6; tries++) {
      const a = rng.int(c0 + 1, c1 - 3)
      if (free(a) && taken.every((b) => a + 2 < b || a > b + 2)) {
        taken.push(a)
        return a
      }
    }
    return undefined
  }
  const pads: Array<CellRect> = []
  const padCount = rng.int(1, 2)
  for (let i = 0; i < padCount; i++) {
    const a = spot()
    if (a !== undefined) pads.push(rect(a, f, a + 2, f + 1))
  }
  const pits: Array<CellRect> = []
  if (rng.int(0, 2) === 0) {
    const a = spot()
    if (a !== undefined) pits.push(rect(a, f, a + 2, 0))
  }
  // Maybe a ledge island: one row of rock floating in the room
  const room: Array<CellRect> = []
  if (H >= 11 && rng.int(0, 1) === 0) {
    const ir = f - rng.int(4, H - 5)
    const i0 = rng.int(c0 + 2, c1 - 7)
    const i1 = i0 + rng.int(3, 5)
    room.push(rect(c0, top, c1, ir), rect(c0, ir, i0, ir + 1), rect(i1, ir, c1, ir + 1), rect(c0, ir + 1, c1, f))
  } else {
    room.push(rect(c0, top, c1, f))
  }
  const mid = half(c0 + c1)
  const enter: Point = isHorizontal(entry)
    ? floorPoint(entry.x, entry.x + 1, entry.bottom)
    : shaftPoint(entry.left, entry.right, entry.y, entry.dir === 'S')
  return {
    type: 'chamber',
    entry,
    exit: { dir: turn, x, top: ef - hx, bottom: ef },
    carves: [...lead, ...room, exitTunnel],
    tunnels: [...lead, exitTunnel],
    chambers: room,
    pads,
    pits,
    spine: [
      enter,
      floorPoint(mid, mid + 1, f),
      floorPoint(turn === 'E' ? c1 - 1 : c0, turn === 'E' ? c1 : c0 + 1, ef),
      ...alongFloor(turn === 'E' ? c1 : c0, x, ef),
    ],
    parMs: par(W + len + (isHorizontal(entry) ? 2 : 0), Math.max(0, entryLevel - ef)),
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
export const planStallChamber = ({ rng, entry, knobs, ceilingRow = HIGHEST_ROW }: BuildContext): SegmentPlan | undefined => {
  const f = entry.bottom
  const cx0 = entry.x + 2
  const pit0 = cx0 + 2
  const p0 = pit0 + 2 + rng.int(2, 3)
  const cx1 = p0 + 2 + rng.int(1, 3)
  const apexY = f * CELL - ORB_RADIUS - padApex()
  const m = knobs.mouthRows
  const t = mouthFor(apexY, m)
  if (t === undefined || t - 2 < ceilingRow) return undefined
  const hx = Math.max(m, rng.int(knobs.tunnelMin, knobs.tunnelMax))
  if (t + m - hx < ceilingRow) return undefined
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const leadIn = rect(entry.x, entry.top, cx0, f)
  const chamber = rect(cx0, t - 2, cx1, f)
  const slotTunnel = rect(cx1, t, cx1 + 2, t + m)
  const exitTunnel = rect(cx1 + 2, t + m - hx, cx1 + 2 + len, t + m)
  const x = cx1 + 2 + len
  return {
    type: 'stallChamber',
    entry,
    exit: { dir: 'E', x, top: t + m - hx, bottom: t + m },
    carves: [leadIn, chamber, slotTunnel, exitTunnel],
    tunnels: [leadIn, exitTunnel],
    chambers: [chamber, slotTunnel],
    pads: [rect(p0, f, p0 + 2, f + 1)],
    pits: [rect(pit0, f, pit0 + 2, 0)],
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

/**
 * A switchback: a lead-in tunnel, a shaft at its far end, and a return tunnel stacked above (or
 * below) the lead with 2–6 rows of rock between, heading back the way the orb came. The return
 * may run past the entry, over or under the route before it.
 */
export const planSwitchback = ({
  rng,
  entry,
  knobs,
  ceilingRow = HIGHEST_ROW,
  vertical,
  upFloorMax = entry.top - 2,
  downTopMin = entry.bottom + 2,
  reserveRows = 0,
}: BuildContext): SegmentPlan | undefined => {
  const lead = rng.int(knobs.sectionMin, knobs.sectionMax)
  const width = rng.int(knobs.shaftMin, knobs.shaftMax)
  const h = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  const back = width + rng.int(knobs.sectionMin, knobs.sectionMax)
  // Rock rows between the tunnels: 2–6, more to clear the route below or above, fewer when the
  // band is tight; go whichever way has room
  const needUp = Math.max(2, entry.top - upFloorMax)
  const needDown = Math.max(2, downTopMin - entry.bottom)
  const roomUp = entry.top - h - ceilingRow
  const roomDown = LOWEST_FLOOR - entry.bottom - h
  const canUp = vertical !== 'down' && roomUp >= needUp + reserveRows
  const canDown = vertical !== 'up' && roomDown >= needDown + reserveRows
  if (!canUp && !canDown) return undefined
  const up = canUp && canDown ? rng.int(0, 1) === 0 : canUp
  const gap = Math.max(up ? needUp : needDown, Math.min(rng.int(2, 6), up ? roomUp : roomDown))
  const sx = entry.x + lead
  const ex = sx + width
  const leadIn = rect(entry.x, entry.top, ex, entry.bottom)
  // Return floor and the shaft joining the two tunnels
  const fr = up ? entry.top - gap : entry.bottom + gap + h
  if (up ? fr - h < ceilingRow : fr > LOWEST_FLOOR) return undefined
  const ret = rect(ex - back, fr - h, ex, fr)
  const shaft = up ? rect(sx, fr, ex, entry.top) : rect(sx, entry.bottom, ex, fr - h)
  const x = ex - back
  return {
    type: 'switchback',
    entry,
    exit: { dir: 'W', x, top: fr - h, bottom: fr },
    carves: [leadIn, shaft, ret],
    tunnels: [leadIn, ret],
    chambers: [shaft],
    pads: [],
    pits: [],
    spine: [...alongFloor(entry.x, sx, entry.bottom), floorPoint(sx, ex, entry.bottom), ...alongFloor(ex, x, fr)],
    parMs: par(lead + back, up ? entry.bottom - fr : 0),
  }
}

/**
 * A fork: two tunnels that split and rejoin. The low branch is the long easy way, a taller tunnel
 * whose floor dips (unless it is on the band's floor); the high branch runs above it over an island of 2–3 rows of rock, short but
 * technical, with two of three features: a squeeze (a 150 px stretch), a wall-bounce step (the
 * floor jumps 3 rows) and a slot wall (a wall with a 100 px slot at its foot). Sometimes a drop
 * hole falls from the high branch into the low one. Tall junction rooms at either end join both.
 * Spine and par follow the low branch.
 */
export const planFork = ({ rng, entry, knobs, ceilingRow = HIGHEST_ROW, floorRow = LOWEST_FLOOR }: BuildContext): SegmentPlan | undefined => {
  const f = entry.bottom
  const L = rng.int(14, 22)
  // The low branch dips 2–3 rows, less near the bottom of the band
  const dip = Math.max(0, Math.min(rng.int(2, 3), floorRow - entry.bottom))
  const hh = rng.int(4, 5)
  const hl = rng.int(Math.max(knobs.tunnelMin, hh + 1 - dip), 8 - dip)
  const island = rng.int(2, 3)
  const hx = rng.int(knobs.tunnelMin, knobs.tunnelMax)
  const len = rng.int(knobs.sectionMin, knobs.sectionMax)
  const omit = rng.int(0, 2)
  const squeeze = omit !== 0
  const step = omit !== 1
  const slot = omit !== 2
  const hole = rng.int(0, 2) === 0
  const x0 = entry.x + 3
  const x1 = x0 + L
  const tl = f - hl
  const fh = tl - island
  // The high branch column by column: floor and top
  const sqAt = x0 + 3
  const slotAt = x0 + (L >> 1)
  const stepAt = x1 - 5
  const floorAt = (c: number) => (step && c >= stepAt ? fh - 3 : fh)
  const topAt = (c: number) => {
    const fl = floorAt(c)
    if (squeeze && c >= sqAt && c < sqAt + 3) return fl - 3
    if (slot && c === slotAt) return fl - 2
    return fl - hh
  }
  let highTop = Infinity
  for (let c = x0; c < x1; c++) highTop = Math.min(highTop, topAt(c))
  if (highTop - 1 < ceilingRow) return undefined
  const high: Array<CellRect> = []
  const highTunnels: Array<CellRect> = []
  const highChambers: Array<CellRect> = []
  for (let c = x0; c < x1; ) {
    let e = c + 1
    while (e < x1 && floorAt(e) === floorAt(c) && topAt(e) === topAt(c)) e++
    const r = rect(c, topAt(c), e, floorAt(c))
    high.push(r)
    // The slot is narrower than a tunnel: count it as a chamber piece
    if (r.r1 - r.r0 < 3) highChambers.push(r)
    else highTunnels.push(r)
    c = e
  }
  if (hole) {
    const at = x0 + 6
    const r = rect(at, floorAt(at), at + 2, tl)
    high.push(r)
    highChambers.push(r)
  }
  // The low branch: level, a dip, level again
  const a = x0 + (L >> 2)
  const b = x1 - (L >> 2)
  const low = [rect(x0, tl, a, f), rect(a, tl, b, f + dip), rect(b, tl, x1, f)]
  const split = rect(entry.x, Math.min(entry.top, topAt(x0)), x0, f)
  const merge = rect(x1, Math.min(topAt(x1 - 1), f - hx), x1 + 3, f)
  const exitTunnel = rect(x1 + 3, f - hx, x1 + 3 + len, f)
  const x = x1 + 3 + len
  return {
    type: 'fork',
    entry,
    exit: { dir: 'E', x, top: f - hx, bottom: f },
    carves: [split, ...high, ...low, merge, exitTunnel],
    tunnels: [...highTunnels, ...low, exitTunnel],
    chambers: [split, ...highChambers, merge],
    pads: [],
    pits: [],
    branches: { high, low },
    spine: [
      floorPoint(entry.x, x0, f),
      ...alongFloor(x0, a, f),
      ...alongFloor(a, b, f + dip),
      ...alongFloor(b, x1, f),
      floorPoint(x1, x1 + 3, f),
      ...alongFloor(x1 + 3, x, f),
    ],
    parMs: par(x - entry.x, dip),
  }
}

/**
 * The finish: an approach tunnel at the arriving tunnel's rows out past every earlier opening
 * (`clearCol`, the first column clear of them), then the finish chamber, which the finish line
 * crosses. So the finish room sits strictly right of the rest of the stage.
 */
export const planFinish = ({ entry, clearCol = entry.x }: { entry: HPort; clearCol?: number }): { plan: SegmentPlan; finishCol: number } => {
  const f = entry.bottom
  const h = Math.max(6, entry.bottom - entry.top)
  const r0 = Math.max(entry.x + 2, clearCol)
  const leadIn = rect(entry.x, entry.top, r0, f)
  const room = rect(r0, f - h, r0 + 12, f)
  const finishCol = r0 + 6
  return {
    plan: {
      type: 'finish',
      entry,
      exit: { dir: 'E', x: r0 + 12, top: f - h, bottom: f },
      carves: [leadIn, room],
      tunnels: [leadIn],
      chambers: [room],
      pads: [],
      pits: [],
      spine: r0 > entry.x + 2 ? [...alongFloor(entry.x, r0, f), floorPoint(finishCol, finishCol, f)] : [floorPoint(finishCol, finishCol, f)],
      parMs: par(finishCol - entry.x, 0),
    },
    finishCol,
  }
}

/** A right-facing template. */
const planEast = (type: BuildableType, ctx: BuildContext): SegmentPlan | undefined => {
  switch (type) {
    case 'chimney':
      return undefined
    case 'chamber':
      return planChamber({ ...ctx, turn: 'E' })
    case 'run':
      return planRun(ctx)
    case 'shaftUp':
      return planShaftUp(ctx)
    case 'shaftDown':
      return planShaftDown(ctx)
    case 'stallChamber':
      return planStallChamber(ctx)
    case 'switchback':
      return planSwitchback(ctx)
    case 'fork':
      return planFork(ctx)
  }
}

/**
 * One segment entering through `ctx.entry`: the right-facing template, or for a leftward entry
 * that template mirrored about the entry line; a vertical entry takes a chimney or a chamber,
 * leaving the way `ctx.turn` says.
 */
export const planSegment = (type: BuildableType, ctx: BuildContext<CellPort>): SegmentPlan | undefined => {
  const entry = ctx.entry
  if (!isHorizontal(entry)) {
    if (type === 'chimney') return planChimney({ ...ctx, entry })
    if (type === 'chamber') return planChamber(ctx)
    return undefined
  }
  if (entry.dir === 'E') return planEast(type, { ...ctx, entry })
  const plan = planEast(type, { ...ctx, entry: { ...entry, dir: 'E' } })
  return plan && mirrorPlan(plan, entry.x)
}
