import { describe, expect, it } from 'vitest'
import { move, type MenuGrid } from './menuNav'

// Resume / High | Low / Key bindings / Leave room
const grid: MenuGrid = [1, 2, 1, 1]

describe('move', () => {
  it('moves down and up between rows', () => {
    expect(move(grid, { row: 0, col: 0 }, 'down')).toEqual({ row: 1, col: 0 })
    expect(move(grid, { row: 2, col: 0 }, 'up')).toEqual({ row: 1, col: 0 })
  })

  it('wraps vertically at both ends', () => {
    expect(move(grid, { row: 0, col: 0 }, 'up')).toEqual({ row: 3, col: 0 })
    expect(move(grid, { row: 3, col: 0 }, 'down')).toEqual({ row: 0, col: 0 })
  })

  it('clamps the column to a narrower row', () => {
    expect(move(grid, { row: 1, col: 1 }, 'down')).toEqual({ row: 2, col: 0 })
    expect(move(grid, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 0 })
  })

  it('moves within a row and stops at its ends', () => {
    expect(move(grid, { row: 1, col: 0 }, 'right')).toEqual({ row: 1, col: 1 })
    expect(move(grid, { row: 1, col: 1 }, 'right')).toEqual({ row: 1, col: 1 })
    expect(move(grid, { row: 1, col: 1 }, 'left')).toEqual({ row: 1, col: 0 })
    expect(move(grid, { row: 1, col: 0 }, 'left')).toEqual({ row: 1, col: 0 })
    expect(move(grid, { row: 0, col: 0 }, 'right')).toEqual({ row: 0, col: 0 })
  })

  it('walks every item in reading order with next/prev, wrapping', () => {
    const order = [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 0 },
      { row: 3, col: 0 },
    ]
    order.forEach((sel, i) => {
      expect(move(grid, sel, 'next')).toEqual(order[(i + 1) % order.length])
      expect(move(grid, order[(i + 1) % order.length], 'prev')).toEqual(sel)
    })
  })

  it('leaves the selection alone for confirm and back', () => {
    const sel = { row: 1, col: 1 }
    expect(move(grid, sel, 'confirm')).toBe(sel)
    expect(move(grid, sel, 'back')).toBe(sel)
  })
})
