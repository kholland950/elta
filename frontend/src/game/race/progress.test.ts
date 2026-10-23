import { describe, expect, it } from 'vitest'
import { progressAlong, spineLengths } from './progress'

describe('progressAlong', () => {
  // A switchback: right along the bottom, up, then back left along a leg 150px above
  const spine = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: -150 },
    { x: 0, y: -150 },
    { x: 0, y: -300 },
    { x: 1000, y: -300 },
  ]
  const lengths = spineLengths(spine)

  it('measures arc length', () => {
    expect(lengths[lengths.length - 1]).toBe(3300)
    expect(progressAlong(spine, lengths, { x: 500, y: 10 }).distance).toBe(500)
  })

  it('increases monotonically for an orb following a doubling-back route', () => {
    let leg = 0
    let last = -1
    for (let i = 0; i <= 330; i++) {
      // Walk the spine with a little vertical wobble so the parallel legs are close
      const d = i * 10
      let p = { x: 0, y: 0 }
      let acc = 0
      for (let k = 0; k < spine.length - 1; k++) {
        const len = lengths[k + 1] - lengths[k]
        if (d <= acc + len) {
          const t = (d - acc) / len
          p = { x: spine[k].x + (spine[k + 1].x - spine[k].x) * t, y: spine[k].y + (spine[k + 1].y - spine[k].y) * t }
          break
        }
        acc += len
      }
      const progress = progressAlong(spine, lengths, { x: p.x, y: p.y - 60 }, leg)
      expect(progress.distance).toBeGreaterThanOrEqual(last)
      last = progress.distance
      leg = progress.leg
    }
    expect(last).toBeCloseTo(3300, 0)
  })

  it('clamps the fraction to [0, 1]', () => {
    expect(progressAlong(spine, lengths, { x: -500, y: 0 }).fraction).toBe(0)
    expect(progressAlong(spine, lengths, { x: 5000, y: -300 }, 4).fraction).toBe(1)
  })
})
