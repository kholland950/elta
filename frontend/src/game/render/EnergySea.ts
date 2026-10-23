import Phaser from 'phaser'
import { GLOW_PASSES, STAGE_PALETTE } from 'game/fx/stagePalette'
import type { Stage } from 'game/race/stage'

/** Above the orbs (depth 10–14) so an orb in the sea reads as submerged; below effects (20). */
const SEA_DEPTH_LAYER = 16

/** The energy sea: a translucent cyan body with a glowing surface line. Ripples come later. */
export class EnergySea {
  private graphics: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, stage: Stage) {
    const { bounds, seaY } = stage
    const bottom = bounds.y + bounds.h
    const g = scene.add.graphics().setDepth(SEA_DEPTH_LAYER)
    g.fillStyle(STAGE_PALETTE.seaFill, STAGE_PALETTE.seaFillAlpha)
    g.fillRect(bounds.x, seaY, bounds.w, bottom - seaY)
    for (const { width, alpha } of GLOW_PASSES) {
      g.lineStyle(width, STAGE_PALETTE.seaEdge, alpha)
      g.lineBetween(bounds.x, seaY, bounds.x + bounds.w, seaY)
    }
    this.graphics = g
  }

  public destroy() {
    this.graphics.destroy()
  }
}
