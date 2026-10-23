import { CellGrid, cellAt, OPEN, PAD } from './grid'
import { CLIMB_BUDGET, GAP_BUDGET } from './tuning'

/**
 * Reach check over the cell grid. The orb carries "flight energy": touching anything (floor, wall,
 * ceiling, pad, the sea floor) refills it, since every surface recharges. Moving up a cell or
 * sideways a cell spends energy, falling is free. A full charge buys CLIMB_BUDGET of climb or
 * GAP_BUDGET of sideways flight, and spending on both at once is counted in full for each, so the
 * check is stricter than the real flap arc. Climbing between the walls of a narrow shaft works the
 * way it does in the game: every wall cell beside the orb refills it.
 *
 * A bounce pad launches straight up its column to the pad apex with a full charge, which is how
 * the stall chamber's bounce-stall-dash reaches its tunnel mouth.
 */

export const ENERGY_MAX = CLIMB_BUDGET * GAP_BUDGET

export interface ReachOptions {
  cellSize: number
  /** Pad launch height in whole cells. */
  padApexCells: number
}

const opened = (g: CellGrid, col: number, row: number) => cellAt(g, col, row) === OPEN

/** Whether an open cell touches a surface. The grid edge and the sea floor count as surfaces. */
export const touchesSurface = (g: CellGrid, col: number, row: number): boolean =>
  !opened(g, col - 1, row) || !opened(g, col + 1, row) || !opened(g, col, row - 1) || !opened(g, col, row + 1)

/**
 * Best remaining energy for every cell reachable from `starts` (cell indices); -1 where unreached.
 * Works on a copy of the grid with a one-cell solid border, so neighbours need no bounds checks.
 */
export const reachFrom = (g: CellGrid, starts: ReadonlyArray<number>, opts: ReachOptions): Int32Array => {
  const W = g.cols + 2
  const H = g.rows + 2
  const open = new Uint8Array(W * H)
  const padBelow = new Uint8Array(W * H)
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const v = g.cells[r * g.cols + c]
      const k = (r + 1) * W + c + 1
      if (v === OPEN) open[k] = 1
      else if (v === PAD) padBelow[k - W] = 1
    }
  }
  const touches = new Uint8Array(W * H)
  for (let k = W; k < W * (H - 1); k++) {
    if (open[k] && (!open[k - 1] || !open[k + 1] || !open[k - W] || !open[k + W])) touches[k] = 1
  }
  // Rows at or below the sea surface (row 0) are in the sea
  const seaFromK = (1 - g.row0) * W

  const n = W * H
  const best = new Int32Array(n).fill(-1)
  const upCost = GAP_BUDGET * opts.cellSize
  const sideCost = CLIMB_BUDGET * opts.cellSize
  const queue = new Int32Array(n + 1)
  const queued = new Uint8Array(n)
  let head = 0
  let tail = 0
  const push = (k: number, e: number) => {
    if (!open[k] || e <= best[k]) return
    best[k] = e
    if (queued[k]) return
    queued[k] = 1
    queue[tail] = k
    tail = tail === n ? 0 : tail + 1
  }
  const toK = (i: number) => (Math.floor(i / g.cols) + 1) * W + (i % g.cols) + 1
  for (const s of starts) push(toK(s), ENERGY_MAX)

  while (head !== tail) {
    const k = queue[head]
    head = head === n ? 0 : head + 1
    queued[k] = 0
    const e = touches[k] ? ENERGY_MAX : best[k]
    if (e > best[k]) best[k] = e
    // Sea drag makes climbing inside the sea cost double
    const up = k >= seaFromK ? upCost * 2 : upCost
    if (e >= up) push(k - W, e - up)
    push(k + W, e)
    if (e >= sideCost) {
      push(k - 1, e - sideCost)
      push(k + 1, e - sideCost)
    }
    if (padBelow[k]) {
      for (let j = 1; j <= opts.padApexCells && open[k - j * W]; j++) push(k - j * W, ENERGY_MAX)
    }
  }

  const out = new Int32Array(g.cols * g.rows)
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) out[r * g.cols + c] = best[(r + 1) * W + c + 1]
  }
  return out
}

export interface StageReach {
  /** Some finish cell is reachable from the start. */
  startToFinish: boolean
  /** The orb can get from the start into the sea (through a chamber pit). */
  seaReachableFromStart: boolean
  /** From the sea floor the finish is reachable again: the sea is never a softlock. */
  seaToFinish: boolean
}

export interface ReachTargets {
  start: number
  /** Cell indices inside the finish gate. */
  finish: ReadonlyArray<number>
}

/**
 * Whole-stage check. The sea floor is one connected strip (curtains stop at the sea surface), so a
 * single run from any sea-floor cell stands for every sea node.
 */
export const checkGrid = (g: CellGrid, targets: ReachTargets, opts: ReachOptions): StageReach => {
  const fromStart = reachFrom(g, [targets.start], opts)
  const seaFloorRow = g.row0 + g.rows - 1
  let seaReachableFromStart = false
  for (let col = g.col0; col < g.col0 + g.cols && !seaReachableFromStart; col++) {
    for (let row = 0; row <= seaFloorRow; row++) {
      if (fromStart[(row - g.row0) * g.cols + (col - g.col0)] >= 0) seaReachableFromStart = true
    }
  }
  const fromSea = reachFrom(g, [(seaFloorRow - g.row0) * g.cols], opts)
  return {
    startToFinish: targets.finish.some((i) => fromStart[i] >= 0),
    seaReachableFromStart,
    seaToFinish: targets.finish.some((i) => fromSea[i] >= 0),
  }
}
