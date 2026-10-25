import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, rebind } from './bindings'
import { Controls } from './controls'

const down = (c: Controls, ...codes: Array<string>) => codes.forEach((code) => c.keyDown(code, false))

describe('Controls', () => {
  it('holds directions until released', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA')
    expect(c.frame()).toMatchObject({ left: true, right: false })
    expect(c.frame().left).toBe(true)
    c.keyUp('KeyA')
    expect(c.frame().left).toBe(false)
  })

  it('keeps a direction held while either of its keys is', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'ArrowRight', 'KeyD')
    c.keyUp('ArrowRight')
    expect(c.frame().right).toBe(true)
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
    expect(c.frame()).toMatchObject({ dash: 1, right: true })
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
    expect(dashRight.frame()).toMatchObject({ dash: 1, right: true })
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
    expect(c.frame()).toMatchObject({ left: false, flapPressed: false })
    down(c, 'KeyW')
    expect(c.frame().flapPressed).toBe(true)
    down(c, 'Space')
    expect(c.frame().flapPressed).toBe(false)
  })

  it('releaseAll drops held keys and latches', () => {
    const c = new Controls(DEFAULT_BINDINGS)
    down(c, 'KeyA', 'Space')
    c.releaseAll()
    expect(c.frame()).toMatchObject({ left: false, flapPressed: false })
  })
})
