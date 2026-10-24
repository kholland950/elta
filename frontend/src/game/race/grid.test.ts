import { describe, expect, it } from 'vitest'
import { generateStagePlan } from './generateStage'
import { buildGrid, cellAt, OPEN, SOLID } from './grid'
import { ARCHETYPES } from './archetype'

describe('buildGrid', () => {
  it('opens a pit carve down to the sea, with rock either side', () => {
    const g = buildGrid({
      col0: 0,
      col1: 10,
      row0: -12,
      seaRows: 2,
      carves: [
        { c0: 1, r0: -10, c1: 9, r1: -6 },
        { c0: 4, r0: -6, c1: 6, r1: 0 },
      ],
      pads: [],
    })
    for (let row = -6; row < 2; row++) {
      expect(cellAt(g, 4, row)).toBe(OPEN)
      expect(cellAt(g, 5, row)).toBe(OPEN)
    }
    // The chamber floor beside the pit stays a shell row of rock
    expect(cellAt(g, 3, -6)).toBe(SOLID)
    expect(cellAt(g, 6, -6)).toBe(SOLID)
  })

  it('puts rock between stacked tunnels', () => {
    const g = buildGrid({
      col0: 0,
      col1: 10,
      row0: -20,
      seaRows: 2,
      carves: [
        { c0: 0, r0: -8, c1: 10, r1: -4, owner: 1 },
        { c0: 0, r0: -16, c1: 10, r1: -12, owner: 2 },
      ],
      pads: [],
    })
    for (let col = 0; col < 10; col++) {
      for (let row = -12; row < -8; row++) expect(cellAt(g, col, row)).toBe(SOLID)
    }
  })

  it('puts a curtain where the owner of the lowest carve changes', () => {
    const g = buildGrid({
      col0: 0,
      col1: 12,
      row0: -12,
      seaRows: 2,
      carves: [
        { c0: 0, r0: -10, c1: 4, r1: -6, owner: 0 },
        { c0: 4, r0: -10, c1: 8, r1: -6, owner: 1 },
        // Owner 1 also above at 8–12, but owner 2 is lowest there
        { c0: 8, r0: -11, c1: 12, r1: -9, owner: 1 },
        { c0: 8, r0: -7, c1: 12, r1: -5, owner: 2 },
      ],
      pads: [],
    })
    const curtain = (col: number) => cellAt(g, col, -1) === SOLID
    expect([...Array(12).keys()].filter(curtain)).toEqual([4, 8])
  })

  // The ownership rule must give exactly the old curtains (every segment's entry column) on a
  // stage whose segments all run left to right
  it('gives the old curtain columns on generated left-to-right stages', () => {
    const bad: Array<string> = []
    for (let seed = 1; seed <= 40; seed++) {
      const { plans } = generateStagePlan(seed * 7919, 1 + (seed % 10), 1 + (seed % 8), ARCHETYPES[seed % 5])
      if (plans.some((p) => p.entry.dir !== 'E' || p.exit.dir !== 'E')) continue
      const entries = new Set(plans.slice(1).map((p) => (p.entry.dir === 'E' ? p.entry.x : NaN)))
      let c1 = 0
      for (const p of plans) for (const r of p.carves) c1 = Math.max(c1, r.c1)
      const carves = plans.flatMap((p, owner) => [...p.carves, ...p.pits].map((r) => ({ ...r, owner })))
      const g = buildGrid({ col0: -1, col1: c1 + 1, row0: -130, seaRows: 2, carves, pads: [] })
      for (let col = 0; col < c1; col++) {
        let lowest = -Infinity
        for (const r of carves) if (r.c0 <= col && col < r.c1) lowest = Math.max(lowest, r.r1 - 1)
        // Only columns with air under their shell can show a curtain
        if (lowest === -Infinity || lowest + 1 >= -1) continue
        if ((cellAt(g, col, -1) === SOLID) !== entries.has(col)) bad.push(`seed ${seed} col ${col}`)
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
})
