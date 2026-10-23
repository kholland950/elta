import { clampDifficulty } from './difficulty'

export const DEFAULT_DIFFICULTY = 4

export interface StageParams {
  seed: number
  difficulty: number
}

/** A fresh seed for a new solo stage (not part of generation, so Math.random is fine here). */
export const randomSeed = (): number => 1 + Math.floor(Math.random() * 0x7ffffffe)

/** Reads `?seed=` and `?diff=`; a missing or bad seed gets a random one. */
export const parseStageParams = (search: string, newSeed: () => number = randomSeed): StageParams => {
  const params = new URLSearchParams(search)
  const seedText = params.get('seed')
  const seed = seedText !== null && /^\d+$/.test(seedText) ? Number(seedText) >>> 0 : newSeed()
  const diffText = params.get('diff')
  const difficulty = diffText !== null && diffText !== '' ? clampDifficulty(Number(diffText)) : DEFAULT_DIFFICULTY
  return { seed, difficulty }
}

/** The query string with seed and diff replaced, other parameters kept. */
export const withStageParams = (search: string, stage: StageParams): string => {
  const params = new URLSearchParams(search)
  params.set('seed', String(stage.seed))
  params.set('diff', String(stage.difficulty))
  return `?${params.toString()}`
}
