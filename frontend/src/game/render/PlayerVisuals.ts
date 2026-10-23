import Phaser from 'phaser'
import type { QualityProfile } from 'game/fx/quality'
import { lighten } from 'game/fx/color'
import { squashStretch } from 'game/fx/orbMotion'
import { ensureGlowTexture, GLOW_TEXTURE } from 'game/render/textures'

export type PhysicsSprite = Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body }

export const ORB_COLORS: Record<string, number> = {
  Blue: 0x3d9bff,
  Green: 0x3dff8b,
  Orange: 0xff9a3d,
  Red: 0xff3d5a,
  Violet: 0xb06bff,
  Yellow: 0xffe23d,
}

const ORB_SCALE = 0.1
const HALO_SCALE = 0.2
const CORE_SIZE = 16
const LABEL_OFFSET_Y = 32
// Velocity below which the orb counts as still (matches the old trail threshold)
const MOVING_SPEED = 10
// Jumps longer than this (e.g. a remote position correction) emit at the end point only
const MAX_TRAIL_GAP = 200
// Upper bound on trail particles per frame, for very fast frames of travel
const MAX_TRAIL_PER_FRAME = 12
// Squash/stretch eases toward its target so bounces don't snap
const SHAPE_LERP = 0.35
const HALO_ALPHA = 0.45
// Recharge pulse: extra halo scale and alpha at the peak, and its length
const PULSE_SCALE = 0.6
const PULSE_ALPHA = 0.35
const PULSE_MS = 280
// Extra scale of an orb that has fully faded out (it swells as it disintegrates)
const VANISH_SWELL = 0.8

// maxAliveParticles caps particles on screen; maxParticles would cap the lifetime total and
// stop the trail for good once reached
const trailConfig = (
  maxAliveParticles: number,
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig => ({
  lifespan: 380,
  blendMode: 'ADD',
  scale: { start: 0.075, end: 0 },
  alpha: { start: 0.7, end: 0 },
  maxAliveParticles,
  emitting: false,
})

// Dash ignition: for a moment the trail lays a white-hot copy of itself on top, same shape and size
const IGNITE_MS = 140
const IGNITE_LIGHTEN = 0.7
const igniteConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  ...trailConfig(200),
  alpha: { start: 1, end: 0 },
}

/**
 * Everything drawn for one player. The physics sprite stays the hitbox and camera target but is
 * hidden; these objects follow it and are never touched by physics, so scaling them for
 * squash/stretch cannot change the body.
 */
export class PlayerVisuals {
  /** Texture key of the orb (the player's colour name). */
  readonly colorKey: string
  /** Neon tint for this player's colour. */
  readonly tint: number
  private scene: Phaser.Scene
  private target: PhysicsSprite
  private maxSpeed: number
  private trailRate: number
  private trail: Phaser.GameObjects.Particles.ParticleEmitter
  /** White-hot ribbon laid over the trail just after a dash; created on first use. */
  private ignition?: Phaser.GameObjects.Particles.ParticleEmitter
  private ignitedUntil = 0
  private halo: Phaser.GameObjects.Image
  private orb: Phaser.GameObjects.Image
  private core: Phaser.GameObjects.Image
  private label: Phaser.GameObjects.Text
  private lastX: number
  private lastY: number
  private coreScale: number
  private stretch = 1
  private angle = 0
  private pulseAmount = 0
  private pulseTween?: Phaser.Tweens.Tween
  /** 1 when fully here, 0 when gone (disintegrated, or a remote orb not yet placed). */
  private presence = 1
  private presenceTween?: Phaser.Tweens.Tween

  constructor(
    scene: Phaser.Scene,
    target: PhysicsSprite,
    color: string,
    name: string,
    isLocal: boolean,
    maxSpeed: number,
    profile: QualityProfile,
  ) {
    this.scene = scene
    this.colorKey = color
    this.target = target
    this.maxSpeed = maxSpeed
    this.trailRate = profile.trailRate
    this.lastX = target.x
    this.lastY = target.y
    ensureGlowTexture(scene)

    const tint = ORB_COLORS[color] ?? 0xffffff
    this.tint = tint
    const depth = isLocal ? 10 : 0
    this.coreScale = CORE_SIZE / scene.textures.get(GLOW_TEXTURE).getSourceImage().width

    this.trail = scene.add.particles(0, 0, color, trailConfig(isLocal ? 160 : 120)).setDepth(depth)
    this.halo = scene.add
      .image(target.x, target.y, color)
      .setScale(HALO_SCALE)
      .setAlpha(HALO_ALPHA)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth + 1)
    this.orb = scene.add
      .image(target.x, target.y, color)
      .setScale(ORB_SCALE)
      .setDepth(depth + 2)
    this.core = scene.add
      .image(target.x, target.y, GLOW_TEXTURE)
      .setScale(this.coreScale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth + 3)
    this.label = scene.add
      .text(target.x, target.y - LABEL_OFFSET_Y, name, {
        fontFamily: 'Comfortaa, sans-serif',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 1)
      .setShadow(0, 0, Phaser.Display.Color.IntegerToColor(tint).rgba, 8, false, true)
      .setDepth(depth + 4)
  }

