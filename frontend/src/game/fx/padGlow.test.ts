import { describe, expect, it } from 'vitest'
import {
  FLASH_MS,
  PAD_TOP_TOLERANCE,
  PULSE_MAX,
  PULSE_MIN,
  PULSE_PERIOD_MS,
  flashLevel,
  padAt,
  padPhase,
  padPulse,
} from './padGlow'

describe('padPulse', () => {
  it('stays within the brightness range and reaches both ends', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let t = 0; t < PULSE_PERIOD_MS; t += 5) {
      const v = padPulse(t, 0.4, false)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(lo).toBeGreaterThanOrEqual(PULSE_MIN - 1e-9)
    expect(hi).toBeLessThanOrEqual(PULSE_MAX + 1e-9)
    expect(lo).toBeCloseTo(PULSE_MIN, 2)
    expect(hi).toBeCloseTo(PULSE_MAX, 2)
  })

  it('breathes about once a second', () => {
    expect(PULSE_PERIOD_MS).toBe(1000)
    for (const t of [0, 130, 470, 820]) {
      expect(padPulse(t + PULSE_PERIOD_MS, 1, false)).toBeCloseTo(padPulse(t, 1, false))
    }
    expect(padPulse(250, 0, false)).not.toBeCloseTo(padPulse(750, 0, false))
  })

  it('holds steady under reduced motion', () => {
    const v = padPulse(0, 0, true)
    for (const t of [90, 250, 600, 12345]) expect(padPulse(t, 2, true)).toBe(v)
    expect(v).toBeGreaterThan(PULSE_MIN)
    expect(v).toBeLessThan(PULSE_MAX)
  })

  it('pads at different x breathe out of step', () => {
    expect(padPhase(0)).toBe(0)
    expect(padPulse(200, padPhase(0), false)).not.toBeCloseTo(padPulse(200, padPhase(300), false))
  })
})

describe('padAt', () => {
  const pads = [
    { x: 100, y: 400, w: 100, h: 50 },
    { x: 500, y: 300, w: 100, h: 50 },
  ]

  it('finds the pad under a point on its top', () => {
    expect(padAt(pads, 150, 400)).toBe(pads[0])
    expect(padAt(pads, 590, 300)).toBe(pads[1])
  })

  it('accepts the span ends and a few px either side of the top', () => {
    expect(padAt(pads, 100, 400)).toBe(pads[0])
    expect(padAt(pads, 200, 400)).toBe(pads[0])
    expect(padAt(pads, 150, 400 - PAD_TOP_TOLERANCE)).toBe(pads[0])
    expect(padAt(pads, 150, 400 + PAD_TOP_TOLERANCE)).toBe(pads[0])
  })

  it('misses beside a pad, too far above or below its top, and with no pads', () => {
    expect(padAt(pads, 99, 400)).toBeUndefined()
    expect(padAt(pads, 201, 400)).toBeUndefined()
    expect(padAt(pads, 150, 400 - PAD_TOP_TOLERANCE - 1)).toBeUndefined()
    expect(padAt(pads, 150, 425)).toBeUndefined()
    expect(padAt([], 150, 400)).toBeUndefined()
  })
})

describe('flashLevel', () => {
  it('starts full and is gone after the flash', () => {
    expect(flashLevel(0)).toBe(1)
    expect(flashLevel(-10)).toBe(1)
    expect(flashLevel(FLASH_MS)).toBe(0)
    expect(flashLevel(FLASH_MS * 3)).toBe(0)
  })

  it('decays monotonically and eases out (fast drop first)', () => {
    let prev = 1
    for (let t = 10; t <= FLASH_MS; t += 10) {
      const v = flashLevel(t)
      expect(v).toBeLessThan(prev)
      prev = v
    }
    expect(flashLevel(FLASH_MS / 2)).toBeLessThan(0.5)
  })
})
