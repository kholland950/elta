import { describe, expect, it } from 'vitest'
import { mulberry32 } from './starfield'
import { WISP_FADE_IN, WISP_SHED_MS, wispFrame, wispSeeds } from './wisps'

describe('wispSeeds', () => {
  it('rolls the requested count, spread across the shed window', () => {
    const seeds = wispSeeds(10, mulberry32(1))
    expect(seeds).toHaveLength(10)
    expect(seeds[0].delayMs).toBe(0)
    expect(seeds[9].delayMs).toBeCloseTo(WISP_SHED_MS)
    expect(wispSeeds(0)).toEqual([])
    expect(wispSeeds(1)[0].delayMs).toBe(0)
  })

  it('varies phase and amplitude per mote and keeps life short', () => {
    const seeds = wispSeeds(10, mulberry32(7))
    expect(new Set(seeds.map((s) => s.phase)).size).toBe(10)
    expect(new Set(seeds.map((s) => s.amplitude)).size).toBe(10)
    for (const s of seeds) {
      expect(s.lifeMs).toBeGreaterThanOrEqual(200)
      expect(s.lifeMs).toBeLessThanOrEqual(360)
      expect(s.endScale).toBeLessThan(s.startScale)
    }
  })
})

describe('wispFrame', () => {
  const seed = wispSeeds(1, mulberry32(3))[0]

  it('starts on the shed point, invisible', () => {
    const f = wispFrame(seed, 0, 1)
    expect(f.x).toBeCloseTo(0)
    expect(f.y).toBeCloseTo(0)
    expect(f.alpha).toBe(0)
    expect(f.scale).toBeCloseTo(seed.startScale)
  })

  it('drifts opposite the dash direction', () => {
    expect(wispFrame(seed, 1, 1).x).toBeLessThan(0)
    expect(wispFrame(seed, 1, -1).x).toBeGreaterThan(0)
    expect(wispFrame(seed, 0.6, 1).x).toBeCloseTo(-wispFrame(seed, 0.6, -1).x)
  })

  it('flashes in, then fades out while shrinking', () => {
    expect(wispFrame(seed, WISP_FADE_IN, 1).alpha).toBeCloseTo(seed.peakAlpha)
    expect(wispFrame(seed, 0.5, 1).alpha).toBeLessThan(seed.peakAlpha)
    expect(wispFrame(seed, 1, 1).alpha).toBeCloseTo(0)
    expect(wispFrame(seed, 1, 1).scale).toBeCloseTo(seed.endScale)
    expect(wispFrame(seed, 0.5, 1).scale).toBeLessThan(seed.startScale)
  })

  it('wobbles: the path is not a straight line', () => {
    const ys = [0.25, 0.5, 0.75].map((t) => wispFrame({ ...seed, rise: 0, spread: 0 }, t, 1).y)
    expect(ys.some((y) => Math.abs(y) > 0.5)).toBe(true)
  })

  it('fans sparks out to both sides of the drift', () => {
    const ys = wispSeeds(40, mulberry32(11)).map((s) => wispFrame(s, 1, 1).y)
    expect(Math.min(...ys)).toBeLessThan(-40)
    expect(Math.max(...ys)).toBeGreaterThan(40)
  })

  it('clamps bad t', () => {
    expect(wispFrame(seed, -1, 1)).toEqual(wispFrame(seed, 0, 1))
    expect(wispFrame(seed, 5, 1)).toEqual(wispFrame(seed, 1, 1))
    expect(wispFrame(seed, NaN, 1)).toEqual(wispFrame(seed, 1, 1))
  })
})
