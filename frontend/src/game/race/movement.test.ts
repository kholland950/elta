import { describe, expect, it } from 'vitest'
import {
  BumpCooldowns,
  bumpVelocity,
  freshPilot,
  InputFrame,
  NO_INPUT,
  PilotState,
  recharge,
  seaDrag,
  isResting,
  stepPilot,
} from './movement'
import {
  ACCELERATION,
  BODY,
  BUMP,
  CLIMB_BUDGET,
  DASH_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  maxFlapClimb,
  ORB_RADIUS,
  SEA_CLIMB_BUDGET,
  SEA_DEPTH,
  SEA_MAX_VX,
  STEP_HZ,
} from './tuning'

const press = (over: Partial<InputFrame>): InputFrame => ({ ...NO_INPUT, ...over })
const flap = press({ flapPressed: true })

describe('stepPilot', () => {
  it('lifts by the flap sequence and then gives nothing', () => {
    let state = freshPilot()
    const lifts: Array<number> = []
    for (let i = 0; i < 7; i++) {
      const out = stepPilot(state, flap, { x: 0, y: 0 })
      lifts.push(0 - out.velocity.y)
      state = out.state
    }
    expect(lifts).toEqual([1000, 800, 600, 400, 200, 0, 0])
  })

  it('emits a flap only while the sequence still has lift', () => {
    let state: PilotState = { ...freshPilot(), flapIndex: 5 }
    expect(stepPilot(state, flap, { x: 0, y: 0 }).events).toEqual([])
    state = recharge(state).state
    expect(stepPilot(state, flap, { x: 0, y: 0 }).events).toEqual([{ kind: 'flap' }])
  })

  it('resets the flap sequence on recharge', () => {
    let state = freshPilot()
    state = stepPilot(state, flap, { x: 0, y: 0 }).state
    state = stepPilot(state, flap, { x: 0, y: 0 }).state
    state = recharge(state).state
    expect(stepPilot(state, flap, { x: 0, y: 0 }).velocity.y).toBe(-JUMP_VELOCITY)
  })

  it('stalls to zero velocity while a direction is held', () => {
    const out = stepPilot(freshPilot(), press({ right: true, stallPressed: true }), {
      x: 900,
      y: -300,
    })
    expect(out.velocity).toEqual({ x: 0, y: 0 })
    expect(out.events).toEqual([{ kind: 'stall' }])
    expect(out.state.canStall).toBe(false)
    // Still accelerating in the held direction afterwards
    expect(out.accelX).toBe(ACCELERATION)
  })

  it('allows one stall per charge', () => {
    let state = stepPilot(freshPilot(), press({ stallPressed: true }), { x: 5, y: 5 }).state
    const again = stepPilot(state, press({ stallPressed: true }), { x: 5, y: 5 })
    expect(again.velocity).toEqual({ x: 5, y: 5 })
    expect(again.events).toEqual([])
    state = recharge(again.state).state
    expect(state.canStall).toBe(true)
  })

  it('dashes horizontally and keeps vertical velocity', () => {
    const out = stepPilot(freshPilot(), press({ left: true, dash: -1 }), {
      x: 100,
      y: 321,
    })
    expect(out.velocity).toEqual({ x: -DASH_SPEED, y: 321 })
    expect(out.events).toEqual([{ kind: 'dash', dir: -1 }])
  })

  it('dashes the asked way and faces it, whatever is held', () => {
    const out = stepPilot(freshPilot(), press({ dash: -1 }), { x: 0, y: 0 })
    expect(out.velocity.x).toBe(-DASH_SPEED)
    expect(out.state.facing).toBe(-1)
  })

  it('does not dash without a direction', () => {
    const out = stepPilot(freshPilot(), press({ right: true }), { x: 50, y: 0 })
    expect(out.velocity.x).toBe(50)
    expect(out.events).toEqual([])
    expect(out.state.dashes).toBe(freshPilot().dashes)
  })

  it('allows two dashes per charge', () => {
    let state = freshPilot()
    const fired: Array<number> = []
    for (let i = 0; i < 3; i++) {
      const out = stepPilot(state, press({ right: true, dash: 1 }), { x: 0, y: 0 })
      fired.push(out.events.length)
      state = out.state
    }
    expect(fired).toEqual([1, 1, 0])
  })

  it('turns stall plus dash in one step into a level dash', () => {
    const out = stepPilot(freshPilot(), press({ right: true, stallPressed: true, dash: 1 }), {
      x: -400,
      y: 700,
    })
    expect(out.velocity).toEqual({ x: DASH_SPEED, y: 0 })
  })

  it('cancels acceleration when both directions are held', () => {
    expect(stepPilot(freshPilot(), press({ left: true, right: true }), { x: 0, y: 0 }).accelX).toBe(0)
  })
})

describe('recharge', () => {
  it('reports restored only when something was used', () => {
    expect(recharge(freshPilot()).restored).toBe(false)
    expect(recharge({ ...freshPilot(), flapIndex: 1 }).restored).toBe(true)
    expect(recharge({ ...freshPilot(), dashes: 0 }).restored).toBe(true)
    expect(recharge({ ...freshPilot(), canStall: false }).restored).toBe(true)
  })
})

