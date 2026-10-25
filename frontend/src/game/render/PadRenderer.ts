import Phaser from 'phaser'
import { lighten } from 'game/fx/color'
import { flashLevel, padAt, padPhase, padPulse } from 'game/fx/padGlow'
import type { QualityProfile } from 'game/fx/quality'
import { GLOW_PASSES, STAGE_PALETTE } from 'game/fx/stagePalette'
import type { Rect } from 'game/race/stage'
import {
  ensureGlowTexture,
  ensurePadCoreTexture,
  ensurePadTexture,
  GLOW_TEXTURE,
  PAD_CORE_H,
  PAD_CORE_TEXTURE,
  PAD_GLOW_MARGIN,
  PAD_TEXTURE,
} from 'game/render/textures'

/** Same depth as the stage; created after StageRenderer so it draws over the rock. */
const PAD_DEPTH = -2
/** Pads this far outside the camera view still pulse, so nothing pops in at the edge. */
const CULL_MARGIN = 200
/**
 * Peak alphas at full pulse. Kept low because both are additive and bloom (High) picks up
 * anything bright: the near-white core should glow, not blow out into a white bar.
 */
const BODY_ALPHA = 0.75
const CORE_ALPHA = 0.85
/**
 * The top edge's glow: the rock edges' passes plus a wider halo, each a little stronger, so the
 * launch surface outshines the walls next to it.
 */
const EDGE_PASSES: ReadonlyArray<{ width: number; alpha: number }> = [
  { width: 26, alpha: 0.07 },
  ...GLOW_PASSES.map(({ width, alpha }) => ({ width, alpha: Math.min(1, alpha * 1.6) })),
]
/** Each pad near the camera sheds one mote about this often. */
const MOTE_EVERY_MS = 700
/** Added to the body and core alphas at the peak of a launch flash (each capped at 1). */
const FLASH_BODY = 0.4
const FLASH_CORE = 0.4
/** A second launch off the same pad this soon after the last is the same landing; ignored. */
const RELAUNCH_MS = 60
/** Fountain and streak sit with the other effects behind the orb (EffectsDirector's 9). */
const LAUNCH_DEPTH = 9
const LAUNCH_TINT = lighten(STAGE_PALETTE.padEdge, 0.5)
/** The streak: a narrow, tall glow shooting up off the pad and fading. */
const STREAK_SCALE = { x: 0.12, y: 0.9 }
const STREAK_RISE = 120
const STREAK_MS = 220
const STREAK_ALPHA = 0.7

const moteConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  speedX: { min: -6, max: 6 },
  speedY: { min: -30, max: -12 },
  lifespan: { min: 700, max: 1300 },
  scale: { start: 0.07, end: 0 },
  alpha: { start: 0.5, end: 0 },
  tint: lighten(STAGE_PALETTE.padEdge, 0.35),
  blendMode: 'ADD',
  frequency: MOTE_EVERY_MS,
  maxAliveParticles: 24,
  emitting: false,
}

// Sparks thrown up out of the pad (angles are clockwise from +x, so -90 is straight up), falling
// back under gravity. Dim enough that the overlapping core stays under the bloom threshold.
const fountainConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  angle: { min: -110, max: -70 },
  speed: { min: 300, max: 650 },
  gravityY: 900,
  lifespan: { min: 400, max: 700 },
  scale: { start: 0.18, end: 0 },
  alpha: { start: 0.8, end: 0 },
  tint: LAUNCH_TINT,
  blendMode: 'ADD',
  maxAliveParticles: 96,
  emitting: false,
}

interface PadGlow {
  rect: Rect
  /** Pulse phase from the pad's x, so pads ripple across the stage. */
  phase: number
  /** Tinted gradient over the pad, plus the soft glow above it. */
  body: Phaser.GameObjects.Image
  /** Neon line along the top edge, at least as thick as the rock edges (EDGE_PASSES). */
  edge: Phaser.GameObjects.Graphics
  /** Near-white hot line on the top edge. */
  core: Phaser.GameObjects.Image
  /** Game time of the last launch off this pad, for the flash. */
  flashAt: number
}

/**
 * Bounce pads as glowing launch surfaces: a neon top edge as thick as the rock edges, a hot core
 * line on it with a soft glow above, and a magenta gradient fading to clear about ¾ of the way
 * down the pad. Pads near the camera
 * breathe at about 1 Hz, rippling across the stage, and shed a few faint motes that drift up.
 * A launch flashes the pad, throws a fountain of sparks up from the contact point and shoots a
 * short streak upward. Low quality drops the motes and thins the fountain; reduced motion holds
 * the glow steady, drops the motes and the streak, and halves the fountain.
 */
export class PadRenderer {
  private pads: Array<PadGlow>
  /** The pad rects, in the same order as `pads`, for `padAt`. */
  private rects: ReadonlyArray<Rect>
  /** Pads near the camera this frame, in `near[0..nearCount)`. Reused, never reallocated. */
  private near: Array<PadGlow>
  private nearCount = 0
  private motes?: Phaser.GameObjects.Particles.ParticleEmitter
  private fountain: Phaser.GameObjects.Particles.ParticleEmitter
  private motion?: MediaQueryList

