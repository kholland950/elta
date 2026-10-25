import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BINDINGS } from './bindings'
import { Controls } from './controls'
import type { PadLike } from './gamepad'
import { GamepadHub } from './gamepadHub'

const pad = (held: Array<number> = [], x = 0, y = 0): PadLike => ({
  connected: true,
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: held.includes(i),
    value: held.includes(i) ? 1 : 0,
  })),
  axes: [x, y, 0, 0],
})

describe('GamepadHub', () => {
  let pads: Array<PadLike | null>
  let frame: ((nowMs: number) => void) | null
  let now: number
  const listeners = new Map<string, () => void>()
  /** Runs one display frame with this pad state. */
  const tick = (state: PadLike) => {
    pads = [state]
    now += 16
    frame?.(now)
  }

  beforeEach(() => {
    pads = []
    frame = null
    now = 0
    const on = (name: string, fn: () => void) => void listeners.set(name, fn)
    vi.stubGlobal('window', { addEventListener: on, removeEventListener: () => {} })
    vi.stubGlobal('document', {
      hidden: false,
      hasFocus: () => true,
      addEventListener: on,
      removeEventListener: () => {},
    })
    vi.stubGlobal('navigator', { getGamepads: () => pads })
    vi.stubGlobal('requestAnimationFrame', (fn: (nowMs: number) => void) => {
      frame = fn
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => (frame = null))
  })

  afterEach(() => vi.unstubAllGlobals())

  const setup = () => {
    const hub = new GamepadHub()
    const controls = new Controls(DEFAULT_BINDINGS)
    hub.setGameSink(controls)
    hub.start()
    return { hub, controls }
  }

  it('plays the game with the pad', () => {
    const { controls } = setup()
    tick(pad([0], 0.95))
    expect(controls.frame()).toMatchObject({ flapPressed: true, moveX: 1 })
  })

  it('sends nothing to the game while the menu is open, and routes menu actions', () => {
    const { hub, controls } = setup()
    const actions: Array<string> = []
    hub.pushMenu({ action: (a) => actions.push(a) })
    hub.setMenuOpen(true)
    tick(pad([0], 0, 0.9))
    expect(controls.frame()).toMatchObject({ flapPressed: false, moveX: 0 })
    expect(actions).toEqual(['confirm', 'down'])
  })

  it('keeps a button and the stick held from play out of the menu, and menu buttons out of play', () => {
    const { hub, controls } = setup()
    const actions: Array<string> = []
    hub.pushMenu({ action: (a) => actions.push(a) })
    tick(pad([0], 0.9))
    controls.frame()
    hub.setMenuOpen(true)
    tick(pad([0], 0.9))
    tick(pad([0, 1], 0.9))
    expect(actions).toEqual(['back'])
    hub.setMenuOpen(false)
    tick(pad([0, 1], 0.95))
    // A and B stay quiet, but the stick held through the menu steers at once
    expect(controls.frame()).toMatchObject({ flapPressed: false, moveX: 1 })
  })

  it('calls Start listeners in play and in the menu', () => {
    const { hub } = setup()
    const start = vi.fn()
    hub.onStart(start)
    tick(pad([9]))
    hub.setMenuOpen(true)
    tick(pad([]))
    tick(pad([9]))
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('gives every press to a screen that takes it, Start included', () => {
    const { hub } = setup()
    const start = vi.fn()
    hub.onStart(start)
    const actions: Array<string> = []
    const taken: Array<number> = []
    hub.pushMenu({ action: (a) => actions.push(a) })
    const pop = hub.pushMenu({ button: (b) => (taken.push(b), true), action: (a) => actions.push(a) })
    hub.setMenuOpen(true)
    tick(pad([9, 12]))
    expect([taken, actions, start.mock.calls.length]).toEqual([[9, 12], [], 0])
    pop()
    // The taken D-pad press doesn't go on to move the screen below
    tick(pad([9, 12]))
    expect(actions).toEqual([])
  })

  it('lets go and ignores the pad while the window is away', () => {
    const { controls } = setup()
    tick(pad([15]))
    expect(controls.frame().moveX).toBe(1)
    listeners.get('blur')!()
    expect(controls.frame().moveX).toBe(0)
    tick(pad([15, 0]))
    expect(controls.frame()).toMatchObject({ moveX: 0, flapPressed: false })
    listeners.get('focus')!()
    tick(pad([15, 0]))
    expect(controls.frame()).toMatchObject({ moveX: 0, flapPressed: false })
  })

  it('unregisters a sink only if no newer one has taken its place', () => {
    const hub = new GamepadHub()
    const older = new Controls(DEFAULT_BINDINGS)
    const newer = new Controls(DEFAULT_BINDINGS)
    const offOlder = hub.setGameSink(older)
    hub.setGameSink(newer)
    offOlder()
    hub.start()
    tick(pad([0]))
    expect(newer.frame().flapPressed).toBe(true)
  })
})
