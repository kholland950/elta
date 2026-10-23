import Phaser from 'phaser'
import type { FinishGate, Rect, Stage } from 'game/race/stage'
import { BOUNCE_PAD_VY } from 'game/race/tuning'
import type { PhysicsSprite } from 'game/render/PlayerVisuals'

export interface StageContacts {
  /** The orb touched a solid or pad on any side. */
  onSurface(): void
}

/**
 * Arcade bodies for a stage: the merged rock solids and bounce pads as static bodies with colliders
 * against the local orb, plus the world bounds, sea level and finish gate. Sea drag itself is
 * applied per step by the player manager from `seaY`, which is cheaper than an overlap zone the
 * width of the stage.
 */
export class StageWorld {
  readonly gate: FinishGate
  readonly seaY: number
  private solids: Phaser.Physics.Arcade.StaticGroup
  private pads: Phaser.Physics.Arcade.StaticGroup
  private colliders: Array<Phaser.Physics.Arcade.Collider> = []

  constructor(
    private readonly scene: Phaser.Scene,
    readonly stage: Stage,
  ) {
    const { bounds } = stage
    scene.physics.world.setBounds(bounds.x, bounds.y, bounds.w, bounds.h)
    this.seaY = stage.seaY
    this.gate = stage.finish

    this.solids = scene.physics.add.staticGroup()
    this.pads = scene.physics.add.staticGroup()
    for (const solid of stage.solids) this.addBlock(this.solids, solid)
    for (const pad of stage.pads) this.addBlock(this.pads, pad)
  }

  private addBlock(group: Phaser.Physics.Arcade.StaticGroup, rect: Rect) {
    const zone = this.scene.add.zone(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h)
    group.add(zone)
  }

  /** Colliders between the local orb and the stage. */
  public attach(sprite: PhysicsSprite, contacts: StageContacts) {
    const physics = this.scene.physics
    this.colliders.push(
      physics.add.collider(sprite, this.solids, () => contacts.onSurface()),
      physics.add.collider(sprite, this.pads, (_orb, pad) => {
        // Landing on a pad (orb centre above its top) launches; touching its side only recharges
        const padBody = (pad as Phaser.Types.Physics.Arcade.GameObjectWithStaticBody).body
        if (sprite.body.center.y < padBody.top) sprite.body.setVelocityY(-BOUNCE_PAD_VY)
        contacts.onSurface()
      }),
    )
  }

  public destroy() {
    for (const collider of this.colliders) collider.destroy()
    this.colliders = []
    this.solids.destroy(true)
    this.pads.destroy(true)
  }
}
