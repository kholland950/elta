import Phaser from 'phaser'

/**
 * The orb art in grayscale (white at the center, mid gray at the rim). Drawn with
 * `ORB_TINT_MODE`, a player's color shows at the rim and fades to white in the middle.
 */
export const ORB_TEXTURE = 'orb'
export const ORB_TINT_MODE = Phaser.TintModes.SCREEN

export const loadOrbTexture = (scene: Phaser.Scene) =>
  scene.load.image(ORB_TEXTURE, '/static/assets/OrbLight.png')

/** Shared soft white radial dot, tinted per use (orb cores, nebula blobs). */
export const GLOW_TEXTURE = 'fx-glow'

export const ensureGlowTexture = (scene: Phaser.Scene, size = 128) => {
  if (scene.textures.exists(GLOW_TEXTURE)) return
  const texture = scene.textures.createCanvas(GLOW_TEXTURE, size, size)
  if (!texture) return
  const ctx = texture.getContext()
  const half = size / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.8)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.2)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  texture.refresh()
}

/** Soft white ring, tinted and scaled for shockwaves. Its radius is half the texture size. */
export const RING_TEXTURE = 'fx-ring'

export const ensureRingTexture = (scene: Phaser.Scene, size = 256) => {
  if (scene.textures.exists(RING_TEXTURE)) return
  const texture = scene.textures.createCanvas(RING_TEXTURE, size, size)
  if (!texture) return
  const ctx = texture.getContext()
  const half = size / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.62, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.84, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.9, 'rgba(255,255,255,0.5)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  texture.refresh()
}

/** Soft glow above a pad's top edge, in px; the pad texture covers this plus the pad. */
export const PAD_GLOW_MARGIN = 8
/** Pad height the pad texture's gradient is laid out for (2×1 cells). */
const PAD_REF_H = 50
/** Texture px per world px, so the gradient stays smooth when drawn at pad size. */
const PAD_TEXTURE_RES = 2

/**
 * Bounce pad body glow, white so it can be tinted, laid out for a PAD_REF_H pad with
 * PAD_GLOW_MARGIN above it: a soft glow rising to the top edge, a crisp line on the edge, then a
 * gradient fading to clear about ¾ of the way down. Columns are identical, so it stretches to any
 * pad width.
 */
export const PAD_TEXTURE = 'fx-pad'

export const ensurePadTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PAD_TEXTURE)) return
  const h = (PAD_GLOW_MARGIN + PAD_REF_H) * PAD_TEXTURE_RES
  const texture = scene.textures.createCanvas(PAD_TEXTURE, 16, h)
  if (!texture) return
  const ctx = texture.getContext()
  // Stops as fractions of the texture height, from world px below the glow's top
  const at = (px: number) => px / (PAD_GLOW_MARGIN + PAD_REF_H)
  const top = PAD_GLOW_MARGIN
  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(at(top * 0.5), 'rgba(255,255,255,0.06)')
  gradient.addColorStop(at(top - 2), 'rgba(255,255,255,0.22)')
  gradient.addColorStop(at(top - 1), 'rgba(255,255,255,0.7)')
  gradient.addColorStop(at(top), 'rgba(255,255,255,1)')
  gradient.addColorStop(at(top + 1), 'rgba(255,255,255,0.7)')
  gradient.addColorStop(at(top + 2), 'rgba(255,255,255,0.42)')
  gradient.addColorStop(at(top + PAD_REF_H * 0.15), 'rgba(255,255,255,0.3)')
  gradient.addColorStop(at(top + PAD_REF_H * 0.4), 'rgba(255,255,255,0.14)')
  gradient.addColorStop(at(top + PAD_REF_H * 0.6), 'rgba(255,255,255,0.05)')
  gradient.addColorStop(at(top + PAD_REF_H * 0.75), 'rgba(255,255,255,0)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 16, h)
  texture.refresh()
}

/** Height in px of the pad core line texture, drawn centred on the pad's top edge. */
export const PAD_CORE_H = 6

/**
 * The hot core along a pad's top edge: a 1-2px white line with a soft halo, tapering at both ends.
 * Drawn over the tinted pad glow in a near-white so the edge reads hotter than the body.
 */
export const PAD_CORE_TEXTURE = 'fx-pad-core'

export const ensurePadCoreTexture = (scene: Phaser.Scene) => {
  if (scene.textures.exists(PAD_CORE_TEXTURE)) return
  const w = 64
  const h = PAD_CORE_H * PAD_TEXTURE_RES
  const texture = scene.textures.createCanvas(PAD_CORE_TEXTURE, w, h)
  if (!texture) return
  const ctx = texture.getContext()
  const vertical = ctx.createLinearGradient(0, 0, 0, h)
  vertical.addColorStop(0, 'rgba(255,255,255,0)')
  vertical.addColorStop(0.3, 'rgba(255,255,255,0.2)')
  vertical.addColorStop(0.5, 'rgba(255,255,255,1)')
  vertical.addColorStop(0.7, 'rgba(255,255,255,0.2)')
  vertical.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = vertical
  ctx.fillRect(0, 0, w, h)
  // Taper the ends so the line doesn't stop dead at the pad's corners
  const horizontal = ctx.createLinearGradient(0, 0, w, 0)
  horizontal.addColorStop(0, 'rgba(255,255,255,0.3)')
  horizontal.addColorStop(0.06, 'rgba(255,255,255,1)')
  horizontal.addColorStop(0.94, 'rgba(255,255,255,1)')
  horizontal.addColorStop(1, 'rgba(255,255,255,0.3)')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = horizontal
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  texture.refresh()
}
