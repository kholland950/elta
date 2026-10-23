import { difficultyKnobs, Knobs } from './difficulty'
import { boundaryEdges, buildGrid, CellGrid, CellRect, cellIndex, mergeCells, OPEN, PAD, SOLID } from './grid'
import { checkGrid, reachFrom, ReachOptions, ReachTargets, StageReach } from './reach'
import { createRng, Rng } from './rng'
import {
  BUILDABLE_TYPES,
  BuildableType,
  CELL,
  CellPort,
  HIGHEST_ROW,
  LOWEST_FLOOR,
  planFinish,
  planRun,
  planSegment,
  planStart,
  SEA_ROWS,
  SegmentPlan,
  START_FLOOR,
  startSlotsAbove,
} from './segments'
import type { Bounce, Point, Rect, Segment, Solid, Stage } from './stage'
import { padApex } from './tuning'

/** Stop adding segments once the summed par reaches this. */
export const TARGET_PAR_MS = 55000
export const MAX_REROLLS = 8

export const reachOptions: ReachOptions = { cellSize: CELL, padApexCells: Math.floor(padApex() / CELL) }

const px = (r: CellRect): Rect => ({ x: r.c0 * CELL, y: r.r0 * CELL, w: (r.c1 - r.c0) * CELL, h: (r.r1 - r.r0) * CELL })

/**
 * Segment weights for the current tunnel: shafts up are favoured low down and offered only with
 * room above; shafts down only with room below; the stall chamber needs room for its tall room.
 */
const weightsAt = (knobs: Knobs, port: CellPort): Array<number> => {
  const w = knobs.weights
  const roomAbove = port.top - HIGHEST_ROW
  const roomBelow = LOWEST_FLOOR - port.bottom
  const byType: Record<BuildableType, number> = {
    run: w.run,
    shaftUp: roomAbove < 14 ? 0 : port.bottom > -12 ? w.shaftUp * 2 : w.shaftUp,
    shaftDown: roomBelow < knobs.tunnelMin + 3 ? 0 : port.bottom < -30 ? w.shaftDown * 2 : w.shaftDown,
    stallChamber: roomAbove < 22 ? 0 : w.stallChamber,
  }
  return BUILDABLE_TYPES.map((t) => byType[t])
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

/** Whether the orb can get from a segment's entry mouth to its exit mouth on its own geometry. */
export const planPassable = (plan: SegmentPlan): boolean => {
  const span = spanOf(plan)
  // The previous segment's last column, open at the entry mouth, is where the orb comes from
  const mouth = { c0: plan.entry.x - 1, r0: plan.entry.top, c1: plan.entry.x, r1: plan.entry.bottom }
  const grid = buildGrid({
    col0: span.c0 - 2,
    col1: span.c1 + 1,
    row0: Math.min(span.r0, plan.entry.top) - 2,
    seaRows: SEA_ROWS,
    carves: [mouth, ...plan.carves],
    pitCols: plan.pitCols,
    curtainCols: [],
    pads: plan.pads,
  })
  const start = cellIndex(grid, plan.entry.x - 1, plan.entry.bottom - 1)
  const target = cellIndex(grid, plan.exit.x - 1, plan.exit.bottom - 1)
  return reachFrom(grid, [start], reachOptions)[target] >= 0
}

/**
 * Plans one segment of the picked type, re-rolling on the same stream when the result does not
 * fit here or is not passable, and falling back to a tunnel run.
 */
const nextPlan = (rng: Rng, knobs: Knobs, entry: CellPort): SegmentPlan => {
  const type = BUILDABLE_TYPES[rng.weighted(weightsAt(knobs, entry))]
  for (let attempt = 0; attempt < MAX_REROLLS; attempt++) {
    const plan = planSegment(type, { rng, entry, knobs })
    if (plan && planPassable(plan)) return plan
  }
  return planRun({ rng, entry, knobs })
}

const toSegment = (plan: SegmentPlan): Segment => {
  const span = spanOf(plan)
  let r1 = -Infinity
  for (const r of plan.carves) r1 = Math.max(r1, r.r1)
  const port = (p: CellPort) => ({ x: p.x * CELL, top: p.top * CELL, bottom: p.bottom * CELL })
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
    pits: plan.pitCols.length > 0
      ? [{ x0: Math.min(...plan.pitCols) * CELL, x1: (Math.max(...plan.pitCols) + 1) * CELL }]
      : [],
    ...(plan.slot ? { slot: plan.slot } : {}),
  }
}

/**
 * Generates the stage for a seed and difficulty: the start chamber, weighted tunnel segments
 * joined mouth to mouth until the summed par reaches TARGET_PAR_MS, then the finish chamber. Rock
 * fills everything else; the air under the tunnels is split by curtains (pillars down to the sea
 * surface) at every segment start. One PRNG stream and integer arithmetic only, so every client
 * builds the identical stage.
 */
export const generateStage = (rawSeed: number, difficulty: number): Stage => {
  const seed = rawSeed >>> 0
  const knobs = difficultyKnobs(difficulty)
  const rng = createRng(seed)
  const plans: Array<SegmentPlan> = [planStart()]
  let parMs = plans[0].parMs
  while (parMs < TARGET_PAR_MS) {
    const plan = nextPlan(rng, knobs, plans[plans.length - 1].exit)
    plans.push(plan)
    parMs += plan.parMs
  }
  const { plan: finish, finishCol } = planFinish({ entry: plans[plans.length - 1].exit })
  plans.push(finish)
  parMs += finish.parMs

  let topRow = 0
  for (const p of plans) topRow = Math.min(topRow, spanOf(p).r0)
  const col0 = -1
  const col1 = finish.exit.x + 1
  const grid = buildGrid({
    col0,
    col1,
    row0: topRow - 2,
    seaRows: SEA_ROWS,
    carves: plans.flatMap((p) => p.carves),
    pitCols: plans.flatMap((p) => p.pitCols),
    curtainCols: plans.slice(1).map((p) => p.entry.x),
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
    seed,
    difficulty: knobs.difficulty,
    cell: CELL,
    bounds: { x: col0 * CELL, y: grid.row0 * CELL, w: grid.cols * CELL, h: grid.rows * CELL },
    seaY: 0,
    segments,
    solids,
    pads,
    edges,
    grid,
    spine,
    startSlots: startSlotsAbove(START_FLOOR),
    finish: { x: finishCol * CELL, top: finishPlan.r0 * CELL, bottom: finishPlan.r1 * CELL },
    parMs,
  }
}

/** Start cell and finish cells of a stage's grid, for the reach check. */
export const reachTargets = (stage: Stage): ReachTargets => {
  const g: CellGrid = stage.grid
  const slot = stage.startSlots[0]
  const start = cellIndex(g, Math.floor(slot.x / CELL), Math.floor(slot.y / CELL))
  const finish: Array<number> = []
  const c0 = stage.finish.x / CELL
  for (let row = stage.finish.top / CELL; row < stage.finish.bottom / CELL; row++) {
    for (let col = c0; col < g.col0 + g.cols; col++) {
      if (g.cells[cellIndex(g, col, row)] === OPEN) finish.push(cellIndex(g, col, row))
    }
  }
  return { start, finish }
}

export const checkStage = (stage: Stage): StageReach => checkGrid(stage.grid, reachTargets(stage), reachOptions)
