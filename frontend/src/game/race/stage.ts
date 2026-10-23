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

/** A tunnel mouth where one segment hands over to the next: open rows [top, bottom) at column x. */
export interface Port {
  x: number
  top: number
  bottom: number
}

/** A glowing boundary line between rock and open space. */
export interface Edge {
  x0: number
  y0: number
  x1: number
  y1: number
  pad: boolean
}

export type SegmentType = 'start' | 'run' | 'shaftUp' | 'shaftDown' | 'stallChamber' | 'finish'

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
  /** Stall chambers only: the tunnel mouth the pad launch lines up with (orb centres). */
  slot?: { x: number; top: number; bottom: number; apexY: number }
}

/** The finish: crossing x inside the finish chamber's rows. */
export interface FinishGate {
  x: number
  top: number
  bottom: number
}

export interface Stage {
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
  /** Orb centre positions for the start, stacked upward in the start chamber. */
  startSlots: Array<Point>
  finish: FinishGate
  parMs: number
}