  constructor(
    private readonly scene: Phaser.Scene,
    pads: ReadonlyArray<Rect>,
    private profile: QualityProfile,
  ) {
    this.motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.rects = pads
    if (pads.length > 0) {
      ensurePadTexture(scene)
      ensurePadCoreTexture(scene)
    }
    this.pads = pads.map((rect) => ({
      rect,
      phase: padPhase(rect.x),
      body: scene.add
        .image(rect.x, rect.y - PAD_GLOW_MARGIN, PAD_TEXTURE)
        .setOrigin(0, 0)
        .setDisplaySize(rect.w, rect.h + PAD_GLOW_MARGIN)
        .setTint(STAGE_PALETTE.padEdge)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(PAD_DEPTH),
      edge: this.drawEdge(rect),
      core: scene.add
        .image(rect.x, rect.y, PAD_CORE_TEXTURE)
        .setOrigin(0, 0.5)
        .setDisplaySize(rect.w, PAD_CORE_H)
        .setTint(STAGE_PALETTE.padCore)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(PAD_DEPTH),
      flashAt: Number.NEGATIVE_INFINITY,
    }))
    this.near = this.pads.slice()
    ensureGlowTexture(scene)
    // Always made: a relayed launch can arrive for a stage (or a point) with no pad to light up
    this.fountain = scene.add
      .particles(0, 0, GLOW_TEXTURE, fountainConfig)
      .setDepth(LAUNCH_DEPTH)
    if (this.pads.length > 0) {
      this.motes = scene.add
        .particles(0, 0, GLOW_TEXTURE, {
          ...moteConfig,
          emitZone: { type: 'random', source: { getRandomPoint: this.moteOrigin } },
        })
        .setDepth(PAD_DEPTH)
    }
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.frame, this)
  }

  public applyQuality(profile: QualityProfile) {
    this.profile = profile
  }

  /** The top edge in pad magenta, glowing a little wider and stronger than the rock edges. */
  private drawEdge({ x, y, w }: Rect) {
    const g = this.scene.add.graphics().setDepth(PAD_DEPTH).setBlendMode(Phaser.BlendModes.ADD)
    for (const { width, alpha } of EDGE_PASSES) {
      g.lineStyle(width, STAGE_PALETTE.padEdge, alpha)
      g.lineBetween(x, y, x + w, y)
    }
    return g
  }

  /** Per frame: hides pads off camera, pulses the rest and points the motes at them. */
  private frame() {
    if (this.pads.length === 0) return
    const view = this.scene.cameras.main.worldView
    const x0 = view.x - CULL_MARGIN
    const x1 = view.right + CULL_MARGIN
    const y0 = view.y - CULL_MARGIN
    const y1 = view.bottom + CULL_MARGIN
    const timeMs = this.scene.game.loop.time
    const reduced = this.motion?.matches ?? false
    let count = 0
    for (const pad of this.pads) {
      const { rect, body, edge, core } = pad
      const near = rect.x < x1 && rect.x + rect.w > x0 && rect.y < y1 && rect.y + rect.h > y0
      body.setVisible(near)
      edge.setVisible(near)
      core.setVisible(near)
      if (!near) continue
      this.near[count++] = pad
      const level = padPulse(timeMs, pad.phase, reduced)
      const flash = flashLevel(timeMs - pad.flashAt)
      body.setAlpha(Math.min(1, BODY_ALPHA * level + FLASH_BODY * flash))
      edge.setAlpha(Math.min(1, level + flash))
      core.setAlpha(Math.min(1, CORE_ALPHA * level + FLASH_CORE * flash))
    }
    this.nearCount = count

    const motes = this.motes
    if (!motes) return
    const on = this.profile.padMotes && !reduced && count > 0
    if (motes.emitting !== on) motes.emitting = on
    // The emitter is shared, so the rate scales with the pads in view to keep it per pad
    if (on) motes.frequency = MOTE_EVERY_MS / count
  }

  /**
   * A launch at (x, y), the orb's x on the pad's top: flashes that pad, throws the fountain and
   * shoots the streak. With no pad there (a relayed point from before a stage rebuild), only the
   * fountain shows.
   */
  public launch(x: number, y: number) {
    const timeMs = this.scene.game.loop.time
    const reduced = this.motion?.matches ?? false
    const rect = padAt(this.rects, x, y)
    const pad = rect && this.pads[this.rects.indexOf(rect)]
    if (pad) {
      if (timeMs - pad.flashAt < RELAUNCH_MS) return
      pad.flashAt = timeMs
    }
    const top = rect ? rect.y : y
    const count = this.profile.padBurstCount
    this.fountain.explode(reduced ? Math.ceil(count / 2) : count, x, top)
    if (pad && !reduced) this.streak(x, top)
  }

  private streak(x: number, top: number) {
    const streak = this.scene.add
      .image(x, top, GLOW_TEXTURE)
      .setOrigin(0.5, 1)
      .setScale(STREAK_SCALE.x, STREAK_SCALE.y)
      .setTint(LAUNCH_TINT)
      .setAlpha(STREAK_ALPHA)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LAUNCH_DEPTH)
    this.scene.tweens.add({
      targets: streak,
      y: top - STREAK_RISE,
      alpha: 0,
      duration: STREAK_MS,
      ease: 'Quad.easeOut',
      onComplete: () => streak.destroy(),
    })
  }

  /** Emit zone: a random point along the top edge of a pad near the camera. */
  private moteOrigin = (point: Phaser.Types.Math.Vector2Like) => {
    const pad = this.near[Math.floor(Math.random() * this.nearCount)] ?? this.near[0]
    if (!pad) return
    const { rect } = pad
    point.x = rect.x + 4 + Math.random() * (rect.w - 8)
    point.y = rect.y - 1
  }

  public destroy() {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.frame, this)
    for (const pad of this.pads) {
      pad.body.destroy()
      pad.edge.destroy()
      pad.core.destroy()
    }
    this.pads = []
    this.near = []
    this.nearCount = 0
    this.motes?.destroy()
    this.motes = undefined
    this.fountain.destroy()
  }
}
