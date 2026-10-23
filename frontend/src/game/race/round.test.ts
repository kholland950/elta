import { describe, expect, it } from 'vitest'
import { controlsLocked, finishCrossing, formatRaceTime, localPlan, roundPhaseAt } from './round'

describe('roundPhaseAt', () => {
  const plan = { exploreAt: 1000, snapAt: 16000, goAt: 19500 }

  it('walks through every phase at its boundary', () => {
    expect(roundPhaseAt(plan, 999)).toEqual({ kind: 'waiting' })
    expect(roundPhaseAt(plan, 1000)).toEqual({ kind: 'explore' })
    expect(roundPhaseAt(plan, 15999)).toEqual({ kind: 'explore' })
    expect(roundPhaseAt(plan, 16000)).toEqual({ kind: 'snap' })
    expect(roundPhaseAt(plan, 16499)).toEqual({ kind: 'snap' })
    expect(roundPhaseAt(plan, 16500)).toEqual({ kind: 'countdown', digit: 3 })
    expect(roundPhaseAt(plan, 17499)).toEqual({ kind: 'countdown', digit: 3 })
    expect(roundPhaseAt(plan, 17500)).toEqual({ kind: 'countdown', digit: 2 })
    expect(roundPhaseAt(plan, 18500)).toEqual({ kind: 'countdown', digit: 1 })
    expect(roundPhaseAt(plan, 19499)).toEqual({ kind: 'countdown', digit: 1 })
    expect(roundPhaseAt(plan, 19500)).toEqual({ kind: 'race' })
  })

  it('goes straight to the countdown in a local solo plan', () => {
    const solo = localPlan(0)
    expect(roundPhaseAt(solo, 0)).toEqual({ kind: 'countdown', digit: 3 })
    expect(roundPhaseAt(solo, 2999)).toEqual({ kind: 'countdown', digit: 1 })
    expect(roundPhaseAt(solo, 3000)).toEqual({ kind: 'race' })
  })

  it('locks controls during the snap and countdown only', () => {
    expect(controlsLocked({ kind: 'explore' })).toBe(false)
    expect(controlsLocked({ kind: 'snap' })).toBe(true)
    expect(controlsLocked({ kind: 'countdown', digit: 2 })).toBe(true)
    expect(controlsLocked({ kind: 'race' })).toBe(false)
  })
})

describe('finishCrossing', () => {
  const gate = { x: 1000, top: -400, bottom: 0 }
  const stepMs = 10

  it('interpolates where on the step the line was crossed', () => {
    expect(finishCrossing({ x: 990, y: -50 }, { x: 1010, y: -50 }, gate, 100, stepMs)).toBe(995)
    expect(finishCrossing({ x: 1000 - 15, y: -50 }, { x: 1005, y: -50 }, gate, 1, stepMs)).toBe(7.5)
  })

  it('counts landing exactly on the line as crossing at the end of the step', () => {
    expect(finishCrossing({ x: 980, y: -50 }, { x: 1000, y: -50 }, gate, 10, stepMs)).toBe(100)
  })

  it('ignores steps that do not enter the region', () => {
    expect(finishCrossing({ x: 900, y: -50 }, { x: 950, y: -50 }, gate, 10, stepMs)).toBeUndefined()
    expect(finishCrossing({ x: 1010, y: -50 }, { x: 1020, y: -50 }, gate, 10, stepMs)).toBeUndefined()
    // Outside the finish chamber's rows does not count
    expect(finishCrossing({ x: 990, y: 40 }, { x: 1010, y: 40 }, gate, 10, stepMs)).toBeUndefined()
    expect(finishCrossing({ x: 990, y: -450 }, { x: 1010, y: -450 }, gate, 10, stepMs)).toBeUndefined()
  })

  it('finishes when entering past the line from below or above', () => {
    expect(finishCrossing({ x: 1100, y: 20 }, { x: 1100, y: -20 }, gate, 10, stepMs)).toBe(95)
    expect(finishCrossing({ x: 1100, y: -420 }, { x: 1100, y: -380 }, gate, 10, stepMs)).toBe(95)
  })

  it('uses the later boundary when crossing both at once', () => {
    // Crosses x at t=0.5 and the sea surface at t=0.75
    expect(finishCrossing({ x: 990, y: 30 }, { x: 1010, y: -10 }, gate, 10, stepMs)).toBe(97.5)
  })
})

describe('formatRaceTime', () => {
  it('formats as m:ss.mmm', () => {
    expect(formatRaceTime(0)).toBe('0:00.000')
    expect(formatRaceTime(54321.9)).toBe('0:54.321')
    expect(formatRaceTime(61005)).toBe('1:01.005')
  })
})
