import { describe, expect, it } from 'vitest'
import { menuActionForKey } from './menuKeys'

const key = (code: string, extra: { repeat?: boolean; shiftKey?: boolean } = {}) =>
  menuActionForKey({ code, repeat: false, shiftKey: false, ...extra })

describe('menuActionForKey', () => {
  it('maps arrows and WASD to moves', () => {
    expect(key('ArrowUp')).toBe('up')
    expect(key('KeyW')).toBe('up')
    expect(key('ArrowDown')).toBe('down')
    expect(key('KeyS')).toBe('down')
    expect(key('ArrowLeft')).toBe('left')
    expect(key('KeyA')).toBe('left')
    expect(key('ArrowRight')).toBe('right')
    expect(key('KeyD')).toBe('right')
  })

  it('maps Tab and Shift+Tab to next and prev', () => {
    expect(key('Tab')).toBe('next')
    expect(key('Tab', { shiftKey: true })).toBe('prev')
  })

  it('maps Space and Enter to confirm, Escape to back', () => {
    expect(key('Space')).toBe('confirm')
    expect(key('Enter')).toBe('confirm')
    expect(key('NumpadEnter')).toBe('confirm')
    expect(key('Escape')).toBe('back')
  })

  it('lets moves repeat but drops repeated confirm and back', () => {
    expect(key('ArrowDown', { repeat: true })).toBe('down')
    expect(key('Space', { repeat: true })).toBeNull()
    expect(key('Enter', { repeat: true })).toBeNull()
    expect(key('Escape', { repeat: true })).toBeNull()
  })

  it('ignores other keys', () => {
    expect(key('KeyQ')).toBeNull()
    expect(key('ShiftLeft')).toBeNull()
  })
})
