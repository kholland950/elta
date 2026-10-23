/**
 * Seeded PRNG for stage generation. mulberry32 uses only 32-bit integer operations, so every JS
 * engine produces the same sequence for a seed. All helpers return integers.
 */
export interface Rng {
  /** Next raw unsigned 32-bit value. */
  next(): number
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  /** Index picked in proportion to the integer `weights` (zero weights are never picked). */
  weighted(weights: ReadonlyArray<number>): number
}

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  const int = (min: number, max: number) => {
    if (max <= min) return min
    return min + (next() % (max - min + 1))
  }
  const weighted = (weights: ReadonlyArray<number>) => {
    let total = 0
    weights.forEach((w) => (total += w))
    if (total <= 0) return 0
    let roll = next() % total
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) return i
      roll -= weights[i]
    }
    return weights.length - 1
  }
  return { next, int, weighted }
}
