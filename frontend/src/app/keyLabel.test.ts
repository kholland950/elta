import { describe, expect, it } from 'vitest'
import { keyLabel } from './keyLabel'

describe('keyLabel', () => {
  it('names keys from the US layout without a layout map', () => {
    expect(keyLabel('KeyQ')).toBe('Q')
    expect(keyLabel('Digit1')).toBe('1')
    expect(keyLabel('Numpad4')).toBe('Num 4')
    expect(keyLabel('ArrowLeft')).toBe('←')
    expect(keyLabel('ShiftLeft')).toBe('Left Shift')
    expect(keyLabel('Space')).toBe('Space')
    expect(keyLabel('F5')).toBe('F5')
    expect(keyLabel('Mouse0')).toBe('Left Click')
    expect(keyLabel('Mouse2')).toBe('Right Click')
    expect(keyLabel('Mouse5')).toBe('Mouse 6')
  })

  it("prefers the layout's own character", () => {
    const azerty = new Map([
      ['KeyQ', 'a'],
      ['Space', ' '],
    ])
    expect(keyLabel('KeyQ', azerty)).toBe('A')
    expect(keyLabel('Space', azerty)).toBe('Space')
    expect(keyLabel('KeyW', azerty)).toBe('W')
  })
})
