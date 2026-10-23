import type { Mover } from './stage'

export interface MoverState {
  x: number
  y: number
  /** Velocity in px/s. */
  vx: number
  vy: number
}

/**
 * Position and velocity of a moving platform at race time `tMs`: a triangle wave from its rest
 * position out to rest + (dx, dy) and back over `periodMs`. Uses no trig, so it is identical on
 * every client. (No slice 1 segment places movers yet.)
 */
export const platformAt = (def: Mover, tMs: number): MoverState => {
  const period = def.periodMs
  const t = (((tMs + def.phaseMs) % period) + period) % period
  const halfPeriod = period / 2
  const outbound = t < halfPeriod
  const u = outbound ? t / halfPeriod : 2 - t / halfPeriod
  const sign = outbound ? 1 : -1
  return {
    x: def.x + def.dx * u,
    y: def.y + def.dy * u,
    vx: (sign * def.dx * 1000) / halfPeriod,
    vy: (sign * def.dy * 1000) / halfPeriod,
  }
}
