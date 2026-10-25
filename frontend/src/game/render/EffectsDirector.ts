import Phaser from 'phaser'
import { lighten } from 'game/fx/color'
import type { FeelEvent, FeelSink } from 'game/fx/feelEvents'
import type { QualityProfile } from 'game/fx/quality'
import { wispFrame, wispSeeds } from 'game/fx/wisps'
import type { CameraFX } from 'game/render/CameraFX'
import type { PlayerVisuals } from 'game/render/PlayerVisuals'
import {
  ensureGlowTexture,
  ensureRingTexture,
  GLOW_TEXTURE,
  RING_TEXTURE,
} from 'game/render/textures'

// Just under the local player's trail (10) so effects never cover the orb; collision sits on top
const BEHIND_ORB_DEPTH = 9
// Dash sparks sit above the local trail (depth 10) but below the halo and orb
const EXHAUST_DEPTH = 10.5
// Same depth as the local trail but added later, so afterimages draw over the ribbon
const AFTERIMAGE_DEPTH = 10
const COLLISION_DEPTH = 20
const ORB_SCALE = 0.1
const RING_TEXTURE_RADIUS = 128

const FLAP_OFFSET_Y = 8
const AFTERIMAGE_INTERVAL_MS = 18
const AFTERIMAGE_FADE_MS = 180
// Dash pop: a white flash at the orb that blows out and is gone almost at once
const POP_SCALE = { from: 0.3, to: 1.1 }
const POP_MS = 140
const POP_LIGHTEN = 0.8
const POP_DEPTH = 11.5
// Upper bound on wisp images ever created; at most a few dashes' worth are alive at once
const MAX_WISPS = 220
const STALL_RING_RADIUS = { from: 18, to: 110 }
const STALL_RING_MS = 360
const COLLISION_RING_RADIUS = { from: 20, to: 220 }
const COLLISION_RING_MS = 480
const COLLISION_RING_TINT = 0xffc27a
// Rings use the player colour mixed this far toward white so they read on black
const LIGHTEN = 0.45
// Dash exhaust sparks are nearly white-hot, with just a hint of the player colour
const EXHAUST_LIGHTEN = 0.85

// Flap puff: soft glow dots kicked sideways and down (angles are clockwise from +x, y down). maxAliveParticles caps what is on screen;
// maxParticles would cap the lifetime total and kill the emitter once reached.
const puffConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  angle: { min: -15, max: 195 },
  speed: { min: 120, max: 280 },
  lifespan: { min: 260, max: 420 },
  scale: { start: 0.3, end: 0 },
  alpha: { start: 0.5, end: 0 },
  blendMode: 'ADD',
  maxAliveParticles: 60,
  emitting: false,
}

const BURST_RADIUS = 18

/** Uniform random point in a disc of `radius` around the emitter. */
const randomInDisc = (radius: number) => (point: Phaser.Types.Math.Vector2Like) => {
  const angle = Math.random() * Math.PI * 2
  const r = radius * Math.sqrt(Math.random())
  point.x = Math.cos(angle) * r
  point.y = Math.sin(angle) * r
}

// Collision: more flares than before but smaller and dimmer, born across a small disc and thrown
// out fast, so the overlapping core stays under the bloom threshold instead of a white blob
const burstConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  frame: ['red', 'yellow', 'green'],
  emitZone: { type: 'random', source: { getRandomPoint: randomInDisc(BURST_RADIUS) } },
  speed: { min: 380, max: 900 },
  lifespan: { min: 700, max: 1300 },
  scale: { start: 0.26, end: 0 },
  alpha: { start: 0.6, end: 0 },
  gravityY: 700,
  blendMode: 'ADD',
  maxAliveParticles: 160,
  emitting: false,
}

/** Where pad launches are drawn (PadRenderer): the flash, fountain and streak at a launch point. */
export interface PadLaunchSink {
  launch(x: number, y: number): void
}

