import { describe, expect, it } from 'vitest'
import { platformAt } from './motion'
import type { Mover } from './stage'

const mover: Mover = { kind: 'mover', x: 100, y: 50, w: 200, h: 32, dx: 400, dy: -120, periodMs: 4000, phaseMs: 500 }

describe('platformAt', () => {
  it('is periodic', () => {
    for (const t of [0, 123, 1999, 3500]) {
      expect(platformAt(mover, t + 4000).x).toBeCloseTo(platformAt(mover, t).x, 6)
      expect(platformAt(mover, t - 8000).y).toBeCloseTo(platformAt(mover, t).y, 6)
    }
  })

  it('stays between rest and rest + offset', () => {
    for (let t = 0; t < 4000; t += 50) {
      const p = platformAt(mover, t)
      expect(p.x).toBeGreaterThanOrEqual(100)
      expect(p.x).toBeLessThanOrEqual(500)
    }
  })

  it('is continuous and its velocity matches the change in position', () => {
    const dt = 1
    for (let t = 0; t < 8000; t += 37) {
      const a = platformAt(mover, t)
      const b = platformAt(mover, t + dt)
      expect(Math.abs(b.x - a.x)).toBeLessThan(1)
      // Skip the two turnaround instants where velocity flips
      const turn = (t + mover.phaseMs) % 2000
      if (turn > 2 && turn < 1998) {
        expect(((b.x - a.x) * 1000) / dt).toBeCloseTo(a.vx, 3)
        expect(((b.y - a.y) * 1000) / dt).toBeCloseTo(a.vy, 3)
      }
    }
  })
})
