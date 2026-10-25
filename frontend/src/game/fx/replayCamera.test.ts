import { describe, expect, it } from 'vitest'
import { beatAt, replayTimeline } from '../race/replayTimeline'
import { clampCenter, dampPose, fitBox, keepInView, parallaxCover, Pose, posePlan, REPLAY_MIN_ZOOM } from './replayCamera'

const pose = (): Pose => ({ cx: 0, cy: 0, zoom: 1 })

describe('fitBox', () => {
  it('centres on the box and fits it inside the padding', () => {
    const out = fitBox(1000, 500, 3000, 900, 1600, 900, pose(), 100, 0.5)
    expect(out.cx).toBe(2000)
    expect(out.cy).toBe(700)
    expect(out.zoom).toBeCloseTo(1400 / 2000)
  })

  it('fits by the tighter side', () => {
    expect(fitBox(0, 0, 1000, 1400, 1600, 900, pose(), 100, 0.5).zoom).toBeCloseTo(700 / 1400)
  })

  it('stays at zoom 1 for a small group or a lone head', () => {
    expect(fitBox(0, 0, 300, 200, 1600, 900, pose()).zoom).toBe(1)
    expect(fitBox(50, 50, 50, 50, 1600, 900, pose())).toEqual({ cx: 50, cy: 50, zoom: 1 })
  })

  it('never zooms out past the floor, even for a spread-out field', () => {
    expect(fitBox(0, 0, 50_000, 3000, 1600, 900, pose()).zoom).toBe(REPLAY_MIN_ZOOM)
    // A window smaller than the padding still gets the floor, not a negative zoom
    expect(fitBox(0, 0, 1000, 1000, 200, 200, pose()).zoom).toBe(REPLAY_MIN_ZOOM)
  })
})

describe('dampPose', () => {
  it('closes half the gap per halflife, the zoom in log space', () => {
    const state = { cx: 0, cy: 100, zoom: 1 }
    dampPose(state, { cx: 1000, cy: 100, zoom: 0.5 }, 200, 200, 400)
    expect(state.cx).toBeCloseTo(500)
    expect(state.cy).toBe(100)
    // Half a zoom halflife closes 1 - sqrt(1/2) of the gap, in log space
    expect(Math.log(state.zoom)).toBeCloseTo(Math.log(0.5) * (1 - Math.SQRT1_2))
  })

  it('ends in the same place whatever the frame rate', () => {
    const goal = { cx: 800, cy: -300, zoom: 0.6 }
    const at60 = { cx: 0, cy: 0, zoom: 1 }
    const at240 = { cx: 0, cy: 0, zoom: 1 }
    for (let i = 0; i < 60; i++) dampPose(at60, goal, 1000 / 60, 150, 400)
    for (let i = 0; i < 240; i++) dampPose(at240, goal, 1000 / 240, 150, 400)
    expect(at240.cx).toBeCloseTo(at60.cx, 6)
    expect(at240.cy).toBeCloseTo(at60.cy, 6)
    expect(at240.zoom).toBeCloseTo(at60.zoom, 9)
  })

  it('does not move with no time passed', () => {
    const state = { cx: 1, cy: 2, zoom: 0.7 }
    dampPose(state, { cx: 100, cy: 100, zoom: 1 }, 0, 150, 400)
    expect(state).toEqual({ cx: 1, cy: 2, zoom: 0.7 })
  })
})

describe('clampCenter', () => {
  const bounds = { x: 0, y: 0, w: 5000, h: 2000 }

  it('keeps a centre that is already inside', () => {
    const out = clampCenter(bounds, 1600, 900, 1, 2500, 1000, pose())
    expect(out).toEqual({ cx: 2500, cy: 1000, zoom: 1 })
  })

  it('pulls a centre near an edge in by half the view', () => {
    const out = clampCenter(bounds, 1600, 900, 1, 100, 1990, pose())
    expect(out.cx).toBe(800)
    expect(out.cy).toBe(2000 - 450)
  })

  it('pins a view wider than the bounds to their left edge, like Phaser', () => {
    const out = clampCenter({ x: 0, y: 0, w: 1000, h: 2000 }, 1600, 900, 1, 500, 1000, pose())
    expect(out.cx).toBe(800)
  })
})

