import { describe, expect, it } from 'vitest'
import { checkStage, generateStage } from './generateStage'
import { OPEN, SOLID } from './grid'
import { MAX_BAYS } from './segments'
import type { RaceStage, Rect, Stage } from './stage'
import { ORB_RADIUS } from './tuning'

export const SEEDS = 500
const TUNNEL_MIN_PX = 150
const TUNNEL_MAX_PX = 400

/** FNV-1a over every number in the stage (grid cells included), as a compact snapshot. */
export const hashStage = (stage: Stage): string => {
  let h = 0x811c9dc5
  const mix = (n: number) => {
    h ^= n | 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const { grid, solids, pads, edges, ...rest } = stage
  for (const r of [...solids, ...pads]) {
    mix(r.x)
    mix(r.y)
    mix(r.w)
    mix(r.h)
  }
  for (const e of edges) {
    mix(e.x0)
    mix(e.y0)
    mix(e.x1)
    mix(e.y1)
    mix(e.pad ? 1 : 0)
  }
  for (let i = 0; i < grid.cells.length; i++) mix(grid.cells[i])
  const text = JSON.stringify(rest)
  for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i))
  return h.toString(16)
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const inside = (r: Rect, b: Rect) =>
  r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h

const isInt = (n: number) => Number.isInteger(n)

/** Bay count the sweep uses for a seed: every count from 1 to 8 comes round in turn. */
export const sweepBays = (seed: number) => 1 + (seed % MAX_BAYS)

/**
 * Whether the start bays are laid out as specified: one spawn per bay, each bay a closed box
 * (back wall, floor, ceiling) whose only opening is on the right, where its gate sits across open
 * cells, and the opening leads into open space. Returns why not, or undefined.
 */
export const checkBays = (s: RaceStage, bays: number): string | undefined => {
  if (s.bays.length !== bays || s.startSlots.length !== bays) return `${s.bays.length} bays, wanted ${bays}`
  const g = s.grid
  const cellOf = (x: number, y: number) => {
    const col = Math.floor(x / s.cell)
    const row = Math.floor(y / s.cell)
    return g.cells[(row - g.row0) * g.cols + (col - g.col0)]
  }
  for (let i = 0; i < s.bays.length; i++) {
    const { spawn, gate } = s.bays[i]
    if (spawn.x !== s.startSlots[i].x || spawn.y !== s.startSlots[i].y) return `bay ${i} spawn is not slot ${i}`
    if (![gate.x, gate.y, gate.w, gate.h].every(isInt)) return `bay ${i} gate not integer`
    if (spawn.x >= gate.x) return `bay ${i} spawn outside its gate`
    if (spawn.y < gate.y || spawn.y > gate.y + gate.h) return `bay ${i} spawn not level with its gate`
    if (i > 0 && s.bays[i - 1].gate.y < gate.y + gate.h) return `bay ${i} not stacked above bay ${i - 1}`
    const c = s.cell / 2
    for (let y = gate.y + c; y < gate.y + gate.h; y += s.cell) {
      if (cellOf(gate.x + gate.w / 2, y) !== OPEN) return `bay ${i} gate across rock`
      if (cellOf(gate.x + gate.w + c, y) !== OPEN) return `bay ${i} opening is blocked`
      if (cellOf(-c, y) !== SOLID) return `bay ${i} has no back wall`
    }
    for (let x = c; x < gate.x + gate.w; x += s.cell) {
      if (cellOf(x, gate.y - c) !== SOLID) return `bay ${i} has no ceiling`
      if (cellOf(x, gate.y + gate.h + c) !== SOLID) return `bay ${i} has no floor`
    }
  }
  return undefined
}

/**
 * The generator property sweep: SEEDS seeds at the given difficulties, with the bay count cycling
 * through 1–8 by seed. Split across several test files (two difficulties each) so vitest runs the
 * slices in parallel workers.
 */
