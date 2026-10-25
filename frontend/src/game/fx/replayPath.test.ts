import { describe, expect, it } from 'vitest'
import { headAt, lineWidth, PathHead, replaySpanMs } from './replayPath'

const path = [
  { t: 0, x: 0, y: 0 },
  { t: 100, x: 100, y: 0 },
  { t: 300, x: 100, y: 200 },
]
const head = (): PathHead => ({ x: 0, y: 0, index: 0 })

describe('replaySpanMs', () => {
  it('is the latest end of any path', () => {
    expect(replaySpanMs([path, [{ t: 50, x: 0, y: 0 }], []])).toBe(300)
    expect(replaySpanMs([])).toBe(0)
  })
})

describe('headAt', () => {
  it('sits on the ends outside the path', () => {
    expect(headAt(path, -10, head())).toEqual({ x: 0, y: 0, index: -1 })
    expect(headAt(path, 300, head())).toEqual({ x: 100, y: 200, index: 2 })
    expect(headAt(path, 9999, head())).toEqual({ x: 100, y: 200, index: 2 })
    expect(headAt([], 50, head())).toEqual({ x: 0, y: 0, index: -1 })
  })

  it('interpolates between samples', () => {
    expect(headAt(path, 50, head())).toEqual({ x: 50, y: 0, index: 0 })
    expect(headAt(path, 100, head())).toEqual({ x: 100, y: 0, index: 1 })
    expect(headAt(path, 200, head())).toEqual({ x: 100, y: 100, index: 1 })
  })

  it('only moves forward along the path as time goes on', () => {
    const out = head()
    let lastIndex = -1
    let along = -1
    for (let t = -20; t <= 320; t += 7) {
      headAt(path, t, out)
      expect(out.index).toBeGreaterThanOrEqual(lastIndex)
      // The route goes right then down, so x + y is the distance along it
      expect(out.x + out.y).toBeGreaterThanOrEqual(along)
      along = out.x + out.y
      lastIndex = out.index
    }
  })

  it('writes into the object it is given', () => {
    const out = head()
    expect(headAt(path, 10, out)).toBe(out)
  })
})

describe('lineWidth', () => {
  it('scales with 1 / zoom and makes the winner bolder', () => {
    expect(lineWidth(false, 0.5)).toBeCloseTo(lineWidth(false, 1) * 2)
    expect(lineWidth(true, 1)).toBeGreaterThan(lineWidth(false, 1))
    // Thin: a few screen px, well under an orb
    expect(lineWidth(true, 1)).toBeLessThanOrEqual(3)
  })
})
