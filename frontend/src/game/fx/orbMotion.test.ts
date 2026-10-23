import { describe, expect, it } from 'vitest'
import { MAX_STRETCH, squashStretch } from './orbMotion'

describe('squashStretch', () => {
  it('is the identity at rest', () => {
    expect(squashStretch(0, 0, 2000)).toEqual({ scaleX: 1, scaleY: 1, angle: 0 })
    expect(squashStretch(3, -4, 2000)).toEqual({ scaleX: 1, scaleY: 1, angle: 0 })
  })

  it('stretches along the direction of travel', () => {
    const right = squashStretch(1000, 0, 2000)
    expect(right.scaleX).toBeGreaterThan(1)
    expect(right.scaleY).toBeLessThan(1)
    expect(right.angle).toBeCloseTo(0)
    expect(squashStretch(0, 1000, 2000).angle).toBeCloseTo(Math.PI / 2)
    expect(squashStretch(-1000, 0, 2000).angle).toBeCloseTo(Math.PI)
  })

  it('grows with speed and clamps at max speed', () => {
    const slow = squashStretch(200, 0, 2000)
    const fast = squashStretch(1500, 0, 2000)
    expect(fast.scaleX).toBeGreaterThan(slow.scaleX)
    expect(squashStretch(2000, 0, 2000).scaleX).toBeCloseTo(MAX_STRETCH)
    expect(squashStretch(9000, 0, 2000).scaleX).toBeCloseTo(MAX_STRETCH)
    expect(squashStretch(9000, 0, 2000).scaleY).toBeCloseTo(1 / MAX_STRETCH)
  })

  it('preserves area', () => {
    for (const [vx, vy] of [
      [100, 50],
      [-800, 1200],
      [5000, -5000],
    ]) {
      const { scaleX, scaleY } = squashStretch(vx, vy, 2000)
      expect(scaleX * scaleY).toBeCloseTo(1)
    }
  })

  it('is safe with bad input', () => {
    expect(squashStretch(NaN, 0, 2000)).toEqual({ scaleX: 1, scaleY: 1, angle: 0 })
    expect(squashStretch(100, 0, 0)).toEqual({ scaleX: 1, scaleY: 1, angle: 0 })
  })
})
