/**
 * The stage as a grid of square cells. Segments carve open space (tunnels and chambers) out of
 * solid rock; everything not carved is rock, except the air under the tunnels (above the sea) and
 * the sea itself. Cells are integers and so is every derived rectangle, so the same carves give the
 * same stage everywhere.
 *
 * Rows grow downward. Row 0 is the first row of the sea (the sea surface is the top edge of row 0)
 * and the sea fills `SEA_ROWS` rows down to the world bottom.
 */

export const OPEN = 0
export const SOLID = 1
export const PAD = 2

/** A half-open rectangle of cells: columns [c0, c1), rows [r0, r1). */
export interface CellRect {
  c0: number
  r0: number
  c1: number
  r1: number
}

export interface CellGrid {
  col0: number
  row0: number
  cols: number
  rows: number
  cells: Uint8Array
}

export interface GridSpec {
  col0: number
  /** Exclusive. */
  col1: number
  /** Top row (negative, above the sea). The bottom is always the sea floor. */
  row0: number
  seaRows: number
  carves: ReadonlyArray<CellRect>
  /** Columns whose floor is open below: the air under them stays open down to the sea. */
  pitCols: ReadonlyArray<number>
  /** Columns that get a solid pillar from the tunnel shell down to the sea surface. */
  curtainCols: ReadonlyArray<number>
  /** Bounce pad cells (they replace rock). */
  pads: ReadonlyArray<CellRect>
}

export const cellIndex = (g: CellGrid, col: number, row: number) => (row - g.row0) * g.cols + (col - g.col0)

export const cellAt = (g: CellGrid, col: number, row: number): number => {
  if (col < g.col0 || col >= g.col0 + g.cols || row < g.row0 || row >= g.row0 + g.rows) return SOLID
  return g.cells[cellIndex(g, col, row)]
}

/**
 * Builds the grid. Per column: carved cells are open; rock fills everything above the lowest
 * carved cell and one shell row below it (unless the column is a pit); below that is open air
 * down to the sea, except in curtain columns, which stay rock down to the sea surface. A column
 * with no carves is rock down to the sea surface. The sea rows are always open.
 */
export const buildGrid = (spec: GridSpec): CellGrid => {
  const cols = spec.col1 - spec.col0
  const rows = spec.seaRows - spec.row0
  const g: CellGrid = { col0: spec.col0, row0: spec.row0, cols, rows, cells: new Uint8Array(cols * rows) }
  const carved = new Uint8Array(cols * rows)
  for (const r of spec.carves) {
    for (let row = Math.max(r.r0, spec.row0); row < Math.min(r.r1, 0); row++) {
      for (let col = Math.max(r.c0, spec.col0); col < Math.min(r.c1, spec.col1); col++) {
        carved[(row - spec.row0) * cols + (col - spec.col0)] = 1
      }
    }
  }
  const isPit = new Uint8Array(cols)
  for (const c of spec.pitCols) if (c >= spec.col0 && c < spec.col1) isPit[c - spec.col0] = 1
  const isCurtain = new Uint8Array(cols)
  for (const c of spec.curtainCols) if (c >= spec.col0 && c < spec.col1) isCurtain[c - spec.col0] = 1

  for (let ci = 0; ci < cols; ci++) {
    let lowest = -1
    for (let ri = 0; ri < -spec.row0; ri++) if (carved[ri * cols + ci]) lowest = ri
    for (let ri = 0; ri < rows; ri++) {
      const row = ri + spec.row0
      let state = SOLID
      if (row >= 0) state = OPEN
      else if (carved[ri * cols + ci]) state = OPEN
      else if (lowest < 0 || ri < lowest) state = SOLID
      else if (ri === lowest + 1 && !isPit[ci]) state = SOLID
      else state = isCurtain[ci] ? SOLID : OPEN
      g.cells[ri * cols + ci] = state
    }
  }
  for (const r of spec.pads) {
    for (let row = r.r0; row < r.r1; row++) {
      for (let col = r.c0; col < r.c1; col++) {
        if (cellAt(g, col, row) !== SOLID || row >= 0) continue
        g.cells[cellIndex(g, col, row)] = PAD
      }
    }
  }
  return g
}

/**
 * Merges cells of one state into few rectangles: maximal runs along each row, then identical runs
 * on consecutive rows are joined. A flat floor or ceiling is always a single rectangle edge.
 */
export const mergeCells = (g: CellGrid, state: number): Array<CellRect> => {
  const done: Array<CellRect> = []
  let open = new Map<string, CellRect>()
  for (let ri = 0; ri < g.rows; ri++) {
    const row = ri + g.row0
    const next = new Map<string, CellRect>()
    let ci = 0
    while (ci < g.cols) {
      if (g.cells[ri * g.cols + ci] !== state) {
        ci++
        continue
      }
      const start = ci
      while (ci < g.cols && g.cells[ri * g.cols + ci] === state) ci++
      const c0 = start + g.col0
      const c1 = ci + g.col0
      const key = `${c0}:${c1}`
      const prev = open.get(key)
      if (prev) {
        prev.r1 = row + 1
        next.set(key, prev)
        open.delete(key)
      } else {
        next.set(key, { c0, r0: row, c1, r1: row + 1 })
      }
    }
    open.forEach((r) => done.push(r))
    open = next
  }
  open.forEach((r) => done.push(r))
  // Stable, position-based order so the output never depends on Map iteration details
  done.sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0)
  return done
}

/** A boundary line between rock (or a pad) and open space, in cells. */
export interface CellEdge {
  c0: number
  r0: number
  c1: number
  r1: number
  pad: boolean
}

const blocks = (s: number) => s !== OPEN

/** Every rock/open boundary as merged straight lines, flagged when a pad is on one side. */
export const boundaryEdges = (g: CellGrid): Array<CellEdge> => {
  const edges: Array<CellEdge> = []
  // Horizontal lines on the top edge of each row
  for (let ri = 1; ri < g.rows; ri++) {
    const row = ri + g.row0
    let run: CellEdge | undefined
    for (let ci = 0; ci <= g.cols; ci++) {
      let edge = false
      let pad = false
      if (ci < g.cols) {
        const a = g.cells[(ri - 1) * g.cols + ci]
        const b = g.cells[ri * g.cols + ci]
        edge = blocks(a) !== blocks(b)
        pad = a === PAD || b === PAD
      }
      const col = ci + g.col0
      if (run && (!edge || run.pad !== pad)) {
        edges.push(run)
        run = undefined
      }
      if (edge) {
        if (run) run.c1 = col + 1
        else run = { c0: col, r0: row, c1: col + 1, r1: row, pad }
      }
    }
  }
  // Vertical lines on the left edge of each column
  for (let ci = 1; ci < g.cols; ci++) {
    const col = ci + g.col0
    let run: CellEdge | undefined
    for (let ri = 0; ri <= g.rows; ri++) {
      let edge = false
      let pad = false
      if (ri < g.rows) {
        const a = g.cells[ri * g.cols + ci - 1]
        const b = g.cells[ri * g.cols + ci]
        edge = blocks(a) !== blocks(b)
        pad = a === PAD || b === PAD
      }
      const row = ri + g.row0
      if (run && (!edge || run.pad !== pad)) {
        edges.push(run)
        run = undefined
      }
      if (edge) {
        if (run) run.r1 = row + 1
        else run = { c0: col, r0: row, c1: col, r1: row + 1, pad }
      }
    }
  }
  return edges
}
