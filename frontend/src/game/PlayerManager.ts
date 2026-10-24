import type { MainScene } from 'game/MainScene'
import Phaser from 'phaser'
import type { Physics } from 'phaser'
import type { QualityProfile } from 'game/fx/quality'
import type { FeelSink } from 'game/fx/feelEvents'
import type { PlayerMoveMessage, RoomPlayer } from 'game/race/protocol'
import type { Point } from 'game/race/stage'
import { PhysicsSprite, PlayerVisuals } from 'game/render/PlayerVisuals'
import {
  BumpCooldowns,
  bumpVelocity,
  freshPilot,
  InputFrame,
  PilotState,
  recharge,
  seaDrag,
  isResting,
  stepPilot,
} from 'game/race/movement'
import { BODY, STEP_MS } from 'game/race/tuning'

/** Own position updates sent per second. */
export const MOVE_TPS = 32

/** Where the local orb's movement goes (the room connection); absent when playing solo. */
export interface MoveSink {
  sendMove(m: Omit<PlayerMoveMessage, 'playerId'>): void
}

const playerConfig = {
  startingPosition: { x: 400, y: 400 },
  scale: 0.1,
  hitboxOffset: 125,
}

export interface Player {
  sprite: PhysicsSprite
  visuals: PlayerVisuals
  id: string
  color: string
  isLocal: boolean
  name: string
  /** False for a remote orb until its first playerMove says where it is. */
  placed: boolean
}

/** Presses seen since the last physics step; each is consumed by exactly one step. */
interface Latches {
  flap: boolean
  dash: boolean
  stall: boolean
}

const FLAP_KEYS = new Set(['Space', 'ArrowUp'])
const DASH_KEYS = new Set(['ShiftLeft', 'ShiftRight'])
const STALL_KEYS = new Set(['KeyE'])

export class PlayerManager {
  private remotePlayers: Array<Player> = []
  private localPlayer: Player
  private scene: MainScene
  private quality: QualityProfile
  private feel: FeelSink
  /** Remote orbs, as an Arcade group so one overlap covers players who join later. */
  private remoteGroup: Physics.Arcade.Group
  private controls: {
    left: Array<Phaser.Input.Keyboard.Key>
    right: Array<Phaser.Input.Keyboard.Key>
    scoreboard: Phaser.Input.Keyboard.Key
  }
  private latches: Latches = { flap: false, dash: false, stall: false }
  private pilot: PilotState = freshPilot()
  private bumps = new BumpCooldowns()
  /** Physics steps run since the scene started; the clock for bump cooldowns. */
  private steps = 0
  private lastSent = { x: 0, y: 0 }
  /** Remote players in the other world (lobby room vs match-end view); not shown, moves ignored. */
  private hidden: ReadonlySet<string> = new Set()
  /** Y of the energy sea surface; below it the orb is slowed. */
  private seaY = Infinity
  private restsOnGround: (body: Phaser.Physics.Arcade.Body) => boolean = () => false

