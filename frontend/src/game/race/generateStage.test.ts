import { describe, expect, it } from 'vitest'
import { difficultyKnobs } from './difficulty'
import { generateStage, planPassable } from './generateStage'
import { createRng } from './rng'
import { CELL, planRun, planShaftDown, planShaftUp, planStallChamber } from './segments'
import { hashStage } from './stageSweep'

const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('generateStage', () => {
  it('matches hash snapshots for three seeds', () => {
    expect([generateStage(1, 1), generateStage(42, 4), generateStage(9001, 10)].map(hashStage))
      .toMatchInlineSnapshot(`
        [
          "c1e92478",
          "182878e0",
          "e673bf30",
        ]
      `)
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
