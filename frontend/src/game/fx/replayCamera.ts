// Relative imports: vitest has no path aliases
import type { Beat } from '../race/replayTimeline'
import type { Rect } from '../race/stage'

/** Where the camera looks (world centre) and how far it is zoomed. */
export interface Pose {
  cx: number
  cy: number
  zoom: number
}

/**
 * The replay never zooms out further than this, even if a straggler drops off screen: further out
 * the orbs and lines are too small to follow.
 */
export const REPLAY_MIN_ZOOM = 0.5
/** Screen px kept clear around the group, so heads and their labels stay off the very edge. */
export const GROUP_PAD_PX = 140

/**
 * The pose that frames a box (the trail heads' extent) in a `vw`×`vh` view with `pad` screen px
 * clear around it: centred on the box, zoomed to fit within [`minZoom`, 1].
 */
export const fitBox = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  vw: number,
  vh: number,
  out: Pose,
  pad = GROUP_PAD_PX,
  minZoom = REPLAY_MIN_ZOOM,
): Pose => {
  const fx = (vw - 2 * pad) / Math.max(1, maxX - minX)
  const fy = (vh - 2 * pad) / Math.max(1, maxY - minY)
  out.cx = (minX + maxX) / 2
  out.cy = (minY + maxY) / 2
  out.zoom = Math.min(1, Math.max(minZoom, Math.min(fx, fy)))
  return out
}

/**
 * Slides `pose` the least distance that brings (`x`, `y`) inside its view, `pad` screen px clear of
 * the edge. The replay's leader stays in frame even when the field is too spread to fit at the
 * zoom floor: the stragglers drop off instead.
 */
export const keepInView = (pose: Pose, x: number, y: number, vw: number, vh: number, pad = GROUP_PAD_PX): Pose => {
  const hw = Math.max(0, vw / 2 - pad) / pose.zoom
  const hh = Math.max(0, vh / 2 - pad) / pose.zoom
  pose.cx = Math.min(x + hw, Math.max(x - hw, pose.cx))
  pose.cy = Math.min(y + hh, Math.max(y - hh, pose.cy))
  return pose
}

/**
 * Eases `state` toward `goal` over `dtMs`, frame-rate independent: each halflife closes half the
 * gap. The zoom is damped in log space, so zooming out and back in feel the same, and it is given
 * the longer halflife: zoom changes are the most disorienting camera motion.
 */
export const dampPose = (state: Pose, goal: Pose, dtMs: number, posHalflifeMs: number, zoomHalflifeMs: number): Pose => {
  const dt = Math.max(0, dtMs)
  const kp = 1 - 0.5 ** (dt / posHalflifeMs)
  const kz = 1 - 0.5 ** (dt / zoomHalflifeMs)
  state.cx += (goal.cx - state.cx) * kp
  state.cy += (goal.cy - state.cy) * kp
  state.zoom = Math.exp(Math.log(state.zoom) + (Math.log(goal.zoom) - Math.log(state.zoom)) * kz)
  return state
}

/**
 * The centre Phaser's camera bounds would allow at this zoom (Camera.clampX/Y): a view wider than
 * the bounds is pinned to their left (or top) edge. Aiming the zoom-in here means restoring the
 * bounds when the follow takes over moves nothing.
 */
export const clampCenter = (bounds: Rect, vw: number, vh: number, zoom: number, x: number, y: number, out: Pose): Pose => {
  const clamp = (v: number, start: number, size: number, view: number) => {
    const half = view / zoom / 2
    const lo = start + half
    const hi = Math.max(lo, start + size - half)
    return Math.min(hi, Math.max(lo, v))
  }
  out.cx = clamp(x, bounds.x, bounds.w, vw)
  out.cy = clamp(y, bounds.y, bounds.h, vh)
  out.zoom = zoom
  return out
}

/** Slow out of the start, slow into the end: a camera move that neither yanks nor stops dead. */
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

/**
 * Between two poses at `t`. The centre moves linearly and the zoom geometrically, so each frame
 * scales the view by the same factor and a 14× zoom-out doesn't rush its last half.
 */
export const lerpPose = (a: Pose, b: Pose, t: number, out: Pose): Pose => {
  out.cx = a.cx + (b.cx - a.cx) * t
  out.cy = a.cy + (b.cy - a.cy) * t
  out.zoom = a.zoom * (b.zoom / a.zoom) ** t
  return out
}

const copy = (p: Pose, out: Pose): Pose => {
  out.cx = p.cx
  out.cy = p.cy
  out.zoom = p.zoom
  return out
}

/**
 * The camera at a beat of the round-end sequence: where it was (`from`) until the zoom-out, then
 * out to `group` (the pose framing every trail head), on it through the replay, then in to
 * `target` (the winner). The caller supplies the group pose for the beat: where the heads start
 * for the zoom-out, the follow cam's pose through the replay, and where it ended for the zoom-in.
 * With no target (a timeout, or the winner left) it stays on the group to the end.
 */
export const posePlan = (beat: Beat, from: Pose, group: Pose, target: Pose | undefined, out: Pose): Pose => {
  switch (beat.kind) {
    case 'disintegrate':
    case 'pause':
      return copy(from, out)
    case 'zoomOut':
      return lerpPose(from, group, easeInOutCubic(beat.p), out)
    case 'replay':
      return copy(group, out)
    case 'zoomIn':
      return target ? lerpPose(group, target, easeInOutCubic(beat.p), out) : copy(group, out)
    case 'victoryLap':
    case 'results':
      return copy(target ?? group, out)
  }
}

/**
 * The area a tiling parallax layer (scroll factor `s`) must cover so no edge shows, for any
 * camera centred inside `bounds` with a view up to `maxView` px and a zoom down to `minZoom` (the
 * replay's REPLAY_MIN_ZOOM, while the camera bounds are lifted and the view can reach past them).
 *
 * Phaser draws the layer at `x - scrollX * s` and zooms about the view centre, so the layer-space
 * span on screen is `cx * s + (vw / 2)(1 - s) ± vw / (2 zoom)`.
 */
export const parallaxCover = (bounds: Rect, s: number, maxView: number, minZoom: number): Rect => {
  const z = Math.min(1, minZoom)
  const below = (maxView / 2) * (1 - s - 1 / z)
  return {
    x: Math.floor(bounds.x * s + below),
    y: Math.floor(bounds.y * s + below),
    w: Math.ceil(bounds.w * s + maxView / z) + 1,
    h: Math.ceil(bounds.h * s + maxView / z) + 1,
  }
}
