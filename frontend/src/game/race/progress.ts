import type { Point } from './stage'

/** Cumulative arc length at each spine point; the last entry is the total length. */
export const spineLengths = (spine: ReadonlyArray<Point>): Array<number> => {
  const lengths = [0]
  for (let i = 1; i < spine.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y))
  }
  return lengths
}

export interface SpineProgress {
  /** Distance along the spine of the closest point to the orb. */
  distance: number
  /** distance / total, in [0, 1]. */
  fraction: number
  /** Spine leg the orb was matched to; pass it back as the hint next time. */
  leg: number
}

/** How many legs either side of the hint are searched. */
const SEARCH_LEGS = 4

/**
 * Progress of `pos` along the spine. Only legs near the previous match are searched, so a route
 * that doubles back (a switchback) is not confused with the parallel leg above or below it.
 */
export const progressAlong = (
  spine: ReadonlyArray<Point>,
  lengths: ReadonlyArray<number>,
  pos: Point,
  hintLeg = 0,
): SpineProgress => {
  const total = lengths[lengths.length - 1] || 1
  const first = Math.max(0, hintLeg - SEARCH_LEGS)
  const last = Math.min(spine.length - 2, hintLeg + SEARCH_LEGS)
  let best = { d2: Infinity, distance: 0, leg: hintLeg }
  for (let i = first; i <= last; i++) {
    const a = spine[i]
    const b = spine[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.y - a.y) * aby) / len2))
    const cx = a.x + abx * t
    const cy = a.y + aby * t
    const d2 = (pos.x - cx) * (pos.x - cx) + (pos.y - cy) * (pos.y - cy)
    if (d2 < best.d2) best = { d2, distance: lengths[i] + (lengths[i + 1] - lengths[i]) * t, leg: i }
  }
  return { distance: best.distance, fraction: Math.max(0, Math.min(1, best.distance / total)), leg: best.leg }
}
