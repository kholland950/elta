import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from './archetype'
import { difficultyKnobs } from './difficulty'
import { checkStage, generateStage, planPassable } from './generateStage'
import { createRng } from './rng'
import { BUILDABLE_TYPES, CELL, clampBays, HPort, MAX_BAYS, mirrorPlan, planSegment, planShaftUp, planSwitchback } from './segments'
import { checkBays, hashStage } from './stageSweep'

const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('generateStage', () => {
  // Snapshot history (docs/plans/route-variety.md, Implementation notes): route variety slices 1
  // and 2 changed only fields; slice 3 changed stages on purpose (archetype profiles, the enforced
  // placement check, ceilings and backtracking); slice 4 on purpose (switchbacks, mirrored leftward
  // segments, the agenda, the finish approach); slice 5 on purpose (vertical ports, chimneys,
  // chambers, Descent and Canyon profiles); slice 6 on purpose (fork beats, drawn from the stream
  // even on Speedway)
  it('matches one hash snapshot per archetype', () => {
    expect(ARCHETYPES.map((a, i) => `${a} ${hashStage(generateStage(1 + i * 1000, 1 + i * 2, 1 + i, a))}`))
      .toMatchInlineSnapshot(`
        [
          "tower 13c6ef90",
          "descent b81ab6be",
          "labyrinth ace0d02b",
          "speedway 1c0a0cb8",
          "canyon e8fc3a32",
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
  // passes, and so does each template on its own, entering from either side
  it('are passable on their own across seeds, difficulties and entry directions', () => {
    const bad: Array<string> = []
    for (const dir of ['E', 'W'] as const) {
      const entry = { dir, x: 0, top: -30, bottom: -25 }
      for (const d of DIFFICULTIES) {
        const knobs = difficultyKnobs(d)
        const rng = createRng(d * 97)
        for (let i = 0; i < 100; i++) {
          for (const type of BUILDABLE_TYPES) {
            const p = planSegment(type, { rng, entry, knobs })
            if (p && !planPassable(p)) bad.push(`${p.type} ${dir} d${d} #${i}`)
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('take vertical entries (chimney, chamber) and are passable up and down, turning either way', () => {
    const bad: Array<string> = []
    let built = 0
    for (const dir of ['N', 'S'] as const) {
      for (const turn of ['E', 'W'] as const) {
        const entry = { dir, y: -30, left: 40, right: 43 }
        for (const d of DIFFICULTIES) {
          const knobs = difficultyKnobs(d)
          const rng = createRng(d * 31)
          for (let i = 0; i < 40; i++) {
            for (const type of BUILDABLE_TYPES) {
              const p = planSegment(type, { rng, entry, knobs, turn })
              if (!p) continue
              built++
              if (!['chimney', 'chamber'].includes(p.type)) bad.push(`${p.type} took a ${dir} entry`)
              if (p.exit.dir !== turn) bad.push(`${p.type} ${dir} turned ${p.exit.dir}`)
              if (!planPassable(p)) bad.push(`${p.type} ${dir}→${turn} d${d} #${i}`)
            }
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
    expect(built).toBeGreaterThan(1000)
  })

  it('forks: each branch passable on its own, the high one above the low one over 2+ rows of rock', () => {
    const bad: Array<string> = []
    for (const d of DIFFICULTIES) {
      const rng = createRng(d * 13)
      for (let i = 0; i < 30; i++) {
        for (const dir of ['E', 'W'] as const) {
          const p = planSegment('fork', { rng, entry: { dir, x: 50, top: -30, bottom: -25 }, knobs: difficultyKnobs(d) })!
          const { high, low } = p.branches!
          if (!planPassable(p, high)) bad.push(`low alone d${d} ${dir}`)
          if (!planPassable(p, low)) bad.push(`high alone d${d} ${dir}`)
          const lowTop = Math.min(...low.map((r) => r.r0))
          // The drop hole (reaching down to the low branch) aside
          const highTunnelFloor = Math.max(...high.filter((r) => r.r1 < lowTop).map((r) => r.r1))
          if (lowTop - highTunnelFloor < 2) bad.push(`island ${lowTop - highTunnelFloor} rows d${d}`)
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('shafts can leave through their end: up through the top, down through the bottom', () => {
    const knobs = difficultyKnobs(4)
    const rng = createRng(9)
    const entry = { dir: 'E' as const, x: 0, top: -30, bottom: -25 }
    const up = planSegment('shaftUp', { rng, entry, knobs, endPort: true })!
    const down = planSegment('shaftDown', { rng, entry, knobs, endPort: true })!
    expect([up.exit.dir, down.exit.dir]).toEqual(['N', 'S'])
    expect(planPassable(up) && planPassable(down)).toBe(true)
  })

  it('mirror a leftward plan exactly onto the rightward plan reflected about the entry', () => {
    for (const type of BUILDABLE_TYPES) {
      for (let seed = 1; seed <= 20; seed++) {
        const knobs = difficultyKnobs(1 + (seed % 10))
        const east = planSegment(type, { rng: createRng(seed), entry: { dir: 'E', x: 40, top: -30, bottom: -25 }, knobs })
        const west = planSegment(type, { rng: createRng(seed), entry: { dir: 'W', x: 40, top: -30, bottom: -25 }, knobs })
        expect(west).toEqual(east && mirrorPlan(east, 40))
        if (west) {
          expect(west.entry.dir).toBe('W')
          expect(west.exit.dir).toBe(type === 'switchback' ? 'E' : 'W')
        } else {
          expect(east).toBeUndefined()
        }
      }
    }
  })

  it('switchbacks stack the return on the far side of 2+ rows of rock', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) {
      const p = planSwitchback({ rng, entry: { dir: 'E', x: 0, top: -30, bottom: -25 }, knobs: difficultyKnobs(5) })!
      const exit = p.exit as HPort
      expect(exit.dir).toBe('W')
      expect(exit.bottom <= -32 || exit.top >= -23).toBe(true)
    }
  })

  it('climb shafts taller than the open-air flap budget', () => {
    const knobs = difficultyKnobs(10)
    const rng = createRng(5)
    let tall = 0
    for (let i = 0; i < 100; i++) {
      const p = planShaftUp({ rng, entry: { dir: 'E', x: 0, top: -20, bottom: -15 }, knobs })
      if (p && ((p.entry as HPort).bottom - (p.exit as HPort).bottom) * CELL > 500) tall++
    }
    expect(tall).toBeGreaterThan(10)
  })
})
