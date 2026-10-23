/** Moments of player feedback, in world coordinates. `dir` is the dash direction (+1 right, -1 left). */
export type FeelEvent =
  | { kind: 'dash'; x: number; y: number; dir: 1 | -1 }
  | { kind: 'stall' | 'flap' | 'recharge' | 'collision'; x: number; y: number }

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
