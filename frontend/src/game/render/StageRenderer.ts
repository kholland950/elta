import Phaser from 'phaser'
import { GLOW_PASSES, STAGE_PALETTE } from 'game/fx/stagePalette'
import type { FinishGate, Rect, Stage } from 'game/race/stage'

const STAGE_DEPTH = -2
const FINISH_DEPTH = -1
/** The stage is drawn in vertical strips this wide; strips off camera are hidden. */
const CHUNK_W = 1600
/** Strips this far outside the camera view stay drawn, so nothing pops in at the edge. */
const CULL_MARGIN = 300

const clipX = (r: Rect, x0: number, x1: number): Rect | undefined => {
  const a = Math.max(r.x, x0)
  const b = Math.min(r.x + r.w, x1)
  return b > a ? { x: a, y: r.y, w: b - a, h: r.h } : undefined
}

/**
 * Neon hard-light tunnels: dark rock with glowing cyan edges where it meets open space, a faint
 * tint inside tunnels and chambers so corridors read, magenta bounce pads, and the finish line
 * across the finish chamber. Drawn in vertical strips that are hidden when off camera.
 */
export class StageRenderer {
  private chunks: Array<{ x0: number; x1: number; graphics: Phaser.GameObjects.Graphics }> = []
  private finish?: Phaser.GameObjects.Graphics

  constructor(
    private readonly scene: Phaser.Scene,
    stage: Stage,
  ) {
    const { bounds } = stage
    const interiors = stage.segments.flatMap((s) => [...s.tunnels, ...s.chambers])
    for (let x0 = bounds.x; x0 < bounds.x + bounds.w; x0 += CHUNK_W) {
      const x1 = Math.min(bounds.x + bounds.w, x0 + CHUNK_W)
      this.chunks.push({ x0, x1, graphics: this.drawChunk(stage, interiors, x0, x1) })
    }
    // The lobby room has no finish
    if (stage.finish) this.finish = this.drawFinish(stage.finish)
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.cull, this)
  }

  private drawChunk(stage: Stage, interiors: Array<Rect>, x0: number, x1: number) {
    const g = this.scene.add.graphics().setDepth(STAGE_DEPTH)
    g.fillStyle(STAGE_PALETTE.tunnelFill, STAGE_PALETTE.tunnelFillAlpha)
    for (const r of interiors) {
      const c = clipX(r, x0, x1)
      if (c) g.fillRect(c.x, c.y, c.w, c.h)
    }
    g.fillStyle(STAGE_PALETTE.solidFill, STAGE_PALETTE.solidFillAlpha)
    for (const r of stage.solids) {
      const c = clipX(r, x0, x1)
      if (c) g.fillRect(c.x, c.y, c.w, c.h)
    }
    g.fillStyle(STAGE_PALETTE.padFill, 1)
    for (const r of stage.pads) {
      const c = clipX(r, x0, x1)
      if (c) g.fillRect(c.x, c.y, c.w, c.h)
    }
    for (const { width, alpha } of GLOW_PASSES) {
      for (const e of stage.edges) {
        const a = Math.max(Math.min(e.x0, e.x1), x0)
        const b = Math.min(Math.max(e.x0, e.x1), x1)
        if (b < a || (e.x0 === e.x1 && (e.x0 < x0 || e.x0 >= x1))) continue
        g.lineStyle(width, e.pad ? STAGE_PALETTE.padEdge : STAGE_PALETTE.solidEdge, alpha)
        if (e.x0 === e.x1) g.lineBetween(e.x0, e.y0, e.x1, e.y1)
        else g.lineBetween(a, e.y0, b, e.y1)
      }
    }
    return g
  }

  private drawFinish({ x, top, bottom }: FinishGate) {
    const g = this.scene.add.graphics().setDepth(FINISH_DEPTH).setBlendMode(Phaser.BlendModes.ADD)
    for (const { width, alpha } of GLOW_PASSES) {
      g.lineStyle(width * 2, STAGE_PALETTE.finish, alpha)
      g.lineBetween(x, top, x, bottom)
    }
    // Chequered band along the line so it reads as a finish, not a wall
    const cell = 25
    g.fillStyle(STAGE_PALETTE.finish, 0.25)
    for (let y = top, row = 0; y < bottom; y += cell, row++) {
      g.fillRect(x + (row % 2 === 0 ? 4 : 4 + cell), y, cell, Math.min(cell, bottom - y))
    }
    return g
  }

  private cull() {
    const view = this.scene.cameras.main.worldView
    const x0 = view.x - CULL_MARGIN
    const x1 = view.right + CULL_MARGIN
    for (const chunk of this.chunks) chunk.graphics.setVisible(chunk.x0 < x1 && chunk.x1 > x0)
  }

  public destroy() {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.cull, this)
    for (const chunk of this.chunks) chunk.graphics.destroy()
    this.chunks = []
    this.finish?.destroy()
  }
}
