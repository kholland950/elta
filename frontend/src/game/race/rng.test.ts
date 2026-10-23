import { describe, expect, it } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('produces a known sequence for a fixed seed', () => {
    const rng = createRng(42)
    expect([rng.next(), rng.next(), rng.next()]).toEqual([2581720956, 1925393290, 3661312704])
  })

  it('is reproducible and seed dependent', () => {
    const a = createRng(7)
    const b = createRng(7)
    const c = createRng(8)
    const seqA = Array.from({ length: 20 }, () => a.next())
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA)
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA)
  })

  it('keeps int() inside its inclusive range and returns integers', () => {
    const rng = createRng(1)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(-3, 3)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-3)
      expect(v).toBeLessThanOrEqual(3)
      seen.add(v)
    }
    expect(seen.size).toBe(7)
    expect(rng.int(5, 5)).toBe(5)
  })

  it('never picks a zero weight', () => {
    const rng = createRng(3)
    for (let i = 0; i < 500; i++) expect(rng.weighted([0, 2, 0, 1])).not.toBe(0)
  })
})
