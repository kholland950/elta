import {
  ACCELERATION,
  BUMP,
  BUMP_COOLDOWN_MS,
  DASH_SPEED,
  DASHES_ALLOWED,
  FLAP_SEQUENCE,
  JUMP_VELOCITY,
  SEA_DAMP_Y,
  SEA_MAX_VX,
} from './tuning'

/** One physics step's worth of input. Presses are latched between steps so none are lost. */
export interface InputFrame {
  left: boolean
  right: boolean
  flapPressed: boolean
  dashPressed: boolean
  stallPressed: boolean
}

export const NO_INPUT: InputFrame = {
  left: false,
  right: false,
  flapPressed: false,
  dashPressed: false,
  stallPressed: false,
}

export interface PilotState {
  /** Index into FLAP_SEQUENCE of the next flap. */
  flapIndex: number
  dashes: number
  canStall: boolean
  /** Last held direction; a dash with no direction held goes this way. */
  facing: 1 | -1
}

export const freshPilot = (): PilotState => ({
  flapIndex: 0,
  dashes: DASHES_ALLOWED,
  canStall: true,
  facing: 1,
})

export interface Velocity {
  x: number
  y: number
}

export type PilotEvent = { kind: 'flap' } | { kind: 'stall' } | { kind: 'dash'; dir: 1 | -1 }

export interface PilotStep {
  state: PilotState
  /** Velocity to set on the body (unchanged when no action fired). */
  velocity: Velocity
  /** Horizontal acceleration to apply until the next step. */
  accelX: number
  events: Array<PilotEvent>
}

/**
 * Applies one step of input. Order within a step: stall (instant stop), then flap, then dash, so a
 * stall and a dash pressed together leave a pure horizontal dash.
 */
export const stepPilot = (state: PilotState, input: InputFrame, vel: Velocity): PilotStep => {
  const next = { ...state }
  const velocity = { x: vel.x, y: vel.y }
  const events: Array<PilotEvent> = []

  const dir = input.right === input.left ? 0 : input.right ? 1 : -1
  if (dir !== 0) next.facing = dir

  if (input.stallPressed && next.canStall) {
    velocity.x = 0
    velocity.y = 0
    next.canStall = false
    events.push({ kind: 'stall' })
  }

  if (input.flapPressed && next.flapIndex < FLAP_SEQUENCE.length) {
    velocity.y = -JUMP_VELOCITY * FLAP_SEQUENCE[next.flapIndex]
    next.flapIndex += 1
    events.push({ kind: 'flap' })
  }

  if (input.dashPressed && next.dashes > 0) {
    velocity.x = DASH_SPEED * next.facing
    next.dashes -= 1
    events.push({ kind: 'dash', dir: next.facing })
  }

  return { state: next, velocity, accelX: dir * ACCELERATION, events }
}

/** Refills flaps, dashes and stall. `restored` is false when nothing had been used. */
export const recharge = (state: PilotState): { state: PilotState; restored: boolean } => {
  const restored = state.flapIndex > 0 || state.dashes < DASHES_ALLOWED || !state.canStall
  return {
    state: { ...state, flapIndex: 0, dashes: DASHES_ALLOWED, canStall: true },
    restored,
  }
}

export interface OrbRef {
  id: string
  x: number
  y: number
}

/**
 * The velocity an orb's own velocity is set to when it bumps another: a constant push away on
 * both axes. Exact ties fall back to comparing ids, so the two clients always pick opposite signs.
 */
export const bumpVelocity = (self: OrbRef, other: OrbRef): Velocity => {
  const idSign = self.id < other.id ? -1 : 1
  const sx = self.x === other.x ? idSign : self.x > other.x ? 1 : -1
  // Screen y grows downward: the upper orb is pushed up (negative), the lower one down
  const sy = self.y === other.y ? -idSign : self.y < other.y ? -1 : 1
  return { x: sx * BUMP.x, y: sy * BUMP.y }
}

/** Per-pair bump cooldown, keyed by the other orb's id, timed in ms of the caller's clock. */
export class BumpCooldowns {
  private lastBump = new Map<string, number>()

  /** True (and starts the cooldown) when this pair may bump at `nowMs`. */
  public tryBump(otherId: string, nowMs: number): boolean {
    const last = this.lastBump.get(otherId)
    if (last !== undefined && nowMs - last < BUMP_COOLDOWN_MS) return false
    this.lastBump.set(otherId, nowMs)
    return true
  }

  public forget(otherId: string) {
    this.lastBump.delete(otherId)
  }
}

/** Sea drag for one step: horizontal speed is capped and vertical speed damped. */
export const seaDrag = (vel: Velocity): Velocity => ({
  x: Math.max(-SEA_MAX_VX, Math.min(SEA_MAX_VX, vel.x)),
  y: vel.y * SEA_DAMP_Y,
})
