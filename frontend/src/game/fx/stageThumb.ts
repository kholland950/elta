import { OPEN, PAD, SOLID, cellAt } from '../race/grid'
import type { Point, RaceStage, Rect } from '../race/stage'

/** Pure rasteriser for the dev gallery: the stage grid plus route overlays, as RGBA. */

type Rgb = readonly [number, number, number]

export const THUMB_COLORS = {
  rock: [4, 9, 20],
  open: [13, 77, 102],
  pad: [255, 61, 240],
  sea: [0, 144, 176],
  spine: [255, 255, 255],
  finish: [244, 255, 107],
  bay: [255, 106, 61],
  forkHigh: [255, 170, 0],
  forkLow: [60, 255, 140],
  west: [255, 61, 154],
} as const satisfies Record<string, Rgb>

const MIX_WEST = 0.55
const MIX_FORK = 0.5

export const stageThumb = (stage: RaceStage, pxPerCell: number): { w: number; h: number; rgba: Uint8ClampedArray } => {
  const g = stage.grid
  const s = Math.max(1, Math.floor(pxPerCell))
  const w = g.cols * s
  const h = g.rows * s
  const rgba = new Uint8ClampedArray(w * h * 4)

  const put = (x: number, y: number, c: Rgb, a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    if (a >= 1) {
      rgba[i] = c[0]
      rgba[i + 1] = c[1]
      rgba[i + 2] = c[2]
    } else {
      rgba[i] = Math.round(rgba[i] * (1 - a) + c[0] * a)
      rgba[i + 1] = Math.round(rgba[i + 1] * (1 - a) + c[1] * a)
      rgba[i + 2] = Math.round(rgba[i + 2] * (1 - a) + c[2] * a)
    }
    rgba[i + 3] = 255
  }

  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const wr = row + g.row0
      const v = cellAt(g, col + g.col0, wr)
      const c: Rgb = wr >= 0 ? THUMB_COLORS.sea : v === SOLID ? THUMB_COLORS.rock : v === PAD ? THUMB_COLORS.pad : v === OPEN ? THUMB_COLORS.open : THUMB_COLORS.rock
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(col * s + dx, row * s + dy, c)
    }
  }

  // World px -> thumb px
  const k = s / stage.cell
  const tx = (x: number) => Math.round((x - g.col0 * stage.cell) * k)
  const ty = (y: number) => Math.round((y - g.row0 * stage.cell) * k)

  const fillRect = (r: Rect, c: Rgb, a: number) => {
    const x0 = tx(r.x)
    const y0 = ty(r.y)
    const x1 = Math.max(x0 + 1, tx(r.x + r.w))
    const y1 = Math.max(y0 + 1, ty(r.y + r.h))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c, a)
  }

  const line = (a: Point, b: Point, c: Rgb) => {
    const x0 = tx(a.x)
    const y0 = ty(a.y)
    const x1 = tx(b.x)
    const y1 = ty(b.y)
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c)
  }

  // Fields from a newer generator are read defensively
  for (const seg of stage.segments) {
    const west = (seg.entry as { dir?: string }).dir === 'W' || (seg.exit as { dir?: string }).dir === 'W'
    if (west) fillRect(seg.bounds, THUMB_COLORS.west, MIX_WEST * 0.5)
    const fork = (seg as { fork?: { high: Rect[]; low: Rect[] } }).fork
    if (fork) {
      for (const r of fork.high) fillRect(r, THUMB_COLORS.forkHigh, MIX_FORK)
      for (const r of fork.low) fillRect(r, THUMB_COLORS.forkLow, MIX_FORK)
    }
  }

  for (let i = 1; i < stage.spine.length; i++) line(stage.spine[i - 1], stage.spine[i], THUMB_COLORS.spine)

  const f = stage.finish
  const fRight = (f as { right?: number }).right
  for (let y = ty(f.top); y <= ty(f.bottom); y++) {
    put(tx(f.x), y, THUMB_COLORS.finish)
    if (fRight !== undefined) put(tx(fRight), y, THUMB_COLORS.finish)
  }

  for (const bay of stage.bays) {
    const bx = tx(bay.spawn.x)
    const by = ty(bay.spawn.y)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(bx + dx, by + dy, THUMB_COLORS.bay)
  }

  return { w, h, rgba }
}
