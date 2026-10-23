// Dash camera kick: a few-pixel jolt along the dash, applied at render time (see render/CameraFX.ts).
// One quick snap out, then a decelerating settle back to rest: no overshoot, no oscillation.
// The view recoils AGAINST the dash: the 0.2 follow lerp already pans the view along the dash at
// 8-24px/frame in the same 100ms, so an offset along the dash is swallowed by that pan. Against it,
// the first frames reverse the pan (the world jolts with the orb), which is what reads as a kick.
export const KICK_PX = 8
export const KICK_OUT_MS = 28
export const KICK_BACK_MS = 140
export const KICK_MS = KICK_OUT_MS + KICK_BACK_MS

/** Kick envelope in 0..1 at `t` ms after the dash; 0 before it starts and once it has settled. */
export function kickEnvelope(t: number): number {
  if (!(t > 0) || t >= KICK_MS) return 0
  if (t < KICK_OUT_MS) {
    const u = t / KICK_OUT_MS
    return 1 - (1 - u) * (1 - u)
  }
  const v = 1 - (t - KICK_OUT_MS) / KICK_BACK_MS
  return v * v * v
}

/** Horizontal scroll offset in px at `t` ms for a dash in direction `dir` (the view recoils against the dash). */
export function kickOffset(t: number, dir: 1 | -1): number {
  return -dir * KICK_PX * kickEnvelope(t)
}