describe('posePlan', () => {
  const from = { cx: 300, cy: 400, zoom: 1 }
  // The group pose
  const fit = { cx: 5000, cy: 1000, zoom: 0.5 }
  const target = { cx: 8000, cy: 600, zoom: 1 }
  // null for no target (a default parameter would swallow an explicit undefined)
  const at = (reason: 'finish' | 'timeout', t: number, tgt: Pose | null = target) =>
    posePlan(beatAt(replayTimeline(reason, 0), t), from, fit, tgt ?? undefined, pose())

  it('holds where it was until the zoom-out, then the group through the replay', () => {
    expect(at('finish', 0)).toEqual(from)
    expect(at('finish', 1699)).toEqual(from)
    expect(at('finish', 2500)).toEqual(fit)
    expect(at('finish', 4999)).toEqual(fit)
  })

  it('ends the zoom-in on the target and stays there', () => {
    expect(at('finish', 5800)).toEqual(target)
    expect(at('finish', 9800)).toEqual(target)
  })

  it('stays on the group after a timeout, or with no target', () => {
    expect(at('timeout', 5000, null)).toEqual(fit)
    expect(at('timeout', 7000, null)).toEqual(fit)
    expect(at('finish', 6000, null)).toEqual(fit)
  })

  it('is continuous across every beat edge', () => {
    for (const edge of [1700, 2500, 5000, 5800, 9800]) {
      const a = at('finish', edge - 0.01)
      const b = at('finish', edge)
      expect(Math.abs(a.cx - b.cx)).toBeLessThan(1)
      expect(Math.abs(a.cy - b.cy)).toBeLessThan(1)
      expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(1e-3)
    }
  })

  it('zooms geometrically and monotonically through the zoom-out', () => {
    let last = Infinity
    for (let t = 1700; t <= 2500; t += 20) {
      const z = at('finish', t).zoom
      expect(z).toBeLessThanOrEqual(last)
      last = z
    }
    // Halfway through the eased beat the zoom is the geometric mean
    expect(at('finish', 2100).zoom).toBeCloseTo(Math.sqrt(fit.zoom * from.zoom))
  })
})

describe('parallaxCover', () => {
  // The layer-space span a view shows (see parallaxCover's comment)
  const shown = (cx: number, s: number, vw: number, zoom: number) => {
    const mid = cx * s + (vw / 2) * (1 - s)
    return [mid - vw / (2 * zoom), mid + vw / (2 * zoom)]
  }

  it('covers every view up to the size and down to the zoom, anywhere in the bounds', () => {
    const bounds = { x: -2000, y: 0, w: 20_000, h: 3000 }
    for (const s of [0.15, 0.4, 0.7]) {
      const cover = parallaxCover(bounds, s, 4096, 0.08)
      for (const cx of [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w]) {
        for (const vw of [320, 1600, 4096]) {
          for (const zoom of [0.08, 0.3, 1]) {
            const [lo, hi] = shown(cx, s, vw, zoom)
            expect(lo).toBeGreaterThanOrEqual(cover.x)
            expect(hi).toBeLessThanOrEqual(cover.x + cover.w)
          }
        }
      }
    }
  })

  it('grows as the zoom drops', () => {
    const bounds = { x: 0, y: 0, w: 10_000, h: 2000 }
    expect(parallaxCover(bounds, 0.4, 4096, 0.1).w).toBeGreaterThan(parallaxCover(bounds, 0.4, 4096, 1).w)
  })
})

describe('keepInView', () => {
  it('leaves the pose alone when the point is already in view', () => {
    const pose = { cx: 1000, cy: 500, zoom: 1 }
    expect(keepInView(pose, 1200, 600, 1600, 900, 100)).toEqual({ cx: 1000, cy: 500, zoom: 1 })
  })

  it('slides the least distance that brings the point inside the padded view', () => {
    // At zoom 0.5 the padded half-view is (800 - 100) / 0.5 = 1400 wide and (450 - 100) / 0.5 = 700 tall
    const pose = keepInView({ cx: 0, cy: 0, zoom: 0.5 }, 5000, -2000, 1600, 900, 100)
    expect(pose).toEqual({ cx: 3600, cy: -1300, zoom: 0.5 })
  })
})
