import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, rebind } from './bindings'
import { Controls } from './controls'
import { stickX } from './gamepad'

const down = (c: Controls, ...codes: Array<string>) => codes.forEach((code) => c.keyDown(code, false))

describe('Controls', () => {
  it('holds directions until released', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA')
    expect(c.frame().moveX).toBe(-1)
    expect(c.frame().moveX).toBe(-1)
    c.keyUp('KeyA')
    expect(c.frame().moveX).toBe(0)
  })

  it('keeps a direction held while either of its keys is', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'ArrowRight', 'KeyD')
    c.keyUp('ArrowRight')
    expect(c.frame().moveX).toBe(1)
  })

  it('latches jump and stall once per fresh press, ignoring repeats', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'Space', 'KeyE')
    expect(c.frame()).toMatchObject({ flapPressed: true, stallPressed: true })
    c.keyDown('Space', true)
    expect(c.frame()).toMatchObject({ flapPressed: false, stallPressed: false })
  })

  it('dashes on a direction pressed while dash is held', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'ShiftLeft')
    expect(c.frame().dash).toBe(0)
    down(c, 'ArrowRight')
    expect(c.frame()).toMatchObject({ dash: 1, moveX: 1 })
    expect(c.frame().dash).toBe(0)
  })

  it('dashes on dash pressed while a direction is held', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA')
    c.frame()
    down(c, 'ShiftRight')
    expect(c.frame().dash).toBe(-1)
  })

  it('dashes the way pressed last when both directions are held', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyD', 'KeyA', 'ShiftLeft')
    expect(c.frame().dash).toBe(-1)
    c.keyUp('KeyA')
    c.keyUp('ShiftLeft')
    down(c, 'ShiftLeft')
    expect(c.frame().dash).toBe(1)
  })

  it('does not dash on a second dash key or a second key of a held direction', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'ShiftLeft', 'KeyD')
    c.frame()
    down(c, 'ShiftRight', 'ArrowRight')
    expect(c.frame().dash).toBe(0)
  })

  it('drives every action a duplicated key is bound to', () => {
    const c = new Controls(rebind(DEFAULT_BINDINGS, 'stall', 1, 'Space'))
    down(c, 'Space')
    expect(c.frame()).toMatchObject({ flapPressed: true, stallPressed: true })

    const dashRight = new Controls(rebind(DEFAULT_BINDINGS, 'dash', 1, 'KeyD'))
    down(dashRight, 'KeyD')
    expect(dashRight.frame()).toMatchObject({ dash: 1, moveX: 1 })
  })

  it('treats a bound mouse button like a key', () => {
    const c = new Controls(rebind(DEFAULT_BINDINGS, 'stall', 1, 'Mouse2'))
    expect(c.isBound('Mouse2')).toBe(true)
    expect(c.isBound('Mouse0')).toBe(false)
    c.keyDown('Mouse2', false)
    expect(c.frame().stallPressed).toBe(true)
  })

  it('reports whether a key is bound', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    expect(c.keyDown('KeyQ', false)).toBe(false)
    expect(c.keyDown('KeyE', false)).toBe(true)
    expect(c.keyDown('KeyE', true)).toBe(true)
  })

  it('uses new bindings and lets go of held keys', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA', 'Space')
    c.setBindings(rebind(DEFAULT_BINDINGS, 'jump', 0, 'KeyW'))
    expect(c.frame()).toMatchObject({ moveX: 0, flapPressed: false })
    down(c, 'KeyW')
    expect(c.frame().flapPressed).toBe(true)
    down(c, 'Space')
    expect(c.frame().flapPressed).toBe(false)
  })

  it('reads jump as held while any of its bindings is, pad included', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    expect(c.frame().flapHeld).toBe(false)
    down(c, 'Space', 'Pad0')
    expect(c.frame()).toMatchObject({ flapPressed: true, flapHeld: true })
    c.keyUp('Space')
    expect(c.frame()).toMatchObject({ flapPressed: false, flapHeld: true })
    c.keyUp('Pad0')
    expect(c.frame().flapHeld).toBe(false)
  })

  it('stops holding jump on releaseAll and follows a rebind', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'ArrowUp')
    c.releaseAll()
    expect(c.frame().flapHeld).toBe(false)
    c.setBindings(rebind(DEFAULT_BINDINGS, 'jump', 0, 'KeyW'))
    down(c, 'KeyW')
    expect(c.frame().flapHeld).toBe(true)
    down(c, 'Space')
    c.keyUp('KeyW')
    expect(c.frame().flapHeld).toBe(false)
  })

  it('cancels movement when both directions are held', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA', 'KeyD')
    expect(c.frame().moveX).toBe(0)
  })

  it('releaseAll drops held keys, the stick and latches', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA', 'Space')
    c.releaseAll()
    expect(c.frame()).toMatchObject({ moveX: 0, flapPressed: false })
    c.setStick(stickX(0.8))
    c.releaseAll()
    expect(c.frame().moveX).toBe(0)
  })

  describe('pad', () => {
    it('plays on the default pad buttons like keys', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'Pad0', 'Pad5')
      expect(c.frame()).toMatchObject({ flapPressed: true, stallPressed: true })
    })

    it('leaves the D-pad unbound: it is quick chat', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'Pad12', 'Pad13', 'Pad14', 'Pad15')
      expect(c.frame()).toMatchObject({ moveX: 0, flapPressed: false })
    })

    it('dashes on LB held and a bound pad direction pressed', () => {
      const c = new Controls({ ...DEFAULT_BINDINGS, left: ['ArrowLeft', 'KeyA', 'Pad2'] })
      down(c, 'Pad4', 'Pad2')
      expect(c.frame()).toMatchObject({ dash: -1, moveX: -1 })
    })

    it('steers by how far the stick is pushed', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      c.setStick(stickX(0.4))
      expect(c.frame().moveX).toBeCloseTo(0.267, 3)
      c.setStick(stickX(-1))
      expect(c.frame().moveX).toBe(-1)
      c.setStick(stickX(0.1))
      expect(c.frame().moveX).toBe(0)
    })

    it('dashes when the stick is pushed far with LB held, but not on a light push', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'Pad4')
      c.setStick(stickX(0.4))
      expect(c.frame().dash).toBe(0)
      c.setStick(stickX(0.6))
      expect(c.frame().dash).toBe(1)
      // Held out: no second dash
      c.setStick(stickX(0.9))
      expect(c.frame().dash).toBe(0)
    })

    it('dashes on LB pressed with the stick already out', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      c.setStick(stickX(-0.7))
      c.frame()
      down(c, 'Pad4')
      expect(c.frame().dash).toBe(-1)
    })

    it('needs the stick to come back past the release point before it presses again', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'Pad4')
      c.setStick(stickX(0.7))
      expect(c.frame().dash).toBe(1)
      // Shaped 0.4 is below the press point but above the release point: still held
      c.setStick(0.4)
      c.setStick(0.6)
      expect(c.frame().dash).toBe(0)
      c.setStick(0.3)
      c.setStick(0.6)
      expect(c.frame().dash).toBe(1)
    })

    it('dashes the other way when the stick is flicked across', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'Pad4')
      c.setStick(0.8)
      c.frame()
      c.setStick(-0.8)
      expect(c.frame()).toMatchObject({ dash: -1, moveX: -0.8 })
    })

    it('does not count the stick as a fresh press of a direction a key holds', () => {
      const c = new Controls(DEFAULT_BINDINGS)
      down(c, 'KeyD', 'ShiftLeft')
      c.frame()
      c.setStick(0.8)
      expect(c.frame().dash).toBe(0)
    })

    it('lets a held key or bound pad direction override the stick', () => {
      const c = new Controls({ ...DEFAULT_BINDINGS, right: ['ArrowRight', 'KeyD', 'Pad15'] })
      c.setStick(0.3)
      down(c, 'KeyA')
      expect(c.frame().moveX).toBe(-1)
      c.keyUp('KeyA')
      down(c, 'Pad15')
      expect(c.frame().moveX).toBe(1)
      c.keyUp('Pad15')
      expect(c.frame().moveX).toBe(0.3)
    })
  })
})
