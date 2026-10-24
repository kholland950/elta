import { boundaryEdges, CellGrid, mergeCells, OPEN, PAD, SOLID } from './grid'
import { CELL, SEA_ROWS } from './segments'
import type { Bounce, Point, Rect, Solid, Stage } from './stage'
import { ORB_RADIUS } from './tuning'

/**
 * The lobby: a fixed, hand-built room about two screens wide, for warming up and bumping friends
 * while the room fills. One character per 50 px cell, top row first; the bottom row sits on the
 * energy sea's surface (y = 0).
 *
 *   #  rock        .  open        ^  bounce pad (replaces floor rock)
 *   1–8  open, and the spawn for that join position (resting on the floor below it)
 *
 * Left: a 150 px chimney between the wall and a pillar, for wall bouncing. Middle: floating
 * platforms and a pillar hanging from the ceiling. Right of centre: a bounce pad beside a high
 * ledge. Far right: a 100 px chimney. The room is 3600 x 1000 px with a 3500 x 850 px interior. Spawns are spread along the floor, alternating out from the middle by join order.
 */
export const LOBBY_MAP: ReadonlyArray<string> = [
  '########################################################################',
  '#......................................................................#',
  '#............................##........................................#',
  '#............................##........................................#',
  '#............................##........................................#',
  '#............................##........................................#',
  '#...##.......................##...............#############........##..#',
  '#...##.......................##...........................#........##..#',
  '#...##.......................##...........................#........##..#',
  '#...##....................................................#........##..#',
  '#...##.................######......................................##..#',
  '#...##.............................................................##..#',
  '#...##............................................######...........##..#',
  '#...##.....######..................................................##..#',
  '#...##.............................................................##..#',
  '#...##............................######...........................##..#',
  '#...##.............................................................##..#',
  '#...##.........7.....5.....3.....1....2.........4....6.......8.....##..#',
  '##^^#######################################^^########################^^#',
  '########################################################################',
]

/** Lobby spawns, one per join position. */
export const LOBBY_SPAWNS = 8

const px = (c0: number, r0: number, c1: number, r1: number): Rect => ({
  x: c0 * CELL,
  y: r0 * CELL,
  w: (c1 - c0) * CELL,
  h: (r1 - r0) * CELL,
})

/** The lobby map as a cell grid (row 0 of the grid is the sea's first row, as on race stages). */
export const lobbyGrid = (
  map: ReadonlyArray<string> = LOBBY_MAP,
): { grid: CellGrid; spawns: Array<Point> } => {
  const rowsAbove = map.length
  const cols = map[0].length
  const rows = rowsAbove + SEA_ROWS
  const grid: CellGrid = {
    col0: 0,
    row0: -rowsAbove,
    cols,
    rows,
    cells: new Uint8Array(cols * rows),
  }
  const spawns: Array<{ index: number; at: Point }> = []
  map.forEach((line, ri) => {
    if (line.length !== cols)
      throw new Error(`lobby map row ${ri} is ${line.length} wide, not ${cols}`)
    for (let ci = 0; ci < cols; ci++) {
      const ch = line[ci]
      grid.cells[ri * cols + ci] = ch === '#' ? SOLID : ch === '^' ? PAD : OPEN
      if (ch >= '1' && ch <= '9') {
        const row = ri - rowsAbove
        spawns.push({
          index: Number(ch) - 1,
          at: { x: ci * CELL + CELL / 2, y: (row + 1) * CELL - ORB_RADIUS - 1 },
        })
      }
    }
  })
  // The sea rows stay open, as on every stage
  spawns.sort((a, b) => a.index - b.index)
  return { grid, spawns: spawns.map((s) => s.at) }
}

/**
 * The lobby as a Stage, so the same StageWorld and StageRenderer build it. It has no finish, no
 * bays and no par; `startSlots` are its spawns in join order.
 */
export const lobbyRoom = (): Stage => {
  const { grid, spawns } = lobbyGrid()
  const solids: Array<Solid> = mergeCells(grid, SOLID).map((r) => ({
    kind: 'solid',
    ...px(r.c0, r.r0, r.c1, r.r1),
  }))
  const pads: Array<Bounce> = mergeCells(grid, PAD).map((r) => ({
    kind: 'bounce',
    ...px(r.c0, r.r0, r.c1, r.r1),
  }))
  const edges = boundaryEdges(grid).map((e) => ({
    x0: e.c0 * CELL,
    y0: e.r0 * CELL,
    x1: e.c1 * CELL,
    y1: e.r1 * CELL,
    pad: e.pad,
  }))
  // The open room (above the sea), for the interior tint
  const interiors = mergeCells(grid, OPEN)
    .filter((r) => r.r1 <= 0)
    .map((r) => px(r.c0, r.r0, r.c1, r.r1))
  const bounds = {
    x: 0,
    y: grid.row0 * CELL,
    w: grid.cols * CELL,
    h: grid.rows * CELL,
  }
  const room = {
    x: CELL,
    y: (grid.row0 + 1) * CELL,
    w: (grid.cols - 2) * CELL,
    h: (-grid.row0 - 3) * CELL,
  }
  const port = {
    dir: 'E' as const,
    x: room.x,
    top: room.y,
    bottom: room.y + room.h,
  }
  return {
    kind: 'lobby',
    seed: 0,
    difficulty: 1,
    cell: CELL,
    bounds,
    seaY: 0,
    segments: [
      {
        type: 'lobby',
        bounds: room,
        entry: port,
        exit: { ...port, x: room.x + room.w },
        tunnels: [],
        chambers: interiors,
        pads,
        spine: [],
        parMs: 0,
        pits: [],
      },
    ],
    solids,
    pads,
    edges,
    grid,
    spine: [],
    startSlots: spawns,
    bays: [],
    parMs: 0,
  }
}
