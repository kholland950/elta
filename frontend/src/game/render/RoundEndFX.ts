import Phaser from 'phaser'
import { lighten } from 'game/fx/color'
import type { QualityProfile } from 'game/fx/quality'
import type { PlayerVisuals } from 'game/render/PlayerVisuals'
import { ensureGlowTexture, ensureRingTexture, GLOW_TEXTURE, RING_TEXTURE } from 'game/render/textures'

const RING_TEXTURE_RADIUS = 128
const DEPTH = 19

// Disintegrate: the orb swells and fades while its energy scatters as glowing shards that drift up
const VANISH_MS = 420
const SHARDS = { high: 36, low: 14, reduced: 10 }
const FLASH_MS = 200

// Celebrate: rings ripple out from the winner a few times while sparks fountain off it
const CELEBRATE_RINGS = 4
const CELEBRATE_RING_GAP_MS = 260
const CELEBRATE_RING = { from: 24, to: 260, ms: 700 }
const SPARK_BURSTS = 5
const SPARK_GAP_MS = 220
const SPARKS = { high: 18, low: 7 }
const REFORM_MS = 260

const shardConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  speed: { min: 60, max: 280 },
  lifespan: { min: 600, max: 1200 },
  scale: { start: 0.32, end: 0 },
  alpha: { start: 0.85, end: 0 },
  // Energy rises as it dissipates rather than falling like debris
  gravityY: -160,
  blendMode: 'ADD',
  maxAliveParticles: 8 * SHARDS.high,
  emitting: false,
}

const sparkConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  frame: ['yellow', 'green', 'blue', 'red'],
  angle: { min: 230, max: 310 },
  speed: { min: 300, max: 700 },
  lifespan: { min: 700, max: 1200 },
  scale: { start: 0.22, end: 0 },
  alpha: { start: 0.8, end: 0 },
  gravityY: 900,
  blendMode: 'ADD',
  maxAliveParticles: SPARK_BURSTS * SPARKS.high,
  emitting: false,
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * The end of a round in the world: the winner celebrates and every other orb disintegrates. Both
 * respect the quality level, and with reduced motion the effects are smaller and nothing flies far.
 * Emitters are created once; rings and flashes are destroyed when their tweens complete.
 */
export class RoundEndFX {
  private shards: Phaser.GameObjects.Particles.ParticleEmitter
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter
  private timers: Array<Phaser.Time.TimerEvent> = []

  constructor(
    private readonly scene: Phaser.Scene,
    private profile: QualityProfile,
  ) {
    ensureGlowTexture(scene)
    ensureRingTexture(scene)
    this.shards = scene.add.particles(0, 0, GLOW_TEXTURE, shardConfig).setDepth(DEPTH)
    this.sparks = scene.add.particles(0, 0, 'flares', sparkConfig).setDepth(DEPTH)
  }

  public applyQuality(profile: QualityProfile) {
    this.profile = profile
  }

  /** The orb comes apart: a flash, shards in its colour, and the orb fades out. */
  public disintegrate(visuals: PlayerVisuals) {
    const reduced = prefersReducedMotion()
    const { x, y } = visuals
    const count = reduced ? SHARDS.reduced : this.profile.bloom ? SHARDS.high : SHARDS.low
    this.shards.setParticleTint(lighten(visuals.tint, 0.3))
    this.shards.explode(count, x, y)
    this.flash(x, y, lighten(visuals.tint, 0.8))
    visuals.fadePresence(0, VANISH_MS)
  }

  /** The winner: rippling rings, sparks fountaining off it and pulsing halo. */
  public celebrate(visuals: PlayerVisuals) {
    const reduced = prefersReducedMotion()
    const tint = lighten(visuals.tint, 0.45)
    const rings = reduced ? 1 : CELEBRATE_RINGS
    this.repeat(rings, CELEBRATE_RING_GAP_MS, () => {
      this.ring(visuals.x, visuals.y, tint)
      visuals.pulse()
    })
    if (reduced) return
    const sparks = this.profile.bloom ? SPARKS.high : SPARKS.low
    this.repeat(SPARK_BURSTS, SPARK_GAP_MS, () => this.sparks.explode(sparks, visuals.x, visuals.y))
  }

  /** Brings an orb back for the next stage. */
  public reform(visuals: PlayerVisuals) {
    visuals.fadePresence(1, REFORM_MS)
  }

  /** Stops pending celebration bursts (a new stage was loaded). */
  public cancel() {
    this.timers.forEach((timer) => timer.remove())
    this.timers = []
  }

  private repeat(times: number, gapMs: number, fire: () => void) {
    fire()
    if (times <= 1) return
    const timer = this.scene.time.addEvent({
      delay: gapMs,
      repeat: times - 2,
      callback: () => {
        fire()
        if (timer.getRepeatCount() === 0) this.timers = this.timers.filter((t) => t !== timer)
      },
    })
    this.timers.push(timer)
  }

  private flash(x: number, y: number, tint: number) {
    const flash = this.scene.add
      .image(x, y, GLOW_TEXTURE)
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.4)
      .setDepth(DEPTH)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.6,
      duration: FLASH_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    })
  }

  private ring(x: number, y: number, tint: number) {
    const ring = this.scene.add
      .image(x, y, RING_TEXTURE)
      .setScale(CELEBRATE_RING.from / RING_TEXTURE_RADIUS)
      .setTint(tint)
      .setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH)
    this.scene.tweens.add({
      targets: ring,
      scale: CELEBRATE_RING.to / RING_TEXTURE_RADIUS,
      alpha: 0,
      duration: CELEBRATE_RING.ms,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
  }

  public destroy() {
    this.cancel()
    this.shards.destroy()
    this.sparks.destroy()
  }
}