/** Finds a player's visuals by id; undefined when the player has not joined yet or has left. */
export type VisualsLookup = (playerId: string) => PlayerVisuals | undefined

/**
 * Turns feel events into effects, for the local player and (relayed) remote players alike. Each
 * event is drawn on the visuals of the player it names; events for unknown players are dropped.
 * Emitters are created once and re-exploded; every per-event image or graphics object is
 * destroyed when its tween completes.
 */
export class EffectsDirector implements FeelSink {
  private scene: Phaser.Scene
  private cameraFX: CameraFX
  private profile: QualityProfile
  private visualsFor: VisualsLookup = () => undefined
  private localId?: string
  private puff: Phaser.GameObjects.Particles.ParticleEmitter
  private burst: Phaser.GameObjects.Particles.ParticleEmitter
  /** One afterimage run per player, so two players dashing at once don't cut each other off. */
  private afterimageTimers = new Map<string, Phaser.Time.TimerEvent>()
  /** Idle wisp images, reused; at most MAX_WISPS are ever created. */
  private freeWisps: Array<Phaser.GameObjects.Image> = []
  private wispCount = 0
  private padLaunch?: PadLaunchSink

  constructor(scene: Phaser.Scene, cameraFX: CameraFX, profile: QualityProfile) {
    this.scene = scene
    this.cameraFX = cameraFX
    this.profile = profile
    ensureGlowTexture(scene)
    ensureRingTexture(scene)

    this.puff = scene.add.particles(0, 0, GLOW_TEXTURE, puffConfig).setDepth(BEHIND_ORB_DEPTH)
    this.burst = scene.add.particles(0, 0, 'flares', burstConfig).setDepth(COLLISION_DEPTH)
  }

  /**
   * How to find each player's visuals (tint, afterimage texture, ignite and pulse come from
   * them), and which player is local: only the local player's collisions shake the camera.
   */
  public setVisualsLookup(lookup: VisualsLookup, localId: string) {
    this.visualsFor = lookup
    this.localId = localId
  }

  /** Who draws pad launches for the current stage; cleared (undefined) when there is none. */
  public setPadLaunch(sink?: PadLaunchSink) {
    this.padLaunch = sink
  }

  public applyQuality(profile: QualityProfile) {
    this.profile = profile
  }

  public emit(e: FeelEvent) {
    const visuals = this.visualsFor(e.playerId)
    if (!visuals) return
    // Anchor on the orb as drawn here: the same point as e.x/e.y locally, and where the remote
    // orb actually is rather than where its owner saw it a network hop ago
    const { x, y } = visuals
    switch (e.kind) {
      case 'flap':
        // Tint is copied onto each particle at emit time, so one shared emitter serves every colour
        this.puff.setParticleTint(visuals.tint)
        this.puff.explode(this.profile.puffCount, x, y + FLAP_OFFSET_Y)
        break
      case 'dash':
        this.pop(visuals)
        visuals.ignite()
        this.afterimages(e.playerId, visuals)
        this.wisps(visuals, e.dir)
        break
      case 'stall':
        this.ring(
          x,
          y,
          lighten(visuals.tint, LIGHTEN),
          STALL_RING_RADIUS,
          STALL_RING_MS,
          0.9,
          BEHIND_ORB_DEPTH,
        )
        break
      case 'recharge':
        visuals.pulse()
        break
      case 'bounce':
        // On the pad where the launch happened, not under the orb as drawn (already above it)
        this.padLaunch?.launch(e.x, e.y)
        break
      case 'collision':
        this.burst.explode(this.profile.burstCount, e.x, e.y)
        this.ring(
          e.x,
          e.y,
          COLLISION_RING_TINT,
          COLLISION_RING_RADIUS,
          COLLISION_RING_MS,
          0.6,
          COLLISION_DEPTH,
        )
        // Bystanders see the burst; only the players who collided feel it
        const involvesLocal = e.playerId === this.localId || e.otherId === this.localId
        if (involvesLocal) this.cameraFX.shake()
        break
    }
  }

