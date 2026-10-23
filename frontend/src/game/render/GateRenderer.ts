import Phaser from 'phaser'
import type { QualityProfile } from 'game/fx/quality'
import { GLOW_PASSES, STAGE_PALETTE } from 'game/fx/stagePalette'
import type { Bay, Rect } from 'game/race/stage'
import { ensureGlowTexture, GLOW_TEXTURE } from 'game/render/textures'

/** Above the stage and finish line, below the orbs. */
const GATE_DEPTH = -1
/** The barrier slams shut from both emitters toward the middle. */
const CLOSE_MS = 140
/** It drops back into its emitters a little slower, so GO reads as a release. */
const OPEN_MS = 220
/** With reduced motion the barrier just fades in or out. */
const FADE_MS = 120
/** The flare on every change of state. */
const FLASH_MS = 320
/** Emitter caps at the floor and ceiling of each bay opening. */
const CAP_H = 6
const CAP_OVERHANG = 5
/** Scan bands drifting through a shut barrier. */
const BAND_GAP = 14
const BAND_SPEED = 0.05
const SPARKS = { high: 14, low: 5 }

const sparkConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
  speed: { min: 80, max: 260 },
  angle: { min: -60, max: 60 },
  lifespan: { min: 240, max: 520 },
  scale: { start: 0.22, end: 0 },
  alpha: { start: 0.9, end: 0 },
  tint: STAGE_PALETTE.gate,
  blendMode: 'ADD',
  maxAliveParticles: 8 * SPARKS.high,
  emitting: false,
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

interface Gate {
  rect: Rect
  graphics: Phaser.GameObjects.Graphics
}

/**
 * The start-bay gates as hard-light energy barriers: glowing emitter caps at the floor and ceiling
 * of every bay opening, and between them a barrier with a hot core line and drifting scan bands.
 * Shutting, the barrier shoots out of both emitters and meets in the middle with a flare; at GO it
 * snaps back into them with a flare and a spray of sparks out of the bay. Low quality drops the
 * sparks and the outer glow; reduced motion swaps the sweep for a short fade and stills the bands.
 */
export class GateRenderer {
  private gates: Array<Gate>
  private sparks?: Phaser.GameObjects.Particles.ParticleEmitter
  /** 1 = fully shut, 0 = open. */
  private level: number
  private open: boolean
  private flash = 0
  private dirty = true

  constructor(
    scene: Phaser.Scene,
    bays: ReadonlyArray<Bay>,
    private profile: QualityProfile,
    open: boolean,
  ) {
    this.open = open
    this.level = open ? 0 : 1
    this.gates = bays.map((bay) => ({
      rect: bay.gate,
      graphics: scene.add.graphics().setDepth(GATE_DEPTH).setBlendMode(Phaser.BlendModes.ADD),
    }))
    if (this.gates.length > 0) {
      ensureGlowTexture(scene)
      this.sparks = scene.add.particles(0, 0, GLOW_TEXTURE, sparkConfig).setDepth(GATE_DEPTH)
    }
  }

  public applyQuality(profile: QualityProfile) {
    this.profile = profile
    this.dirty = true
  }

