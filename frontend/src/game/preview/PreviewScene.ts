import Phaser from 'phaser'
import { loadQuality, qualityProfile } from 'game/fx/quality'
import type { Profile } from 'game/profile/profile'
import { freshPilot, isResting, NO_INPUT, type PilotState, stepPilot } from 'game/race/movement'
import { BODY, GRAVITY, STEP_HZ } from 'game/race/tuning'
import { type PhysicsSprite, PlayerVisuals } from 'game/render/PlayerVisuals'
import { loadOrbTexture, ORB_TEXTURE } from 'game/render/textures'

export const PREVIEW_WIDTH = 280
export const PREVIEW_HEIGHT = 240

// A jump starts this often (in physics steps, ~1.5s), and is held this long before it's let go,
// so the jump cut keeps the hop inside the little canvas
const HOP_EVERY_STEPS = 180
const HOP_HOLD_STEPS = 8
// Same body as a racing orb (PlayerManager's playerConfig)
const ORB_SCALE = 0.1
const HITBOX = 125
const FLOOR_HEIGHT = 24

/** One orb hopping on a floor, drawn exactly as in a race, for the Customize screen. */
class PreviewScene extends Phaser.Scene {
  private profile: Profile
  private sprite?: PhysicsSprite
  private visuals?: PlayerVisuals
  private pilot: PilotState = freshPilot()
  private steps = 0

  constructor(profile: Profile) {
    super({ key: 'preview' })
    this.profile = profile
  }

  public preload() {
    loadOrbTexture(this)
  }

  public create() {
    const floorY = PREVIEW_HEIGHT - FLOOR_HEIGHT
    this.physics.world.setBounds(0, 0, PREVIEW_WIDTH, floorY)
    this.add
      .rectangle(PREVIEW_WIDTH / 2, floorY + 1, PREVIEW_WIDTH - 40, 2, 0x2ee6d6, 0.6)
      .setOrigin(0.5, 0)

    const sprite = this.add.sprite(PREVIEW_WIDTH / 2, floorY - 20, ORB_TEXTURE) as PhysicsSprite
    sprite.setScale(ORB_SCALE).setVisible(false)
    this.physics.add.existing(sprite)
    const body = sprite.body
    body.setCircle(HITBOX, HITBOX, HITBOX)
    body.setDrag(BODY.drag, BODY.drag)
    body.setCollideWorldBounds(true)
    body.setBounce(BODY.bounce, BODY.bounce)
    body.setMaxSpeed(BODY.maxSpeed)
    this.sprite = sprite
    this.buildVisuals()

    this.physics.world.on('worldstep', () => this.step())
  }

  public setProfile(profile: Profile) {
    this.profile = profile
    // Before create the new profile is simply used there
    if (this.sprite) this.buildVisuals()
  }

  public update() {
    this.visuals?.update()
  }

  private buildVisuals() {
    this.visuals?.destroy()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.visuals = new PlayerVisuals(
      this,
      this.sprite!,
      this.profile.color,
      this.profile.name,
      true,
      BODY.maxSpeed,
      qualityProfile(loadQuality(window.localStorage), reducedMotion),
    )
  }

  private step() {
    const body = this.sprite!.body
    const phase = this.steps++ % HOP_EVERY_STEPS
    const onFloor = body.blocked.down
    // Landed: flaps come back, as touching ground does in a race
    if (onFloor && body.velocity.y >= 0) this.pilot = freshPilot()
    const input = {
      ...NO_INPUT,
      flapPressed: phase === 0,
      flapHeld: phase < HOP_HOLD_STEPS,
    }
    const out = stepPilot(this.pilot, input, { x: body.velocity.x, y: body.velocity.y })
    this.pilot = out.state
    // Parked with gravity off when still on the floor, as PlayerManager does, so it doesn't jitter
    const resting = isResting(out.velocity.y, onFloor)
    body.setAllowGravity(!resting)
    body.setVelocity(out.velocity.x, resting ? 0 : out.velocity.y)
  }
}

export interface OrbPreview {
  setProfile(profile: Profile): void
  destroy(): void
}

/** Starts a small transparent Phaser canvas inside `parent` showing `profile`'s orb. */
export const startPreview = (parent: HTMLElement, profile: Profile): OrbPreview => {
  const scene = new PreviewScene(profile)
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    transparent: true,
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: GRAVITY }, fps: STEP_HZ },
    },
    // The preview never takes keys or the pad from the menu around it
    input: { keyboard: false, gamepad: false },
    banner: false,
    scene,
  })
  return {
    setProfile: (p) => scene.setProfile(p),
    destroy: () => game.destroy(true),
  }
}
