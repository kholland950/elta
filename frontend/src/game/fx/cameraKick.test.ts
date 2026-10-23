import { describe, expect, it } from 'vitest'
import { KICK_MS, KICK_OUT_MS, KICK_PX, kickEnvelope, kickOffset } from './cameraKick'

describe('kickEnvelope', () => {
  it('is at rest before the kick and once it has settled', () => {
    expect(kickEnvelope(-5)).toBe(0)
    expect(kickEnvelope(0)).toBe(0)
    expect(kickEnvelope(KICK_MS)).toBe(0)
    expect(kickEnvelope(KICK_MS + 500)).toBe(0)
    expect(kickEnvelope(NaN)).toBe(0)
  })

  it('peaks at 1 at the end of the snap out', () => {
    expect(kickEnvelope(KICK_OUT_MS)).toBeCloseTo(1)
  })

  it('rises then falls monotonically within 0..1 (no overshoot or wobble)', () => {
    let prev = 0
    for (let t = 1; t <= KICK_MS; t++) {
      const e = kickEnvelope(t)
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(1)
      if (t <= KICK_OUT_MS) expect(e).toBeGreaterThanOrEqual(prev)
      else expect(e).toBeLessThanOrEqual(prev)
      prev = e
    }
  })

  it('settles into rest instead of stopping abruptly', () => {
    expect(kickEnvelope(KICK_MS - 5)).toBeLessThan(0.001)
  })
})

describe('kickOffset', () => {
  it('recoils against the dash and stays a little kick', () => {
    expect(kickOffset(KICK_OUT_MS, 1)).toBeCloseTo(-KICK_PX)
    expect(kickOffset(KICK_OUT_MS, -1)).toBeCloseTo(KICK_PX)
    expect(KICK_PX).toBeLessThanOrEqual(12)
    expect(KICK_MS).toBeLessThanOrEqual(200)
  })
})
