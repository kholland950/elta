import { describe, expect, it, vi } from 'vitest'
import { RaceDirector } from './RaceDirector'
import type { PhysicsSprite } from './render/PlayerVisuals'
import { STEP_MS } from './race/tuning'

const R = 13

/** Just enough of an Arcade body: position is the top-left, centre follows it. */
const fakeSprite = (x: number, y: number) => {
  const body = {
    position: { x: x - R, y: y - R },
    center: { x, y },
    velocity: { x: 0, y: 0 },
    stop: vi.fn(),
    updateCenter() {
      body.center.x = body.position.x + R
      body.center.y = body.position.y + R
    },
    moveTo(nx: number, ny: number) {
      body.position.x = nx - R
      body.position.y = ny - R
      body.updateCenter()
    },
  }
  return { sprite: { body } as unknown as PhysicsSprite, body }
}

const gate = { x: 1000, top: 0, bottom: 500, right: 1600 }
const slot = { x: 160, y: 400 }
const plan = { exploreAt: 1000, snapAt: 16000, goAt: 19500 }

const setup = () => {
  const { sprite, body } = fakeSprite(500, 300)
  const onHold = vi.fn()
  const director = new RaceDirector(() => sprite, onHold)
  let now = 0
  const onFinish = vi.fn()
  const onSnap = vi.fn()
  const onExplore = vi.fn()
  director.startRound(gate, slot, plan, () => now, { onFinish, onSnap, onExplore })
  return { director, body, onHold, onFinish, onSnap, onExplore, setNow: (t: number) => (now = t) }
}

describe('RaceDirector in a server round', () => {
  it('holds the orb in its bay with the gate shut until explore', () => {
    const { director, body, onExplore, setNow } = setup()
    expect(body.center).toEqual(slot)
    expect(director.locked).toBe(true)
    expect(director.gatesOpen).toBe(false)
    setNow(500)
    body.moveTo(700, 200)
    director.step()
    expect(body.center).toEqual(slot)
    expect(director.locked).toBe(true)
    expect(director.gatesOpen).toBe(false)
    expect(director.heldInBays).toBe(true)
    expect(onExplore).not.toHaveBeenCalled()
  })

  it('starts explore in the bay with the gate open, once', () => {
    const { director, body, onExplore, setNow } = setup()
    setNow(1000)
    director.step()
    expect(onExplore).toHaveBeenCalledTimes(1)
    expect(body.center).toEqual(slot)
    expect(director.locked).toBe(false)
    expect(director.gatesOpen).toBe(true)
    expect(director.heldInBays).toBe(false)
    body.moveTo(700, 200)
    setNow(1100)
    director.step()
    expect(onExplore).toHaveBeenCalledTimes(1)
    expect(body.center).toEqual({ x: 700, y: 200 })
  })

  it('starts the orb in its bay and lets it roam during explore', () => {
    const { director, body, setNow } = setup()
    expect(body.center).toEqual(slot)
    setNow(1000)
    director.step()
    setNow(5000)
    body.moveTo(700, 200)
    director.step()
    expect(director.locked).toBe(false)
    expect(body.center).toEqual({ x: 700, y: 200 })
    expect(director.view().exploreLeftMs).toBe(11000)
  })

  it('snaps to the slot once at the snap and holds through the countdown', () => {
    const { director, body, onSnap, setNow } = setup()
    setNow(16000)
    body.moveTo(700, 200)
    director.step()
    expect(onSnap).toHaveBeenCalledTimes(1)
    expect(director.locked).toBe(true)
    expect(director.gatesOpen).toBe(false)
    expect(body.center).toEqual(slot)
    setNow(18000)
    body.moveTo(170, 380)
    director.step()
    expect(onSnap).toHaveBeenCalledTimes(1)
    expect(body.center).toEqual(slot)
    expect(director.view().phase).toEqual({ kind: 'countdown', digit: 2 })
    expect(director.view().exploreLeftMs).toBeUndefined()
  })

  it('times the race in steps from GO and reports the finish once', () => {
    const { director, body, onFinish, setNow } = setup()
    setNow(16000)
    director.step()
    setNow(19500)
    director.step() // GO step
    expect(director.locked).toBe(false)
    expect(director.gatesOpen).toBe(true)
    body.moveTo(990, 300)
    director.step()
    body.moveTo(1010, 300) // crosses x 1000 halfway through this step
    director.step()
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0]).toBeCloseTo(1.5 * STEP_MS)
    body.moveTo(900, 300)
    director.step()
    body.moveTo(1100, 300)
    director.step()
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(director.view().finishedMs).toBeCloseTo(1.5 * STEP_MS)
    // Still free to fly until the round ends
    expect(director.locked).toBe(false)
  })

  it('snaps to the slot at GO when the snap was missed', () => {
    const { director, body, onSnap, setNow } = setup()
    setNow(20000)
    body.moveTo(700, 200)
    director.step()
    expect(onSnap).toHaveBeenCalledTimes(1)
    expect(body.center).toEqual(slot)
  })

  it('holds the orb where it was and freezes the clock once ended', () => {
    const { director, body, setNow } = setup()
    setNow(19500)
    director.step()
    director.step()
    body.moveTo(600, 250)
    director.end()
    const shown = director.view().raceMs
    body.moveTo(650, 280)
    director.step()
    director.step()
    expect(director.locked).toBe(true)
    expect(body.center).toEqual({ x: 600, y: 250 })
    expect(director.view().raceMs).toBe(shown)
    expect(director.view().mode).toBe('ended')
  })

  it('keeps the gates as they were when the round ends', () => {
    const { director, setNow } = setup()
    setNow(5000)
    director.step()
    director.end()
    director.step()
    expect(director.gatesOpen).toBe(true)
  })
})

describe('RaceDirector free roam', () => {
  it('places the orb at the slot once and never locks or times', () => {
    const { sprite, body } = fakeSprite(0, 0)
    const director = new RaceDirector(() => sprite, vi.fn())
    director.startFree(slot)
    expect(body.center).toEqual(slot)
    director.step()
    body.moveTo(5000, 100)
    for (let i = 0; i < 1000; i++) director.step()
    expect(director.locked).toBe(false)
    expect(director.gatesOpen).toBe(true)
    expect(body.center).toEqual({ x: 5000, y: 100 })
    expect(director.view()).toMatchObject({ mode: 'free', phase: { kind: 'waiting' }, raceMs: 0 })
  })
})

describe('RaceDirector placement', () => {
  // Outside a physics step Arcade's preUpdate copies the sprite back onto the body, which undoes
  // a body-only move; the next step must put the orb there again
  it('re-applies a placement made outside a step on the next step, then lets go', () => {
    const { sprite, body } = fakeSprite(0, 0)
    const director = new RaceDirector(() => sprite, vi.fn())
    director.startFree(slot)
    body.moveTo(0, 0) // preUpdate restored the old sprite position
    director.step()
    expect(body.center).toEqual(slot)
    body.moveTo(300, 300)
    director.step()
    expect(body.center).toEqual({ x: 300, y: 300 })
  })
})

describe('RaceDirector solo', () => {
  it('counts down 3 s on the step clock then races', () => {
    const { sprite } = fakeSprite(0, 0)
    const director = new RaceDirector(() => sprite, vi.fn())
    director.startSolo(gate, slot)
    director.step()
    expect(director.locked).toBe(true)
    expect(director.gatesOpen).toBe(false)
    for (let i = 0; i < 3000 / STEP_MS; i++) director.step()
    expect(director.locked).toBe(false)
    expect(director.gatesOpen).toBe(true)
    expect(director.view().phase.kind).toBe('race')
  })
})
