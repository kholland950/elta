import { describe, expect, it } from 'vitest'
import { DEFAULT_DIFFICULTY, parseStageParams, withStageParams } from './stageParams'

describe('parseStageParams', () => {
  it('reads seed and difficulty', () => {
    expect(parseStageParams('?seed=123&diff=7', () => 9)).toEqual({ seed: 123, difficulty: 7 })
  })

  it('falls back to a new seed and the default difficulty', () => {
    expect(parseStageParams('', () => 9)).toEqual({ seed: 9, difficulty: DEFAULT_DIFFICULTY })
    expect(parseStageParams('?seed=abc&diff=', () => 5)).toEqual({ seed: 5, difficulty: DEFAULT_DIFFICULTY })
  })

  it('clamps difficulty to 1–10', () => {
    expect(parseStageParams('?seed=1&diff=99').difficulty).toBe(10)
    expect(parseStageParams('?seed=1&diff=0').difficulty).toBe(1)
    expect(parseStageParams('?seed=1&diff=x').difficulty).toBe(1)
  })

  it('writes the params back keeping others', () => {
    expect(withStageParams('?perf&seed=1', { seed: 42, difficulty: 3 })).toBe('?perf=&seed=42&diff=3')
  })
})
