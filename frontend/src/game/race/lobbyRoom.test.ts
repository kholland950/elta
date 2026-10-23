import { describe, expect, it } from 'vitest'
import { reachOptions } from './generateStage'
import { cellIndex, OPEN, PAD, SOLID } from './grid'
import { LOBBY_MAP, LOBBY_SPAWNS, lobbyGrid, lobbyRoom } from './lobbyRoom'
import { reachFrom } from './reach'
import { CELL } from './segments'
import { hashStage } from './stageSweep'
import type { Rect } from './stage'

const room = lobbyRoom()
const g = room.grid
/** Open cells above the sea: the room. */
const roomCells: Array<number> = []
for (let row = g.row0; row < 0; row++) {
  for (let col = g.col0; col < g.col0 + g.cols; col++) {
    if (g.cells[cellIndex(g, col, row)] === OPEN) roomCells.push(cellIndex(g, col, row))
  }
}
const spawnCell = (p: { x: number; y: number }) => cellIndex(g, Math.floor(p.x / CELL), Math.floor(p.y / CELL))

describe('the lobby room', () => {
  it('is about two screens wide and one tall', () => {
    expect(room.kind).toBe('lobby')
    expect(room.bounds.w).toBe(3600)
    const interior = room.segments[0].bounds
    expect(interior.w).toBe(3500)
    expect(interior.h).toBe(850)
    expect(room.seaY).toBe(0)
    expect(room.bounds.y + room.bounds.h).toBeGreaterThan(0)
  })

  it('has no finish, no start bays and nothing to time', () => {
    expect(room.finish).toBeUndefined()
    expect(room.bays).toEqual([])
    expect(room.parMs).toBe(0)
  })

  it('is enclosed: no open cell of the room touches the grid edge or leads into the sea', () => {
    for (let row = g.row0; row < 0; row++) {
      for (const col of [g.col0, g.col0 + g.cols - 1]) expect(g.cells[cellIndex(g, col, row)]).not.toBe(OPEN)
    }
    for (let col = g.col0; col < g.col0 + g.cols; col++) {
      expect(g.cells[cellIndex(g, col, g.row0)]).toBe(SOLID)
      // The row on the sea surface is all floor (rock or pad)
      expect(g.cells[cellIndex(g, col, -1)]).not.toBe(OPEN)
    }
    // Flood fill from a spawn over open cells: it never reaches the sea rows
    const seen = new Uint8Array(g.cells.length)
    const stack = [spawnCell(room.startSlots[0])]
    let reachedSea = false
    while (stack.length > 0) {
      const k = stack.pop()!
      if (seen[k] || g.cells[k] !== OPEN) continue
      seen[k] = 1
      const row = Math.floor(k / g.cols) + g.row0
      const ci = k % g.cols
      if (row >= 0) reachedSea = true
      if (ci > 0) stack.push(k - 1)
      if (ci < g.cols - 1) stack.push(k + 1)
      if (k >= g.cols) stack.push(k - g.cols)
      if (k + g.cols < g.cells.length) stack.push(k + g.cols)
    }
    expect(reachedSea).toBe(false)
  })

  it('is passable: every open cell of the room can be reached from every spawn', () => {
    for (const spawn of room.startSlots) {
      const reach = reachFrom(g, [spawnCell(spawn)], reachOptions)
      const missed = roomCells.filter((k) => reach[k] < 0)
      expect(missed.length).toBe(0)
    }
  })

  it('has a floor, platforms, walls to bounce between and a bounce pad', () => {
    expect(room.pads.length).toBeGreaterThan(0)
    // Floating platforms: solids with open cells above and below them
    const floating = room.solids.filter((s) => s.y > g.row0 * CELL + CELL && s.y + s.h < -CELL && s.w >= 4 * CELL && s.h === CELL)
    expect(floating.length).toBeGreaterThanOrEqual(3)
    // A chimney: a column of open cells with rock on both sides, at least 8 cells tall
    let chimneys = 0
    for (let col = g.col0 + 1; col < g.col0 + g.cols - 1; col++) {
      let run = 0
      for (let row = g.row0; row < 0; row++) {
        const walled = (c: number) => g.cells[cellIndex(g, c, row)] !== OPEN
        const inShaft = (c: number) => {
          let l = c
          while (g.cells[cellIndex(g, l, row)] === OPEN) l--
          let r = c
          while (g.cells[cellIndex(g, r, row)] === OPEN) r++
          return r - l - 1 <= 3 && walled(l) && walled(r)
        }
        run = g.cells[cellIndex(g, col, row)] === OPEN && inShaft(col) ? run + 1 : 0
        if (run === 8) chimneys++
      }
    }
    expect(chimneys).toBeGreaterThanOrEqual(2)
  })

  it('spreads its spawns over the floor in join order', () => {
    expect(room.startSlots.length).toBe(LOBBY_SPAWNS)
    for (const s of room.startSlots) {
      const col = Math.floor(s.x / CELL)
      const row = Math.floor(s.y / CELL)
      expect(g.cells[cellIndex(g, col, row)]).toBe(OPEN)
      expect(g.cells[cellIndex(g, col, row + 1)]).toBe(SOLID)
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true)
    }
    for (let i = 0; i < room.startSlots.length; i++) {
      for (let j = i + 1; j < room.startSlots.length; j++) {
        expect(Math.abs(room.startSlots[i].x - room.startSlots[j].x)).toBeGreaterThanOrEqual(200)
      }
    }
  })

  it('merges into rectangles that do not overlap', () => {
    const all: Array<Rect> = [...room.solids, ...room.pads]
    const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false)
    }
    expect(g.cells.filter((c) => c === PAD).length).toBe(2)
  })

  it('is the same room every time', () => {
    expect(hashStage(lobbyRoom())).toBe(hashStage(room))
  })

  it('rejects a ragged map', () => {
    expect(() => lobbyGrid([...LOBBY_MAP.slice(0, 3), '#..#'])).toThrow(/wide/)
  })
})