  /** A white flash at the orb on dash, between the halo and the orb. */
  private pop(visuals: PlayerVisuals) {
    const flash = this.scene.add
      .image(visuals.x, visuals.y, GLOW_TEXTURE)
      .setTint(lighten(visuals.tint, POP_LIGHTEN))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(POP_SCALE.from)
      .setDepth(POP_DEPTH)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: POP_SCALE.to,
      duration: POP_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    })
  }

  /** Drops fading copies of the orb at its position over the next few frames of the dash. */
  private afterimages(playerId: string, local: PlayerVisuals) {
    this.afterimageTimers.get(playerId)?.remove()
    const timer = this.scene.time.addEvent({
      delay: AFTERIMAGE_INTERVAL_MS,
      repeat: this.profile.afterimages - 1,
      callback: () => {
        const ghost = this.scene.add
          .image(local.x, local.y, local.colorKey)
          .setScale(ORB_SCALE * 1.1)
          .setAlpha(0.6)
          .setDepth(AFTERIMAGE_DEPTH)
        this.scene.tweens.add({
          targets: ghost,
          alpha: 0,
          scale: ORB_SCALE * 0.6,
          duration: AFTERIMAGE_FADE_MS,
          ease: 'Quad.easeOut',
          onComplete: () => ghost.destroy(),
        })
        // The repeat count reads 0 on the final fire
        if (timer.getRepeatCount() === 0 && this.afterimageTimers.get(playerId) === timer) {
          this.afterimageTimers.delete(playerId)
        }
      },
    })
    this.afterimageTimers.set(playerId, timer)
  }

  /**
   * White-hot exhaust sparks shed from the orb over the dash's first moments. Each is born where the
   * orb is at its delay, then streaks backward and curls while it shrinks and fades (see `fx/wisps`).
   */
  private wisps(local: PlayerVisuals, dir: 1 | -1) {
    const tint = lighten(local.tint, EXHAUST_LIGHTEN)
    for (const seed of wispSeeds(this.profile.wisps)) {
      const mote = this.takeWisp()
      if (!mote) return
      mote.setTint(tint).setAlpha(0).setScale(seed.startScale)
      let originX = local.x
      let originY = local.y
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        delay: seed.delayMs,
        duration: seed.lifeMs,
        onStart: () => {
          originX = local.x
          originY = local.y
          mote.setPosition(originX, originY).setVisible(true)
        },
        onUpdate: (tween) => {
          const f = wispFrame(seed, tween.getValue() ?? 1, dir)
          mote
            .setPosition(originX + f.x, originY + f.y)
            .setScale(f.scale)
            .setAlpha(f.alpha)
        },
        onComplete: () => this.releaseWisp(mote),
        onStop: () => this.releaseWisp(mote),
      })
    }
  }

  private takeWisp(): Phaser.GameObjects.Image | undefined {
    const free = this.freeWisps.pop()
    if (free) return free.setActive(true)
    if (this.wispCount >= MAX_WISPS) return undefined
    this.wispCount++
    return this.scene.add
      .image(0, 0, GLOW_TEXTURE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(EXHAUST_DEPTH)
      .setVisible(false)
  }

  private releaseWisp(mote: Phaser.GameObjects.Image) {
    if (!mote.active) return
    mote.setActive(false).setVisible(false)
    this.freeWisps.push(mote)
  }

  private ring(
    x: number,
    y: number,
    tint: number,
    radius: { from: number; to: number },
    duration: number,
    alpha: number,
    depth: number,
  ) {
    const ring = this.scene.add
      .image(x, y, RING_TEXTURE)
      .setScale(radius.from / RING_TEXTURE_RADIUS)
      .setTint(tint)
      .setAlpha(alpha)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth)
    this.scene.tweens.add({
      targets: ring,
      scale: radius.to / RING_TEXTURE_RADIUS,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
  }
}
