import { describe, expect, it } from 'vitest'
import { difficultyKnobs } from './difficulty'
import { checkStage, generateStage, planPassable } from './generateStage'
import { createRng } from './rng'
import { CELL, clampBays, MAX_BAYS, planRun, planShaftDown, planShaftUp, planStallChamber } from './segments'
import { checkBays, hashStage } from './stageSweep'

const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('generateStage', () => {
  // Updated on purpose for the gate-bay start (slice 2 review): the start room, the stage's
  // `kind`/`bays` fields and, for 3+ bays, the start mouth height all changed
  it('matches hash snapshots for three seeds', () => {
    expect([generateStage(1, 1, 1), generateStage(42, 4, 2), generateStage(9001, 10, 8)].map(hashStage))
      .toMatchInlineSnapshot(`
        [
          "55dd9412",
          "278be7d4",
          "73a6b10c",
        ]
      `)
  })

  it('clamps the bay count to 1–8', () => {
    expect([0, 1, 3, 8, 9, 20, -2, NaN].map(clampBays)).toEqual([1, 1, 3, 8, 8, 8, 1, 1])
    expect(generateStage(5, 4, 0).bays.length).toBe(1)
    expect(generateStage(5, 4, 12).bays.length).toBe(MAX_BAYS)
  })

  it('builds the same stage for the same seed, difficulty and bays', () => {
    expect(hashStage(generateStage(77, 6, 5))).toBe(hashStage(generateStage(77, 6, 5)))
    expect(hashStage(generateStage(77, 6, 5))).not.toBe(hashStage(generateStage(77, 6, 6)))
  })

  // The sweep files cycle the bay count by seed; this runs every count on the same seeds
  it('is passable from every bay for every bay count', { timeout: 60000 }, () => {
    const bad: Array<string> = []
    for (const d of [1, 4, 7, 10]) {
      for (let seed = 1; seed <= 25; seed++) {
        for (let bays = 1; bays <= MAX_BAYS; bays++) {
          const s = generateStage(seed * 40503, d, bays)
          const why = checkBays(s, bays)
          const reach = checkStage(s)
          if (why) bad.push(`seed ${seed} d${d} bays ${bays}: ${why}`)
          if (!reach.startToFinish) bad.push(`seed ${seed} d${d} bays ${bays}: stuck in ${reach.stuckStarts.join(', ')}`)
          if (reach.seaReachableFromStart && !reach.seaToFinish) bad.push(`seed ${seed} d${d} bays ${bays}: sea softlock`)
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
})

describe('segment templates', () => {
  // Shafts are only climbable because walls recharge: a shaft taller than one flap climb still
  // passes, and so does each template on its own
  it('are passable on their own across seeds and difficulties', () => {
    const entry = { x: 0, top: -20, bottom: -15 }
    const bad: Array<string> = []
    for (const d of DIFFICULTIES) {
      const knobs = difficultyKnobs(d)
      const rng = createRng(d * 97)
      for (let i = 0; i < 200; i++) {
        for (const plan of [planRun, planShaftUp, planShaftDown, planStallChamber]) {
          const p = plan({ rng, entry, knobs })
          if (p && !planPassable(p)) bad.push(`${p.type} d${d} #${i}`)
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('climb shafts taller than the open-air flap budget', () => {
    const knobs = difficultyKnobs(10)
    const rng = createRng(5)
    let tall = 0
    for (let i = 0; i < 100; i++) {
      const p = planShaftUp({ rng, entry: { x: 0, top: -20, bottom: -15 }, knobs })
      if (p && (p.entry.bottom - p.exit.bottom) * CELL > 500) tall++
    }
    expect(tall).toBeGreaterThan(10)
  })
})