export const defineSweep = (difficulties: ReadonlyArray<number>) => {
  /** Every seed × difficulty, generated once and shared by the property checks below. */
  const stages: Array<RaceStage> = []
  for (const d of difficulties) {
    for (let seed = 1; seed <= SEEDS; seed++) stages.push(generateStage(seed * 2654435761, d, sweepBays(seed)))
  }

  const failures = (check: (s: RaceStage) => string | undefined) =>
    stages.flatMap((s) => {
      const why = check(s)
      return why ? [`seed ${s.seed} diff ${s.difficulty} bays ${s.bays.length}: ${why}`] : []
    })

  describe(`generateStage sweep, difficulty ${difficulties.join(', ')}`, { timeout: 120000 }, () => {
    it('is deterministic', () => {
      const bad = failures((s) =>
        hashStage(generateStage(s.seed, s.difficulty, s.bays.length)) === hashStage(s) ? undefined : 'differs',
      )
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('uses integer coordinates inside the stage bounds', () => {
      const bad = failures((s) => {
        const b = s.bounds
        if (![b.x, b.y, b.w, b.h, s.finish.x, s.finish.top, s.finish.bottom, s.seaY].every(isInt)) return 'non-integer bounds'
        for (const e of [...s.solids, ...s.pads]) {
          if (![e.x, e.y, e.w, e.h].every(isInt)) return 'non-integer element'
          if (e.w <= 0 || e.h <= 0) return 'empty element'
          if (!inside(e, b)) return 'element outside bounds'
        }
        for (const e of s.edges) if (![e.x0, e.y0, e.x1, e.y1].every(isInt)) return 'non-integer edge'
        for (const seg of s.segments) {
          for (const p of seg.spine) if (!isInt(p.x) || !isInt(p.y)) return `non-integer spine in ${seg.type}`
        }
        for (const p of s.startSlots) if (!isInt(p.x) || !isInt(p.y)) return 'non-integer slot'
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('has no overlapping solids or pads', () => {
      const bad = failures((s) => {
        const all = [...s.solids, ...s.pads].sort((a, b) => a.x - b.x)
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length && all[j].x < all[i].x + all[i].w; j++) {
            if (overlaps(all[i], all[j])) return `overlap ${JSON.stringify(all[i])} ${JSON.stringify(all[j])}`
          }
        }
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('keeps every tunnel interior between 150 and 400 px tall', () => {
      const bad = failures((s) => {
        for (const seg of s.segments) {
          for (const t of seg.tunnels) {
            if (t.h < TUNNEL_MIN_PX || t.h > TUNNEL_MAX_PX) return `${seg.type} tunnel ${t.h}px`
          }
        }
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('is mostly enclosed: open space is tunnels and chambers, with rock all around', () => {
      // Open cells above the sea that are not carved are the air under the tunnels; nothing open
      // lies above any tunnel
      const bad = failures((s) => {
        const g = s.grid
        for (let ci = 0; ci < g.cols; ci++) {
          let seenRock = false
          let lastOpen = -1
          for (let ri = 0; ri < -g.row0; ri++) {
            const open = g.cells[ri * g.cols + ci] === 0
            if (!open) seenRock = true
            if (open) lastOpen = ri
          }
          if (!seenRock && lastOpen >= 0) return `column ${ci + g.col0} has no rock`
          if (g.cells[ci] === 0) return `open cell on the top row at column ${ci + g.col0}`
        }
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('has a par time between 50 and 65 seconds', () => {
      const bad = failures((s) => (s.parMs >= 50000 && s.parMs <= 65000 ? undefined : `par ${s.parMs}`))
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('covers every bay count from 1 to 8', () => {
      expect([...new Set(stages.map((s) => s.bays.length))].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })

    it('lays out one closed start bay per player, gate across its opening', () => {
      const bad = failures((s) => checkBays(s, s.bays.length))
      expect(bad.slice(0, 5)).toEqual([])
    })

    it('is traversable from every bay, and from the sea whenever the sea can be reached', () => {
      let withPits = 0
      const bad = failures((s) => {
        const reach = checkStage(s)
        if (!reach.startToFinish) return `finish unreachable from bays ${reach.stuckStarts.join(', ')}`
        const pits = s.segments.some((seg) => seg.pits.length > 0)
        if (pits) {
          withPits++
          if (!reach.seaReachableFromStart) return 'pit does not lead to the sea'
        }
        if (reach.seaReachableFromStart && !reach.seaToFinish) return 'softlock: the sea cannot reach the finish'
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
      expect(withPits).toBeGreaterThan(100)
    })

    it('puts every stall-chamber launch apex inside its tunnel mouth', () => {
      let slots = 0
      const bad = failures((s) => {
        for (const seg of s.segments) {
          if (!seg.slot) continue
          slots++
          const { top, bottom, apexY } = seg.slot
          const centre = (top + bottom) / 2
          if (apexY - ORB_RADIUS < top || apexY + ORB_RADIUS > bottom) return 'apex orb clips the mouth'
          if (Math.abs(apexY - centre) > (bottom - top) / 4 + 1) return 'apex off centre'
        }
        return undefined
      })
      expect(bad.slice(0, 5)).toEqual([])
      expect(slots).toBeGreaterThan(100)
    })

    it('uses every slice 1 segment type', () => {
      const types = new Set(stages.flatMap((s) => s.segments.map((seg) => seg.type)))
      expect([...types].sort()).toEqual(['finish', 'run', 'shaftDown', 'shaftUp', 'stallChamber', 'start'])
    })
  })
}
