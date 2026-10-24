import { describe, expect, it } from 'vitest'
import { generateStage } from '../race/generateStage'
import { cellAt, PAD, SOLID } from '../race/grid'
import { stageThumb, THUMB_COLORS } from './stageThumb'

const stage = generateStage(5, 4, 4)
const px = (t: { w: number; rgba: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * t.w + x) * 4
  return [t.rgba[i], t.rgba[i + 1], t.rgba[i + 2], t.rgba[i + 3]]
}

describe('stageThumb', () => {
  it('sizes the image from the grid', () => {
    const t = stageThumb(stage, 3)
    expect(t.w).toBe(stage.grid.cols * 3)
    expect(t.h).toBe(stage.grid.rows * 3)
    expect(t.rgba.length).toBe(t.w * t.h * 4)
  })

  it('is deterministic and fully opaque', () => {
    const a = stageThumb(stage, 2)
    const b = stageThumb(generateStage(5, 4, 4), 2)
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba))
    for (let i = 3; i < a.rgba.length; i += 4) expect(a.rgba[i]).toBe(255)
  })

  it('paints the sea in the bottom row', () => {
    const t = stageThumb(stage, 2)
    expect(px(t, 5, t.h - 1)).toEqual([...THUMB_COLORS.sea, 255])
  })

  it('paints a rock cell, avoiding overlays', () => {
    const g = stage.grid
    const t = stageThumb(stage, 4)
    let found = false
    for (let row = 0; row < g.rows && !found; row++) {
      for (let col = 0; col < g.cols && !found; col++) {
        if (cellAt(g, col + g.col0, row + g.row0) !== SOLID || row + g.row0 >= 0) continue
        const p = px(t, col * 4, row * 4)
        if (p[0] === THUMB_COLORS.rock[0] && p[1] === THUMB_COLORS.rock[1] && p[2] === THUMB_COLORS.rock[2]) found = true
      }
    }
    expect(found).toBe(true)
  })

  it('paints pads and the finish line', () => {
    const g = stage.grid
    const t = stageThumb(stage, 4)
    let pads = 0
    for (let row = 0; row < g.rows; row++)
      for (let col = 0; col < g.cols; col++)
        if (cellAt(g, col + g.col0, row + g.row0) === PAD) {
          const p = px(t, col * 4 + 3, row * 4 + 3)
          if (p[0] === THUMB_COLORS.pad[0] && p[1] === THUMB_COLORS.pad[1]) pads++
        }
    expect(pads).toBeGreaterThan(0)
    const k = 4 / stage.cell
    const fx = Math.round((stage.finish.x - g.col0 * stage.cell) * k)
    const fy = Math.round((stage.finish.top - g.row0 * stage.cell) * k)
    expect(px(t, fx, fy)).toEqual([...THUMB_COLORS.finish, 255])
  })

  it('marks bay spawns', () => {
    const t = stageThumb(stage, 4)
    const k = 4 / stage.cell
    const b = stage.bays[0].spawn
    expect(px(t, Math.round((b.x - stage.grid.col0 * stage.cell) * k), Math.round((b.y - stage.grid.row0 * stage.cell) * k))).toEqual([...THUMB_COLORS.bay, 255])
  })
})
