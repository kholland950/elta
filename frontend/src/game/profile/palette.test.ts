import { describe, expect, it } from 'vitest'
import { colorCss, colorHex, isPaletteColor, ORB_PALETTE, randomColor } from './palette'

describe('palette', () => {
  it('has 32 distinct colors', () => {
    expect(ORB_PALETTE).toHaveLength(32)
    expect(new Set(ORB_PALETTE.map((c) => c.name)).size).toBe(32)
    expect(new Set(ORB_PALETTE.map((c) => c.hex)).size).toBe(32)
  })

  it('keeps the six original color names so saved choices stay valid', () => {
    for (const name of ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']) {
      expect(isPaletteColor(name)).toBe(true)
    }
  })

  it('rejects unknown names and non-strings', () => {
    expect(isPaletteColor('Teal')).toBe(false)
    expect(isPaletteColor('blue')).toBe(false)
    expect(isPaletteColor(null)).toBe(false)
  })

  it('pins the hex values', () => {
    expect(colorHex('Red')).toBe(0xff3d3d)
    expect(colorHex('Blue')).toBe(0x3d92ff)
    expect(colorHex('Crimson')).toBe(0xff3d62)
  })

  it('formats CSS colors with leading zeros and falls back to white', () => {
    expect(colorCss('Cyan')).toBe('#3ddbff')
    expect(colorCss('Nope')).toBe('#ffffff')
  })

  it('picks a random color across the whole range', () => {
    expect(randomColor(() => 0)).toBe('Red')
    expect(randomColor(() => 0.999999)).toBe('Crimson')
    expect(randomColor(() => 1)).toBe('Crimson')
  })
})
