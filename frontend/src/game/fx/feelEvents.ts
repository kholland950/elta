/** Fields every feel event carries: who it happened to, and where in world coordinates. */
interface FeelEventBase {
  playerId: string
  x: number
  y: number
}

/**
 * Moments of player feedback. `dir` is the dash direction (+1 right, -1 left); a collision is
 * reported by `playerId` and names the player it hit as `otherId`. A bounce is a launch off a pad,
 * at the orb's x on the pad's top.
 */
export type FeelEvent =
  | (FeelEventBase & { kind: 'dash'; dir: 1 | -1 })
  | (FeelEventBase & { kind: 'stall' | 'flap' | 'recharge' | 'bounce' })
  | (FeelEventBase & { kind: 'collision'; otherId: string })

export type FeelEventKind = FeelEvent['kind']

/** Port the game logic reports feel events to; the renderer decides what they look like. */
export interface FeelSink {
  emit(e: FeelEvent): void
}

export interface MoveCharge {
  canStall: boolean
  dashes: number
}

/**
 * True when topping the charge back up would restore something. World-bounds contact is reported
 * every frame while resting on the floor, so recharge feedback must only fire on a real refill.
 */
export const restoresCharge = (charge: MoveCharge, dashesAllowed: number): boolean =>
  !charge.canStall || charge.dashes < dashesAllowed
