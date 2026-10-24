import { describe, expect, it } from 'vitest'
import { generateStage } from './generateStage'
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

  // Generated Tower stages stack switchback legs above each other: an orb walking the real spine
  // must never be latched onto the leg above or below
  it('tracks an orb along stacked switchback spines of generated Tower stages', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const stage = generateStage(seed * 7919, 1 + seed, 2, 'tower')
      const spine = stage.spine
      const lengths = spineLengths(spine)
      let leg = 0
      let last = 0
      for (let k = 0; k < spine.length - 1; k++) {
        for (let t = 0; t < 1; t += 0.1) {
          const p = { x: spine[k].x + (spine[k + 1].x - spine[k].x) * t, y: spine[k].y + (spine[k + 1].y - spine[k].y) * t }
          const progress = progressAlong(spine, lengths, p, leg)
          expect(progress.distance).toBeGreaterThanOrEqual(last - 1)
          last = progress.distance
          leg = progress.leg
        }
      }
      expect(last).toBeGreaterThan(lengths[lengths.length - 1] * 0.95)
    }
  })

  // The spine follows a fork's low branch; an orb taking the high branch above it must still be
  // tracked forward, not latched onto a later or earlier leg
  it('tracks an orb taking the high branch of a generated fork', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const stage = generateStage(seed * 104729, 1 + seed, 1, 'labyrinth')
      const lengths = spineLengths(stage.spine)
      for (const seg of stage.segments.filter((s) => s.fork)) {
        // Start from the fork's first spine point, as a tracker arriving from the previous segment would
        let leg = stage.spine.indexOf(seg.spine[0])
        const lowTop = Math.min(...seg.fork!.low.map((r) => r.y))
        // Walk the high branch's tunnels (not the drop hole down into the low branch)
        const highs = [...seg.fork!.high].filter((r) => r.h >= 100 && r.y + r.h < lowTop).sort((a, b) => (seg.exit.dir === 'W' ? b.x - a.x : a.x - b.x))
        // Projecting from 6+ rows above the dip can slip back a little (measured ≤ 150 px); a
        // latch onto another layer would jump much further
        let last = -1
        const first = progressAlong(stage.spine, lengths, seg.spine[0], leg).distance
        for (const r of highs) {
          for (let k = 0; k < 4; k++) {
            const x = seg.exit.dir === 'W' ? r.x + r.w - (r.w * k) / 4 : r.x + (r.w * k) / 4
            const p = progressAlong(stage.spine, lengths, { x, y: r.y + r.h - 13 }, leg)
            expect(p.distance).toBeGreaterThanOrEqual(last - 250)
            last = Math.max(last, p.distance)
            leg = p.leg
          }
        }
        // Across the whole high branch, progress moved on by most of the branch's length
        const span = Math.max(...highs.map((r) => r.x + r.w)) - Math.min(...highs.map((r) => r.x))
        expect(last - first).toBeGreaterThan(span * 0.6)
      }
    }
  })
})
