import Phaser from 'phaser'
import type { QualityProfile } from 'game/fx/quality'
import { MAX_STAR_LAYERS, generateNebula, generateStarLayers, StarLayer } from 'game/fx/starfield'
import { ensureGlowTexture, GLOW_TEXTURE } from 'game/render/textures'

const STAR_SEED = 1337
const TILE_SIZE = 512
const NEBULA_SCROLL = 0.08
// Extra room around the parallax-scaled world so nebula still shows at the world edges
const NEBULA_MARGIN = 2000
const BORDER_COLOR = 0x00e5ff
const BORDER_PASSES = [
  { width: 28, alpha: 0.05 },
  { width: 14, alpha: 0.12 },
  { width: 6, alpha: 0.35 },
  { width: 2, alpha: 1 },
]

interface NebulaSprite {
  image: Phaser.GameObjects.Image
  x: number
  y: number
}

/**
 * Procedural parallax starfield, nebula and neon world border.
 *
 * An object with scroll factor `s` is drawn at `x - camera.scrollX * s`, anchored to the camera's
 * top-left. Nebula images are offset by `(viewport / 2) * (1 - s)` so the layer is centred on the
 * camera instead; the offset is recomputed on resize. Star layers tile, so they only need to be big
 * enough to always cover the viewport.
 */
export class BackgroundRenderer {
  private scene: Phaser.Scene
  private starLayers: Array<Phaser.GameObjects.TileSprite> = []
  private nebula: Array<NebulaSprite> = []
  private border: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, worldSize: number, profile: QualityProfile) {
    this.scene = scene
    ensureGlowTexture(scene)

    this.createNebula(worldSize)
    this.createStars(worldSize)
    this.createBorder(worldSize)

    this.layoutNebula()
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layoutNebula, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layoutNebula, this),
    )

    this.applyQuality(profile)
  }

  public applyQuality(profile: QualityProfile) {
    this.starLayers.forEach((layer, index) => layer.setVisible(index < profile.parallaxLayers))
    this.nebula.forEach(({ image }) => image.setVisible(profile.nebula))
  }

  private createStars(worldSize: number) {
    generateStarLayers(STAR_SEED, MAX_STAR_LAYERS, TILE_SIZE).forEach((layer, index) => {
      const key = `fx-stars-${index}`
      this.bakeStarTexture(key, layer)
      // Twice the world so a parallax layer covers any viewport up to the world size
      const sprite = this.scene.add
        .tileSprite(0, 0, worldSize * 2, worldSize * 2, key)
        .setScrollFactor(layer.scrollFactor)
        .setDepth(-20 + index)
      // Offset each layer's pattern so the tiles don't line up between layers
      sprite.tilePositionX = index * 173
      sprite.tilePositionY = index * 291
      this.starLayers.push(sprite)
    })
  }

  private bakeStarTexture(key: string, layer: StarLayer) {
    if (this.scene.textures.exists(key)) return
    const texture = this.scene.textures.createCanvas(key, TILE_SIZE, TILE_SIZE)
    if (!texture) return
    const ctx = texture.getContext()
    layer.stars.forEach((star) => {
      if (star.r > 1.4) {
        // Soft halo on the bigger stars so the bloom has something to catch
        const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 3)
        glow.addColorStop(0, `rgba(170,210,255,${star.alpha * 0.5})`)
        glow.addColorStop(1, 'rgba(170,210,255,0)')
        ctx.fillStyle = glow
        ctx.fillRect(star.x - star.r * 3, star.y - star.r * 3, star.r * 6, star.r * 6)
      }
      ctx.fillStyle = `rgba(235,242,255,${star.alpha})`
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
      ctx.fill()
    })
    texture.refresh()
  }

  private createNebula(worldSize: number) {
    const span = worldSize * NEBULA_SCROLL + NEBULA_MARGIN
    const glowSize = this.scene.textures.get(GLOW_TEXTURE).getSourceImage().width
    generateNebula(STAR_SEED, span).forEach((blob) => {
      const image = this.scene.add
        .image(blob.x, blob.y, GLOW_TEXTURE)
        .setScrollFactor(NEBULA_SCROLL)
        .setScale((blob.radius * 2) / glowSize)
        .setTint(blob.color)
        .setAlpha(blob.alpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-30)
      this.nebula.push({ image, x: blob.x, y: blob.y })
    })
  }

  private layoutNebula() {
    const { width, height } = this.scene.scale.gameSize
    const offsetX = (width / 2) * (1 - NEBULA_SCROLL)
    const offsetY = (height / 2) * (1 - NEBULA_SCROLL)
    this.nebula.forEach(({ image, x, y }) => image.setPosition(x + offsetX, y + offsetY))
  }

  private createBorder(worldSize: number) {
    this.border = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(-5)
    const half = worldSize / 2
    BORDER_PASSES.forEach(({ width, alpha }) => {
      this.border.lineStyle(width, BORDER_COLOR, alpha)
      this.border.strokeRect(-half, -half, worldSize, worldSize)
    })
  }
}
