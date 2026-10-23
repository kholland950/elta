export interface SquashStretch {
  scaleX: number
  scaleY: number
  /** Direction of travel in radians; scaleX is applied along it. */
  angle: number
}

/** Largest stretch along the direction of travel, reached at `maxSpeed`. */
export const MAX_STRETCH = 1.35
/** Below this speed the orb is drawn round. */
const REST_SPEED = 10

/**
 * Volume-preserving squash/stretch for an orb moving at (vx, vy):
 * stretched along travel, squashed across it, scaleX * scaleY === 1.
 */
export const squashStretch = (vx: number, vy: number, maxSpeed: number): SquashStretch => {
  const speed = Math.hypot(vx, vy)
  if (!Number.isFinite(speed) || speed < REST_SPEED || maxSpeed <= 0) {
    return { scaleX: 1, scaleY: 1, angle: 0 }
  }
  const t = Math.min(speed / maxSpeed, 1)
  const stretch = 1 + (MAX_STRETCH - 1) * t
  return { scaleX: stretch, scaleY: 1 / stretch, angle: Math.atan2(vy, vx) }
}
