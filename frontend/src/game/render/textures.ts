import Phaser from 'phaser'

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