  constructor(
    scene: MainScene,
    quality: QualityProfile,
    feel: FeelSink,
    private readonly moves?: MoveSink,
  ) {
    this.scene = scene
    this.quality = quality
    this.feel = feel
    this.remoteGroup = scene.physics.add.group()
    // Keyboard input is enabled by default in the game config
    const keyboard = this.scene.input.keyboard!
    this.controls = {
      left: [
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      ],
      right: [
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      ],
      scoreboard: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
    }
    // Capture the action keys so they are tracked (and don't scroll the page)
    keyboard.addKeys('SPACE,UP,SHIFT,E')
    // Presses are latched from key events, so one shorter than a physics step is never lost and
    // one is never seen twice when several steps run in a frame
    keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      if (event.repeat) return
      if (FLAP_KEYS.has(event.code)) this.latches.flap = true
      if (DASH_KEYS.has(event.code)) this.latches.dash = true
      if (STALL_KEYS.has(event.code)) this.latches.stall = true
    })
  }

  private addLocalPlayer(player: Player) {
    this.localPlayer = player
    this.scene.cameras.main.startFollow(this.localPlayer.sprite, false, 0.2, 0.2)
    const moves = this.moves
    if (moves) {
      this.scene.time.addEvent({
        delay: 1000 / MOVE_TPS,
        loop: true,
        callback: () => {
          const move = this.movedSinceLastSend()
          if (move) moves.sendMove(move)
        },
      })
    }

    player.sprite.body.setCollideWorldBounds(true, undefined, undefined, true)
    this.scene.physics.world.on(
      'worldbounds',
      (body: Physics.Arcade.Body, up: boolean, down: boolean, left: boolean, right: boolean) => {
        if (body === player.sprite.body && (up || left || right || down)) this.touchedSurface()
      },
    )
    // Bumps act on the local orb only; each client moves its own orb
    this.scene.physics.add.overlap(player.sprite, this.remoteGroup, (_local, other) =>
      this.bumped(other as PhysicsSprite),
    )
  }

  /** The local player's sprite, once it exists. */
  public get localSprite(): PhysicsSprite | undefined {
    return this.localPlayer?.sprite
  }

  public get localId(): string | undefined {
    return this.localPlayer?.id
  }

  /** The server assigns the local id after the scene starts; the orb takes it when it arrives. */
  public setLocalId(id: string) {
    if (this.localPlayer) this.localPlayer.id = id
  }

  /** The visuals of the local or a remote player, if that player is currently in the game. */
  public visualsFor(id: string): PlayerVisuals | undefined {
    if (this.localPlayer?.id === id) return this.localPlayer.visuals
    // A remote orb not placed yet has nowhere to show effects
    const remote = this.remotePlayers.find((player) => player.id === id)
    return remote?.placed ? remote.visuals : undefined
  }

  public setSeaY(seaY: number) {
    this.seaY = seaY
  }

  /** Where the orb may come to rest (see StageWorld.restsOnGround); with no stage, never. */
  public setGroundProbe(probe: (body: Phaser.Physics.Arcade.Body) => boolean) {
    this.restsOnGround = probe
  }

  /** Contact with any surface recharges; feedback only fires when something was used up. */
  public touchedSurface() {
    const { state, restored } = recharge(this.pilot)
    this.pilot = state
    if (restored && this.localPlayer) this.emitLocal('recharge')
  }

  /** Full charge and no pending presses, e.g. when snapped to a start slot. */
  public resetPilot() {
    this.pilot = { ...freshPilot(), facing: this.pilot.facing }
    this.clearLatches()
  }

  private clearLatches() {
    this.latches = { flap: false, dash: false, stall: false }
  }

  private bumped(other: PhysicsSprite) {
    const remote = this.remotePlayers.find((player) => player.sprite === other)
    const local = this.localPlayer
    if (!remote || !local) return
    if (!this.bumps.tryBump(remote.id, this.steps * STEP_MS)) return
    const v = bumpVelocity(
      { id: local.id, x: local.sprite.body.center.x, y: local.sprite.body.center.y },
      { id: remote.id, x: other.body.center.x, y: other.body.center.y },
    )
    local.sprite.body.setVelocity(v.x, v.y)
    this.feel.emit({
      kind: 'collision',
      playerId: local.id,
      otherId: remote.id,
      x: (local.sprite.body.center.x + other.body.center.x) / 2,
      y: (local.sprite.body.center.y + other.body.center.y) / 2,
    })
    this.touchedSurface()
  }

  // Positions come from the body: during a frame that runs several physics steps the sprite only
  // catches up after the last one
  private emitLocal(kind: 'flap' | 'stall' | 'recharge') {
    const { id: playerId, sprite } = this.localPlayer
    this.feel.emit({ kind, playerId, x: sprite.body.center.x, y: sprite.body.center.y })
  }

  private emitDash(dir: 1 | -1) {
    const { id: playerId, sprite } = this.localPlayer
    this.feel.emit({ kind: 'dash', playerId, x: sprite.body.center.x, y: sprite.body.center.y, dir })
  }

  public addPlayer(
    color: string,
    name: string,
    isLocal: boolean,
    x: number,
    y: number,
    id = PlayerManager.generatePlayerId(),
  ) {
    const player: Player = {} as any
    player.id = id
    player.isLocal = isLocal
    player.name = name
    player.color = color
    player.placed = isLocal

    this.createSprite(player, x, y)

    this.addPhysics(player)

    player.visuals = new PlayerVisuals(
      this.scene,
      player.sprite,
      color,
      name,
      isLocal,
      BODY.maxSpeed,
      this.quality,
    )

    if (isLocal) {
      this.addLocalPlayer(player)
    } else {
      this.remotePlayers.push(player)
    }
  }

  private createSprite(player: Player, x: number, y: number) {
    player.sprite = this.scene.add.sprite(
      x !== undefined ? x : playerConfig.startingPosition.x,
      y !== undefined ? y : playerConfig.startingPosition.y,
      player.color,
    ) as any

    player.sprite.setScale(playerConfig.scale)
    // The sprite is only the physics body and camera target; PlayerVisuals draws the player
    player.sprite.setVisible(false)
  }

  private addPhysics(player: Player) {
    // Remote orbs join the group first, since adding to a physics group resets body settings
    if (player.isLocal) this.scene.physics.add.existing(player.sprite)
    else this.remoteGroup.add(player.sprite)

    const body = player.sprite.body
    body.setCircle(playerConfig.hitboxOffset, playerConfig.hitboxOffset, playerConfig.hitboxOffset)
    body.setFriction(BODY.friction, BODY.friction)
    body.setDrag(BODY.drag, BODY.drag)
    body.setCollideWorldBounds(true)
    body.setBounce(BODY.bounce, BODY.bounce)
    body.setMaxSpeed(BODY.maxSpeed)
    // A remote orb is dead-reckoned from its owner's last update and never collides with the
    // stage, so gravity would sink it through the floor whenever its owner stops sending (at rest,
    // or held in a start bay). Without gravity it coasts on the sent velocity, slowed by drag.
    if (!player.isLocal) body.setAllowGravity(false)
  }

  /**
   * Makes the remote orbs match the room's players: adds the missing (hidden until their first
   * move) and removes those who are gone. `announce` shows "joined" for the added ones. When
   * someone is added the local position goes out again on the next tick: moves are only sent on
   * change, so a newcomer would otherwise never see an orb that is sitting still.
   */
  public syncRemotes(players: ReadonlyArray<RoomPlayer>, announce: boolean) {
    const ids = new Set(players.map((p) => p.id))
    this.remotePlayers
      .filter((player) => !ids.has(player.id))
      .forEach((player) => this.playerLeft(player.id))
    players.forEach((p) => {
      if (this.remotePlayers.some((player) => player.id === p.id)) return
      this.addPlayer(p.color, p.name, false, 0, 0, p.id)
      const added = this.remotePlayers[this.remotePlayers.length - 1]
      this.setPlaced(added, false)
      this.resendPosition()
      if (announce) this.scene.events.emit('message', `${p.name} joined`)
    })
  }

  /** Sends the local position on the next tick even if it has not changed. */
  public resendPosition() {
    this.lastSent = { x: NaN, y: NaN }
  }

  /**
   * Remote players to hide: their orbs disappear (and leave bumps) and their moves are ignored.
   * One who stops being hidden reappears at their next move, and the local position goes out
   * again so they see this orb too.
   */
  public setHiddenRemotes(ids: ReadonlySet<string>) {
    let revealed = false
    for (const player of this.remotePlayers) {
      const was = this.hidden.has(player.id)
      const now = ids.has(player.id)
      if (now && !was) this.setPlaced(player, false)
      if (was && !now) revealed = true
    }
    this.hidden = new Set(ids)
    if (revealed) this.resendPosition()
  }

  public isHidden(id: string): boolean {
    return this.hidden.has(id)
  }

  /** Hides a remote orb (and takes it out of bumps) until it is placed, or shows it once placed. */
  private setPlaced(player: Player, placed: boolean) {
    player.placed = placed
    player.sprite.body.enable = placed
    player.visuals.setPresence(placed ? 1 : 0)
  }

  /** The local position and velocity, when the orb has moved more than a pixel since last sent. */
  private movedSinceLastSend(): Omit<PlayerMoveMessage, 'playerId'> | undefined {
    const sprite = this.localPlayer?.sprite
    if (!sprite) return undefined
    const { x, y } = sprite
    // NaN (a resend was asked for) compares false, so it counts as moved
    const moved = !(Math.abs(this.lastSent.x - x) <= 1 && Math.abs(this.lastSent.y - y) <= 1)
    this.lastSent = { x, y }
    if (!moved) return undefined
    return { x, y, velocityX: sprite.body.velocity.x, velocityY: sprite.body.velocity.y }
  }

  public playerMoved(id: string, x: number, y: number, velocityX: number, velocityY: number) {
    const player = this.remotePlayers.find((p) => p.id === id)
    if (!player || this.hidden.has(id)) return
    if (!player.placed) {
      // First known position: appear there rather than sliding in from wherever the body was
      player.sprite.setPosition(x, y)
      this.setPlaced(player, true)
      player.sprite.body.reset(x, y)
    }
    player.sprite.x = x
    player.sprite.y = y
    player.sprite.body.setVelocity(velocityX, velocityY)
  }

  /** Puts a remote orb at a point (its start slot at the snap) until its own updates arrive. */
  public placeRemote(id: string, point: Point) {
    const player = this.remotePlayers.find((p) => p.id === id)
    if (!player || !player.placed) return
    player.sprite.setPosition(point.x, point.y)
    player.sprite.body.reset(point.x, point.y)
  }

  /**
   * Stops remote orbs integrating their last velocity (after the round ended, when their owners
   * are frozen too), or lets them move again.
   */
  public freezeRemotes(frozen: boolean) {
    this.remotePlayers.forEach((player) => {
      player.sprite.body.moves = !frozen
      if (frozen) player.sprite.body.stop()
    })
  }

  /** The local and every placed remote player, for end-of-round effects. */
  public allPresent(): Array<Player> {
    const all = this.remotePlayers.filter((player) => player.placed)
    if (this.localPlayer) all.unshift(this.localPlayer)
    return all
  }

  public playerLeft(id: string) {
    const playerToRemove = this.remotePlayers.find((player) => player.id === id)
    if (!playerToRemove) return
    playerToRemove.sprite.destroy()
    playerToRemove.visuals.destroy()
    this.bumps.forget(id)
    this.remotePlayers.splice(this.remotePlayers.indexOf(playerToRemove), 1)
    this.scene.events.emit('message', `${playerToRemove.name} left`)
  }

  /**
   * One physics step for the local orb, run on 'worldstep' after the step has moved bodies and
   * resolved contacts. Velocities set here take effect on the next step. While `locked` (start
   * countdown) presses are dropped and nothing is applied.
   */
  public step(locked: boolean) {
    this.steps++
    const player = this.localPlayer
    if (!player) return
    const body = player.sprite.body
    if (locked) {
      this.clearLatches()
      body.setAccelerationX(0)
      return
    }

    const input: InputFrame = {
      left: this.controls.left.some((key) => key.isDown),
      right: this.controls.right.some((key) => key.isDown),
      flapPressed: this.latches.flap,
      dashPressed: this.latches.dash,
      stallPressed: this.latches.stall,
    }
    this.clearLatches()

    const out = stepPilot(this.pilot, input, { x: body.velocity.x, y: body.velocity.y })
    this.pilot = out.state
    const velocity = body.center.y > this.seaY ? seaDrag(out.velocity) : out.velocity
    // Circle-on-rect contact never settles under gravity at 120 Hz: the orb sinks a little, gets
    // pushed out, and repeats. Standing still on ground, park it with gravity off instead.
    const resting = isResting(velocity.y, this.restsOnGround(body))
    body.setAllowGravity(!resting)
    body.setVelocity(velocity.x, resting ? 0 : velocity.y)
    body.setAccelerationX(out.accelX)

    out.events.forEach((e) => {
      if (e.kind === 'dash') this.emitDash(e.dir)
      else this.emitLocal(e.kind)
    })
  }

  /** Per display frame: UI-only keys. */
  public update() {
    if (Phaser.Input.Keyboard.JustDown(this.controls.scoreboard)) {
      this.scene.events.emit('openScoreboard')
    } else if (Phaser.Input.Keyboard.JustUp(this.controls.scoreboard)) {
      this.scene.events.emit('closeScoreboard')
    }
  }

  /** Runs on the scene's post-update, after the physics step has moved the sprites. */
  public updateVisuals() {
    this.localPlayer?.visuals.update()
    this.remotePlayers.forEach((player) => player.visuals.update())
  }

  public applyQuality(quality: QualityProfile) {
    this.quality = quality
    this.localPlayer?.visuals.applyQuality(quality)
    this.remotePlayers.forEach((player) => player.visuals.applyQuality(quality))
  }

  public static generatePlayerId(): string {
    return '_' + Math.random().toString(36).substr(2, 9)
  }
}
