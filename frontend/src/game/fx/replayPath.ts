// Relative imports: vitest has no path aliases
import type { PathSample } from '../race/pathRecorder'

/** Race time the replay covers: until the last path ends. */
export const replaySpanMs = (paths: Iterable<ReadonlyArray<PathSample>>): number => {
  let span = 0
  for (const path of paths) if (path.length > 0) span = Math.max(span, path[path.length - 1].t)
  return span
}

/** Where a path's line has reached: `index` is the last sample at or before that time (-1: none). */
export interface PathHead {
  x: number
  y: number
  index: number
}

/**
 * The head of `path` at `raceMs`, between the samples either side of it. Before the first sample
 * it sits on the first; past the last it stays on the last. Writes into `out` (reused per frame).
 */
export const headAt = (path: ReadonlyArray<PathSample>, raceMs: number, out: PathHead): PathHead => {
  const n = path.length
  if (n === 0 || raceMs < path[0].t) {
    out.index = -1
    out.x = n > 0 ? path[0].x : 0
    out.y = n > 0 ? path[0].y : 0
    return out
  }
  // Last sample with t <= raceMs
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (path[mid].t <= raceMs) lo = mid
    else hi = mid - 1
  }
  out.index = lo
  const a = path[lo]
  const b = path[lo + 1]
  if (!b || b.t <= a.t) {
    out.x = a.x
    out.y = a.y
  } else {
    const k = (raceMs - a.t) / (b.t - a.t)
    out.x = a.x + (b.x - a.x) * k
    out.y = a.y + (b.y - a.y) * k
  }
  return out
}

/** Line width in screen px: thin, so the camera bloom makes the glow; the winner's a little bolder. */
const LINE_PX = { winner: 3, other: 2.25 }

/** World width of a line drawn at `zoom`, so it keeps its screen width whatever the zoom. */
export const lineWidth = (isWinner: boolean, zoom: number): number =>
  LINE_PX[isWinner ? 'winner' : 'other'] / zoom
