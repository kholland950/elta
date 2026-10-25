/**
 * Movement and stage constants shared by the pilot logic, the Phaser adapters and the stage
 * generator. All are starting values to tune in playtest.
 */

/** Fixed physics rate; every per-tick rule runs once per step at this rate. */
export const STEP_HZ = 120
export const STEP_MS = 1000 / STEP_HZ

export const GRAVITY = 2000

/** Arcade body settings for every orb. */
export const BODY = {
  friction: 800,
  /** Linear drag on both axes when no acceleration is applied on that axis. */
  drag: 200,
  bounce: 0.4,
  maxSpeed: 2000,
} as const

export const ACCELERATION = 3000

/**
 * Left stick shaping: tilt below the deadzone reads 0 (pads rest slightly off centre), tilt past
 * the saturation point reads full, and it is linear in between. Starting values to tune in playtest.
 */
export const STICK_DEADZONE = 0.2
export const STICK_SATURATION = 0.95
/** Shaped stick past this counts as pressing that direction (for held dash), until below the release. */
export const STICK_PRESS = 0.5
export const STICK_RELEASE = 0.35
export const JUMP_VELOCITY = 1000
export const DASH_SPEED = 1500
export const DASHES_ALLOWED = 2
/**
 * Letting go of jump while the first flap still rises multiplies its upward speed by this, once. At
 * 0.5 the quickest tap rises about a quarter of a held flap; holding gives the full arc.
 */
export const JUMP_CUT = 0.5
/** Lift of each flap as a fraction of JUMP_VELOCITY; once used up, further flaps do nothing. */
export const FLAP_SEQUENCE: ReadonlyArray<number> = [1, 0.8, 0.6, 0.4, 0.2]

/** Velocity each orb's own velocity is set to when two orbs bump, signed away from the other. */
export const BUMP = { x: 500, y: 800 } as const
export const BUMP_COOLDOWN_MS = 200

/** Upward velocity a bounce pad sets. Puts its apex beyond what flapping alone can reach. */
export const BOUNCE_PAD_VY = 1700

/** Orb hitbox radius in world pixels (rounded up). */
export const ORB_RADIUS = 13

/** The energy sea: its surface is at y = 0 and its floor (the world bottom) SEA_DEPTH below. */
export const SEA_DEPTH = 100
/** Horizontal speed cap while in the sea. */
export const SEA_MAX_VX = 250
/** Vertical velocity is multiplied by this every step while in the sea. */
export const SEA_DAMP_Y = 0.985

/**
 * Upward rebound below this, while resting on a floor, is zeroed so the orb settles. With BODY.bounce
 * a resting orb otherwise hops forever: each 120 Hz step's gravity (≈17 px/s) rebounds, and the
 * loop was measured peaking at 41 px/s (2026-10-23, headless, lobby floor). Starting value: it must
 * stay above that loop and below real landing bounces (a 10 px drop rebounds ≈80 px/s). If resting
 * orbs still twitch, raise it; if short drops stop bouncing, lower it.
 */
export const SETTLE_SPEED = 60

/**
 * Height of a vertical launch at `vy`, integrated exactly as Arcade does at STEP_HZ: gravity and
 * linear drag both oppose a rising body, and position moves by the post-update velocity.
 */
export const launchApex = (vy: number): number => {
  const decel = (GRAVITY + BODY.drag) / STEP_HZ
  let v = vy
  let height = 0
  for (;;) {
    v -= decel
    if (v <= 0) return height
    height += v / STEP_HZ
  }
}

/** Greatest open-air climb from a standstill: every flap in the sequence fired at its apex. */
export const maxFlapClimb = (): number => {
  let total = 0
  FLAP_SEQUENCE.forEach((lift) => (total += launchApex(JUMP_VELOCITY * lift)))
  return Math.floor(total)
}

/** Apex of a bounce-pad launch, in whole pixels. */
export const padApex = (): number => Math.round(launchApex(BOUNCE_PAD_VY))

/**
 * Generator reach budgets. The climb budget leaves a quarter of the theoretical flap climb for
 * timing slop and horizontal travel; the sea budget is how far above the sea surface a surface can
 * sit and still be reached from the sea floor (checked against a simulation in tests).
 */
export const CLIMB_BUDGET = Math.floor((maxFlapClimb() * 3) / 4)
export const SEA_CLIMB_BUDGET = 240
/** Widest horizontal gap the generator treats as jumpable at equal height. */
export const GAP_BUDGET = 520
