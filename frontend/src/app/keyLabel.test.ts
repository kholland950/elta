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

  it('names pad buttons as printed on an Xbox-style pad', () => {
    expect(keyLabel('Pad0')).toBe('A')
    expect(keyLabel('Pad1')).toBe('B')
    expect(keyLabel('Pad3')).toBe('Y')
    expect(keyLabel('Pad4')).toBe('LB')
    expect(keyLabel('Pad5')).toBe('RB')
    expect(keyLabel('Pad7')).toBe('RT')
    expect(keyLabel('Pad8')).toBe('View')
    expect(keyLabel('Pad9')).toBe('Menu')
    expect(keyLabel('Pad11')).toBe('RS')
    expect(keyLabel('Pad12')).toBe('D-pad ↑')
    expect(keyLabel('Pad15')).toBe('D-pad →')
    expect(keyLabel('Pad16')).toBe('Pad 16')
    expect(keyLabel('Pad20')).toBe('Pad 20')
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
