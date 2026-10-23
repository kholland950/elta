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
 * against the local orb, the start-bay gates (a collider that is active only while they are shut),
 * plus the world bounds, sea level and finish gate. Sea drag itself is
 * applied per step by the player manager from `seaY`, which is cheaper than an overlap zone the
 * width of the stage.
 */
export class StageWorld {
  readonly gate?: FinishGate
  readonly seaY: number
  private solids: Phaser.Physics.Arcade.StaticGroup
  private pads: Phaser.Physics.Arcade.StaticGroup
  private gates: Phaser.Physics.Arcade.StaticGroup
  private colliders: Array<Phaser.Physics.Arcade.Collider> = []
  private gateCollider?: Phaser.Physics.Arcade.Collider
  private gatesOpen = true

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
    this.gates = scene.physics.add.staticGroup()
    for (const solid of stage.solids) this.addBlock(this.solids, solid)
    for (const pad of stage.pads) this.addBlock(this.pads, pad)
    for (const bay of stage.bays) this.addBlock(this.gates, bay.gate)
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
    // A shut gate is a wall like any other, recharge included
    this.gateCollider = physics.add.collider(sprite, this.gates, () => contacts.onSurface())
    this.gateCollider.active = !this.gatesOpen
    this.colliders.push(this.gateCollider)
  }

  /** Opens or shuts every start-bay gate's barrier. */
  public setGatesOpen(open: boolean) {
    this.gatesOpen = open
    if (this.gateCollider) this.gateCollider.active = !open
  }

  public destroy() {
    for (const collider of this.colliders) collider.destroy()
    this.colliders = []
    this.solids.destroy(true)
    this.pads.destroy(true)
    this.gates.destroy(true)
  }
}
