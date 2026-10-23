import { describe, expect, it } from 'vitest'
import { estimateOffset, sampleOffset, sampleRtt } from './clockSync'

describe('clockSync', () => {
  it('returns null without samples', () => {
    expect(estimateOffset([])).toBeNull()
  })

  it('computes the offset assuming a symmetric trip', () => {
    // local 1000..1040, server clock is 5000 ahead: pong stamped at local 1020 -> 6020
    const s = { t0: 1000, t1: 1040, serverTime: 6020 }
    expect(sampleRtt(s)).toBe(40)
    expect(sampleOffset(s)).toBe(5000)
    expect(estimateOffset([s])).toBe(5000)
  })

  it('uses the min-RTT sample', () => {
    const noisy = { t0: 0, t1: 300, serverTime: 5000 + 10 } // asymmetric, wrong
    const clean = { t0: 1000, t1: 1020, serverTime: 6010 }
    expect(estimateOffset([noisy, clean])).toBe(5000)
    expect(estimateOffset([clean, noisy])).toBe(5000)
  })

  it('ignores samples with negative RTT', () => {
    const bad = { t0: 10, t1: 5, serverTime: 0 }
    const ok = { t0: 0, t1: 10, serverTime: 105 }
    expect(estimateOffset([bad, ok])).toBe(100)
    expect(estimateOffset([bad])).toBeNull()
  })
})
