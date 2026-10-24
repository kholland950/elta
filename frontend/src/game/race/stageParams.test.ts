import { describe, expect, it } from 'vitest'
import { DEFAULT_DIFFICULTY, parseStageParams, stageArchetype, withStageParams } from './stageParams'

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

  it("reads ?arch=, ignoring unknown ones; the stage's archetype falls back to the seed's", () => {
    expect(parseStageParams('?seed=5&arch=tower')).toEqual({ seed: 5, difficulty: DEFAULT_DIFFICULTY, archetype: 'tower' })
    expect(parseStageParams('?seed=5&arch=volcano').archetype).toBeUndefined()
    expect(stageArchetype({ seed: 5, difficulty: 4, archetype: 'canyon' })).toBe('canyon')
    // 5 % 5 = 0, 8 % 5 = 3
    expect(stageArchetype({ seed: 5, difficulty: 4 })).toBe('tower')
    expect(stageArchetype({ seed: 8, difficulty: 4 })).toBe('speedway')
  })

  it('keeps ?arch= when writing the params back, and sets it when given', () => {
    expect(withStageParams('?arch=descent&seed=1', { seed: 42, difficulty: 3 })).toBe('?arch=descent&seed=42&diff=3')
    expect(withStageParams('?seed=1', { seed: 42, difficulty: 3, archetype: 'canyon' })).toBe('?seed=42&diff=3&arch=canyon')
  })

  it('writes the params back keeping others', () => {
    expect(withStageParams('?perf&seed=1', { seed: 42, difficulty: 3 })).toBe('?perf=&seed=42&diff=3')
  })
})
