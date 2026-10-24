import type { Archetype } from './archetype'
import type { CellGrid } from './grid'

/**
 * Stage model produced by the generator. World coordinates are integer pixels with y growing
 * downward; the energy sea's surface is at `seaY` (0). The stage is built on a grid of CELL px
 * cells: tunnels and chambers are carved out of rock, and the rock is merged into solids.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** A solid block of rock. Contact on any side recharges. */
export interface Solid extends Rect {
  kind: 'solid'
}

/** A pad that sets the orb's vertical velocity to -BOUNCE_PAD_VY when landed on. */
export interface Bounce extends Rect {
  kind: 'bounce'
}

/** Reserved for later slices; the slice 1 generator emits none. */
export interface Boost extends Rect {
  kind: 'boost'
  dir: 1 | -1
}

export interface Hazard extends Rect {
  kind: 'hazard'
}

/** A platform moving on a triangle wave between its rest position and rest + (dx, dy). */
export interface Mover extends Rect {
  kind: 'mover'
  dx: number
  dy: number
  periodMs: number
  phaseMs: number
}

export type Element = Solid | Bounce | Boost | Hazard | Mover

/**
 * A tunnel mouth where one segment hands over to the next, crossed heading `dir`: for E and W,
 * open rows [top, bottom) on the vertical line x; for N and S, open columns [left, right) on the
 * horizontal line y.
 */
export type Port =
  | { dir: 'E' | 'W'; x: number; top: number; bottom: number }
  | { dir: 'N' | 'S'; y: number; left: number; right: number }

/** A glowing boundary line between rock and open space. */
export interface Edge {
  x0: number
  y0: number
  x1: number
  y1: number
  pad: boolean
}

export type SegmentType =
  | 'start'
  | 'run'
  | 'shaftUp'
  | 'shaftDown'
  | 'stallChamber'
  | 'switchback'
  | 'chimney'
  | 'chamber'
  | 'fork'
  | 'finish'
  | 'lobby'

export interface Segment {
  type: SegmentType
  /** Bounding box of the segment's open space. */
  bounds: Rect
  entry: Port
  exit: Port
  /** Tunnel pieces (interior height kept within the tunnel range). */
  tunnels: Array<Rect>
  /** Chambers and shafts (open spaces that are not tunnels). */
  chambers: Array<Rect>
  /** Bounce pads in this segment. */
  pads: Array<Bounce>
  /** Route polyline through the segment, used to measure progress. */
  spine: Array<Point>
  /** Expected time to cross the segment. */
  parMs: number
  /** Floor openings onto the sea, as column spans in px. */
  pits: Array<{ x0: number; x1: number }>
  /** Forks only: each branch's open space (the junctions belong to neither). */
  fork?: { high: Array<Rect>; low: Array<Rect> }
  /** Stall chambers only: the tunnel mouth the pad launch lines up with (orb centres). */
  slot?: { x: number; top: number; bottom: number; apexY: number }
}

/** The finish: crossing x inside the finish chamber's rows, short of its far wall `right`. */
export interface FinishGate {
  x: number
  top: number
  bottom: number
  right: number
}

/**
 * A start bay: a small compartment in the stack at the start, one per player in the round. The
 * gate is a barrier across its opening on the right, shut from the snap until GO.
 */
export interface Bay {
  /** Orb centre resting on the bay floor. */
  spawn: Point
  /** The gate's barrier, across the bay's opening. */
  gate: Rect
}

export interface Stage {
  /** A generated race stage, or the hand-built lobby room (no finish, no bays). */
  kind: 'race' | 'lobby'
  seed: number
  difficulty: number
  cell: number
  bounds: Rect
  seaY: number
  segments: Array<Segment>
  solids: Array<Solid>
  pads: Array<Bounce>
  edges: Array<Edge>
  grid: CellGrid
  spine: Array<Point>
  /**
   * Orb centre spawn points: one per start bay on a race stage (bay i is slot i), or the lobby's
   * spawns in join order.
   */
  startSlots: Array<Point>
  /** Start bays, bottom first; empty in the lobby. */
  bays: Array<Bay>
  /** The finish; the lobby has none. */
  finish?: FinishGate
  parMs: number
}

/** A generated race stage always has a finish, and the archetype that shaped it (never shown to players). */
export type RaceStage = Stage & { kind: 'race'; finish: FinishGate; archetype: Archetype }