  /** Per frame: follows the gate state and redraws while anything moves. */
  public update(timeMs: number, deltaMs: number, open: boolean) {
    if (this.gates.length === 0) return
    const reduced = prefersReducedMotion()
    if (open !== this.open) {
      this.open = open
      this.flash = 1
      if (open && !reduced) this.burst()
    }
    const target = open ? 0 : 1
    if (this.level !== target) {
      const ms = reduced ? FADE_MS : open ? OPEN_MS : CLOSE_MS
      const stepBy = deltaMs / ms
      this.level = open ? Math.max(0, this.level - stepBy) : Math.min(1, this.level + stepBy)
      this.dirty = true
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - deltaMs / FLASH_MS)
      this.dirty = true
    }
    // A shut barrier shimmers (the bands drift) unless motion is reduced
    const shimmering = this.level > 0 && !reduced
    if (!this.dirty && !shimmering) return
    this.dirty = false
    for (const gate of this.gates) this.draw(gate, timeMs, reduced)
  }

  private burst() {
    const count = this.profile.bloom ? SPARKS.high : SPARKS.low
    for (const { rect } of this.gates) {
      // Out of the opening, along its height
      for (let i = 0; i < count; i++) {
        this.sparks?.emitParticleAt(rect.x + rect.w, rect.y + ((i + 0.5) / count) * rect.h, 1)
      }
    }
  }

  private draw({ rect, graphics: g }: Gate, timeMs: number, reduced: boolean) {
    g.clear()
    const { x, y, w, h } = rect
    const flash = this.flash
    const shut = this.level
    const passes = this.profile.bloom ? GLOW_PASSES : GLOW_PASSES.slice(1)

    // Emitter caps: dim while open, bright while the barrier runs
    const capAlpha = 0.45 + 0.55 * Math.max(shut, flash)
    g.fillStyle(STAGE_PALETTE.gate, capAlpha)
    g.fillRect(x - CAP_OVERHANG, y, w + 2 * CAP_OVERHANG, CAP_H)
    g.fillRect(x - CAP_OVERHANG, y + h - CAP_H, w + 2 * CAP_OVERHANG, CAP_H)
    g.fillStyle(STAGE_PALETTE.gateCore, capAlpha)
    g.fillRect(x, y + CAP_H - 2, w, 2)
    g.fillRect(x, y + h - CAP_H, w, 2)

    if (shut <= 0 && flash <= 0) return

    // Reduced motion: the full barrier fades. Otherwise it runs from both caps to the middle.
    const reach = reduced ? h / 2 : (easeOutCubic(shut) * h) / 2
    const alpha = reduced ? shut : 1
    const cx = x + w / 2
    const segments: Array<[number, number]> = [
      [y, y + reach],
      [y + h - reach, y + h],
    ]

    if (shut > 0) {
      g.fillStyle(STAGE_PALETTE.gate, (0.16 + 0.2 * flash) * alpha)
      for (const [a, b] of segments) g.fillRect(x, a, w, b - a)
      // Scan bands drift down through the barrier
      const offset = reduced ? 0 : (timeMs * BAND_SPEED) % BAND_GAP
      g.lineStyle(2, STAGE_PALETTE.gate, 0.45 * alpha)
      for (let by = y + offset; by < y + h; by += BAND_GAP) {
        if (by < y + reach || by > y + h - reach) g.lineBetween(x + 2, by, x + w - 2, by)
      }
      for (const { width, alpha: a } of passes) {
        g.lineStyle(width + flash * 6, STAGE_PALETTE.gate, Math.min(1, a * (1 + flash)) * alpha)
        for (const [s0, s1] of segments) g.lineBetween(cx, s0, cx, s1)
      }
      g.lineStyle(1.5, STAGE_PALETTE.gateCore, alpha)
      for (const [s0, s1] of segments) g.lineBetween(cx, s0, cx, s1)
      // Hot leading edges while the barrier is still running
      if (!reduced && shut < 1) {
        g.fillStyle(STAGE_PALETTE.gateCore, 1)
        g.fillCircle(cx, y + reach, 4)
        g.fillCircle(cx, y + h - reach, 4)
      }
    }

    // The flare on a change of state: a bright sheet across the whole opening that fades
    if (flash > 0) {
      g.fillStyle(STAGE_PALETTE.gateCore, 0.35 * flash)
      g.fillRect(x, y, w, h)
      if (this.profile.bloom) {
        g.fillStyle(STAGE_PALETTE.gate, 0.12 * flash)
        g.fillRect(x - w, y, w * 3, h)
      }
    }
  }

  public destroy() {
    for (const gate of this.gates) gate.graphics.destroy()
    this.gates = []
    this.sparks?.destroy()
  }
}
