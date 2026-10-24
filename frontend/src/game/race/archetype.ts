/**
 * Stage archetypes: each shapes a whole stage's route and segment mix. The server picks one per
 * round (no back-to-back repeats); solo play and stale messages fall back to the seed.
 * See docs/plans/route-variety.md and contract §6.
 */
export type Archetype = 'tower' | 'descent' | 'labyrinth' | 'speedway' | 'canyon'

export const ARCHETYPES: readonly Archetype[] = ['tower', 'descent', 'labyrinth', 'speedway', 'canyon']

export const archetypeForSeed = (seed: number): Archetype => ARCHETYPES[(seed >>> 0) % ARCHETYPES.length]

export const parseArchetype = (s: unknown): Archetype | undefined =>
  typeof s === 'string' && (ARCHETYPES as readonly string[]).includes(s) ? (s as Archetype) : undefined