describe('bumpVelocity', () => {
  const at = (id: string, x: number, y: number) => ({ id, x, y })

  it('sets a constant push away from the other orb on both axes', () => {
    expect(bumpVelocity(at('a', 10, 0), at('b', 0, 5))).toEqual({ x: BUMP.x, y: -BUMP.y })
    expect(bumpVelocity(at('a', 0, 5), at('b', 10, 0))).toEqual({ x: -BUMP.x, y: BUMP.y })
    expect(bumpVelocity(at('a', 0, 0), at('b', 10, 5))).toEqual({ x: -BUMP.x, y: -BUMP.y })
    expect(bumpVelocity(at('a', 10, 5), at('b', 0, 0))).toEqual({ x: BUMP.x, y: BUMP.y })
  })

  it('gives the two orbs opposite signs even when exactly aligned', () => {
    const a = bumpVelocity(at('a', 3, 3), at('b', 3, 3))
    const b = bumpVelocity(at('b', 3, 3), at('a', 3, 3))
    expect(a.x).toBe(-b.x)
    expect(a.y).toBe(-b.y)
  })
})

describe('BumpCooldowns', () => {
  it('allows one bump per pair per 200 ms', () => {
    const cd = new BumpCooldowns()
    expect(cd.tryBump('b', 1000)).toBe(true)
    expect(cd.tryBump('b', 1100)).toBe(false)
    expect(cd.tryBump('c', 1100)).toBe(true)
    expect(cd.tryBump('b', 1199)).toBe(false)
    expect(cd.tryBump('b', 1200)).toBe(true)
  })
})

describe('isResting', () => {
  it('holds the micro-bounce speeds of an orb sitting on ground', () => {
    // The measured resting loop at 120 Hz swung between -22.4 and +45 px/s
    for (const vy of [-22.4, -4, 0, 15, 45]) expect(isResting(vy, true)).toBe(true)
  })

  it('lets real bounces, flaps and bumps through', () => {
    expect(isResting(-80, true)).toBe(false) // landing from a 10 px drop
    expect(isResting(-1000, true)).toBe(false) // flap from the ground
    expect(isResting(-800, true)).toBe(false) // bump
  })

  it('needs ground underneath', () => {
    expect(isResting(0, false)).toBe(false) // apex of a jump
  })
})

describe('seaDrag', () => {
  it('caps horizontal speed and damps vertical speed', () => {
    const v = seaDrag({ x: 1500, y: -1000 })
    expect(v.x).toBe(SEA_MAX_VX)
    expect(v.y).toBeGreaterThan(-1000)
    expect(seaDrag({ x: -1500, y: 0 }).x).toBe(-SEA_MAX_VX)
  })
})

/**
 * A free orb integrated the way Arcade does at the fixed step: gravity, then acceleration or
 * linear drag per axis, the speed cap, then position. `handler` runs after each step, like the
 * worldstep listener in the game.
 */
const simulate = (
  steps: number,
  start: { x: number; y: number },
  handler: (step: number, pos: { x: number; y: number }, vel: { x: number; y: number }) => {
    vel: { x: number; y: number }
    accelX: number
  },
) => {
  const dt = 1 / STEP_HZ
  const pos = { ...start }
  let vel = { x: 0, y: 0 }
  let accelX = 0
  let minY = pos.y
  const linearDrag = (v: number) => {
    const d = BODY.drag * dt
    return v - d > 0 ? v - d : v + d < 0 ? v + d : 0
  }
  for (let i = 0; i < steps; i++) {
    vel.y += GRAVITY * dt
    vel.x = accelX ? vel.x + accelX * dt : linearDrag(vel.x)
    vel.y = linearDrag(vel.y)
    const speed = Math.hypot(vel.x, vel.y)
    if (speed > BODY.maxSpeed) {
      vel = { x: (vel.x / speed) * BODY.maxSpeed, y: (vel.y / speed) * BODY.maxSpeed }
    }
    pos.x += vel.x * dt
    pos.y += vel.y * dt
    // The sea floor is the world bottom
    const floor = SEA_DEPTH - ORB_RADIUS
    if (pos.y > floor) {
      pos.y = floor
      vel.y = 0
    }
    minY = Math.min(minY, pos.y)
    const out = handler(i, pos, vel)
    vel = out.vel
    accelX = out.accelX
  }
  return { minY, pos }
}

/** Flaps at the top of every arc, the best possible climb. */
const flapAtApex = (inSea: (y: number) => boolean) => {
  let state = freshPilot()
  let prevVy = 0
  return (step: number, pos: { y: number }, vel: { x: number; y: number }) => {
    const atApex = step === 0 || (prevVy < 0 && vel.y >= 0)
    prevVy = vel.y
    const out = stepPilot(state, atApex ? flap : NO_INPUT, vel)
    state = out.state
    return { vel: inSea(pos.y) ? seaDrag(out.velocity) : out.velocity, accelX: out.accelX }
  }
}

describe('reach budgets against the integrated motion', () => {
  it('maxFlapClimb is close to the closed-form flap apex sum', () => {
    // Closed form (v² / 2a) gives 500; the discrete step loses a little per flap
    expect(maxFlapClimb()).toBeGreaterThan(480)
    expect(maxFlapClimb()).toBeLessThanOrEqual(500)
  })

  it('an open-air climb beats the generator climb budget', () => {
    const start = { x: 0, y: -1000 }
    const { minY } = simulate(600, start, flapAtApex(() => false))
    expect(start.y - minY).toBeGreaterThanOrEqual(CLIMB_BUDGET)
    expect(start.y - minY).toBeLessThanOrEqual(maxFlapClimb() + 1)
  })

  it('a climb out of the sea floor beats the sea climb budget', () => {
    const { minY } = simulate(600, { x: 0, y: SEA_DEPTH - ORB_RADIUS }, flapAtApex((y) => y > 0))
    // Highest surface top the orb's underside clears, measured above the sea surface (y = 0)
    expect(-(minY + ORB_RADIUS)).toBeGreaterThanOrEqual(SEA_CLIMB_BUDGET)
  })
})
