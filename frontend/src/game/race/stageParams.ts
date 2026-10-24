import { Archetype, archetypeForSeed, parseArchetype } from './archetype'
import { clampDifficulty } from './difficulty'

export const DEFAULT_DIFFICULTY = 4

export interface StageParams {
  seed: number
  difficulty: number
  /** Only when asked for with `?arch=`; otherwise the seed's (see `stageArchetype`). */
  archetype?: Archetype
}

/** The archetype a solo stage is built with: the asked-for one, else the seed's. */
export const stageArchetype = (params: StageParams): Archetype => params.archetype ?? archetypeForSeed(params.seed)

/** A fresh seed for a new solo stage (not part of generation, so Math.random is fine here). */
export const randomSeed = (): number => 1 + Math.floor(Math.random() * 0x7ffffffe)

/** Reads `?seed=`, `?diff=` and `?arch=`; a missing or bad seed gets a random one, a bad arch none. */
export const parseStageParams = (search: string, newSeed: () => number = randomSeed): StageParams => {
  const params = new URLSearchParams(search)
  const seedText = params.get('seed')
  const seed = seedText !== null && /^\d+$/.test(seedText) ? Number(seedText) >>> 0 : newSeed()
  const diffText = params.get('diff')
  const difficulty = diffText !== null && diffText !== '' ? clampDifficulty(Number(diffText)) : DEFAULT_DIFFICULTY
  const archetype = parseArchetype(params.get('arch'))
  return archetype ? { seed, difficulty, archetype } : { seed, difficulty }
}

/** The query string with seed and diff replaced (and arch, when given), other parameters kept. */
export const withStageParams = (search: string, stage: StageParams): string => {
  const params = new URLSearchParams(search)
  params.set('seed', String(stage.seed))
  params.set('diff', String(stage.difficulty))
  if (stage.archetype) params.set('arch', stage.archetype)
  return `?${params.toString()}`
}
