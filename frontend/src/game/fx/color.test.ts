import { describe, expect, it } from 'vitest'
import { lighten } from './color'

describe('lighten', () => {
  it('keeps the colour at 0 and gives white at 1', () => {
    expect(lighten(0x3d9bff, 0)).toBe(0x3d9bff)
    expect(lighten(0x3d9bff, 1)).toBe(0xffffff)
  })

  it('mixes each channel toward 255', () => {
    expect(lighten(0x000000, 0.5)).toBe(0x808080)
    expect(lighten(0xff0000, 0.5)).toBe(0xff8080)
  })

  it('clamps the amount', () => {
    expect(lighten(0x102030, -1)).toBe(0x102030)
    expect(lighten(0x102030, 2)).toBe(0xffffff)
  })
})