  public applyQuality(profile: QualityProfile) {
    this.trailRate = profile.trailRate
  }

  /** World position of the orb (the physics body's sprite). */
  public get x() {
    return this.target.x
  }

  public get y() {
    return this.target.y
  }

  /** Makes the trail glow white-hot for a moment (dash). */
  public ignite() {
    if (!this.ignition) {
      this.ignition = this.scene.add
        .particles(0, 0, this.colorKey, igniteConfig)
        .setParticleTint(lighten(this.tint, IGNITE_LIGHTEN))
        .setDepth(this.trail.depth)
    }
    this.ignitedUntil = this.scene.time.now + IGNITE_MS
  }

  /** Brief swell of the halo, e.g. when dashes and stall are restored. */
  public pulse() {
    this.pulseTween?.remove()
    this.pulseTween = this.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: PULSE_MS,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => (this.pulseAmount = tween.getValue() ?? 0),
      onComplete: () => {
        this.pulseAmount = 0
        this.pulseTween = undefined
      },
    })
  }

  /** Shows or hides the orb at once. */
  public setPresence(presence: number) {
    this.presenceTween?.remove()
    this.presenceTween = undefined
    this.presence = presence
  }

  /** Fades the orb out (swelling as it goes) or back in over `ms`. */
  public fadePresence(to: number, ms: number) {
    this.presenceTween?.remove()
    this.presenceTween = this.scene.tweens.addCounter({
      from: this.presence,
      to,
      duration: ms,
      ease: to < this.presence ? 'Quad.easeIn' : 'Quad.easeOut',
      onUpdate: (tween) => (this.presence = tween.getValue() ?? to),
      onComplete: () => {
        this.presence = to
        this.presenceTween = undefined
      },
    })
  }

  /** Call after the physics step so the visuals match this frame's body position. */
  public update() {
    const { x, y } = this.target
    const { x: vx, y: vy } = this.target.body.velocity

    // No trail from an orb that isn't there
    if (this.presence > 0.5 && (Math.abs(vx) > MOVING_SPEED || Math.abs(vy) > MOVING_SPEED)) {
      this.emitTrail(x, y)
    }
    this.lastX = x
    this.lastY = y

    const shape = squashStretch(vx, vy, this.maxSpeed)
    this.stretch += (shape.scaleX - this.stretch) * SHAPE_LERP
    if (shape.scaleX !== 1) this.angle = shape.angle

    // Fading out, the orb swells as it comes apart
    const swell = 1 + VANISH_SWELL * (1 - this.presence)
    const sx = this.stretch * swell
    const sy = swell / this.stretch
    const haloScale = HALO_SCALE * (1 + PULSE_SCALE * this.pulseAmount)
    this.halo
      .setPosition(x, y)
      .setScale(haloScale * sx, haloScale * sy)
      .setRotation(this.angle)
      .setAlpha(Math.min(1, HALO_ALPHA + PULSE_ALPHA * this.pulseAmount) * this.presence)
    this.orb
      .setPosition(x, y)
      .setScale(ORB_SCALE * sx, ORB_SCALE * sy)
      .setRotation(this.angle)
      .setAlpha(this.presence)
    this.core
      .setPosition(x, y)
      .setScale(this.coreScale * sx, this.coreScale * sy)
      .setRotation(this.angle)
      .setAlpha(this.presence)
    this.label.setPosition(x, y - LABEL_OFFSET_Y).setAlpha(this.presence)
  }

  private emitTrail(x: number, y: number) {
    const dx = x - this.lastX
    const dy = y - this.lastY
    const distance = Math.hypot(dx, dy)
    if (distance > MAX_TRAIL_GAP) {
      this.trail.emitParticleAt(x, y, 1)
      return
    }
    // Spread particles evenly along the segment travelled so the trail reads as a ribbon
    const count = Math.min(
      MAX_TRAIL_PER_FRAME,
      Math.max(1, Math.round((distance * this.trailRate) / 100)),
    )
    const ignition = this.scene.time.now < this.ignitedUntil ? this.ignition : undefined
    for (let i = 1; i <= count; i++) {
      const t = i / count
      this.trail.emitParticleAt(this.lastX + dx * t, this.lastY + dy * t, 1)
      ignition?.emitParticleAt(this.lastX + dx * t, this.lastY + dy * t, 1)
    }
  }

  public destroy() {
    this.pulseTween?.remove()
    this.presenceTween?.remove()
    this.trail.destroy()
    this.ignition?.destroy()
    this.halo.destroy()
    this.orb.destroy()
    this.core.destroy()
    this.label.destroy()
  }
}
