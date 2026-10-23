import type { MainScene } from 'game/MainScene'
import {
  MessageEventType,
  NewPlayerMessage,
  PlayerDataMessage,
  PlayerMoveMessage,
} from 'game/messages'
import Phaser from 'phaser'
import type { Physics } from 'phaser'
import events from 'app/events'
import type { QualityProfile } from 'game/fx/quality'
import type { FeelSink } from 'game/fx/feelEvents'
import { PhysicsSprite, PlayerVisuals } from 'game/render/PlayerVisuals'
import {
  BumpCooldowns,
  bumpVelocity,
  freshPilot,
  InputFrame,
  PilotState,
  recharge,
  seaDrag,
  stepPilot,
} from 'game/race/movement'
import { BODY, STEP_MS } from 'game/race/tuning'

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
  /** Y of the energy sea surface; below it the orb is slowed. */
  private seaY = Infinity

  constructor(scene: MainScene, quality: QualityProfile, feel: FeelSink) {
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
    this.scene.messageBroker.send(MessageEventType.NEW_PLAYER, {
      id: player.id,
      color: player.color,
      name: player.name,
    } as NewPlayerMessage)
    this.scene.messageBroker.schedule(MessageEventType.PLAYER_MOVE, this.getPlayerPosition, player)

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

  /** The visuals of the local or a remote player, if that player is currently in the game. */
  public visualsFor(id: string): PlayerVisuals | undefined {
    if (this.localPlayer?.id === id) return this.localPlayer.visuals
    return this.remotePlayers.find((player) => player.id === id)?.visuals
  }

  public setSeaY(seaY: number) {
    this.seaY = seaY
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
    events.send('addPlayer', { name, id })

    const player: Player = {} as any
    player.id = id
    player.isLocal = isLocal
    player.name = name
    player.color = color

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
  }

  public updateGameState(players: Array<PlayerDataMessage>) {
    players?.forEach((player) => {
      if (!this.remotePlayers.find((p) => p.id === player.id)) {
        this.addPlayer(player.color, player.name, false, player.x, player.y, player.id)
      }
    })
  }

  private getPlayerPosition = (player: Player): PlayerMoveMessage | undefined => {
    let playerPostion: PlayerMoveMessage | undefined = undefined
    const { x, y } = player.sprite
    if (Math.abs(this.lastSent.x - x) > 1 || Math.abs(this.lastSent.y - y) > 1) {
      playerPostion = {
        playerId: player.id,
        x,
        y,
        velocityX: player.sprite.body.velocity.x,
        velocityY: player.sprite.body.velocity.y,
      }
    }
    this.lastSent = { x, y }
    return playerPostion
  }

  public playerJoined(color: string, name: string, x: number, y: number, id: string) {
    this.addPlayer(color, name, false, x, y, id)
    this.scene.events.emit('message', `${name} joined`)
  }

  public playerMoved(id: string, x: number, y: number, velocityX: number, velocityY: number) {
    const playerUpdated = this.remotePlayers.find((player) => player.id === id)
    if (playerUpdated) {
      playerUpdated.sprite.x = x
      playerUpdated.sprite.y = y
      playerUpdated.sprite.body.setVelocityX(velocityX)
      playerUpdated.sprite.body.setVelocityY(velocityY)
    }
  }

  public playerLeft(id: string) {
    events.send('removePlayer', id)

    const playerToRemove = this.remotePlayers.find((player) => player.id === id)
    playerToRemove?.sprite.destroy()
    playerToRemove?.visuals.destroy()
    this.bumps.forget(id)

    const index = this.remotePlayers.indexOf(playerToRemove as Player, 0)
    if (index > -1) {
      this.remotePlayers.splice(index, 1)
      this.scene.events.emit('message', `${playerToRemove?.name} left`)
    }
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
    body.setVelocity(velocity.x, velocity.y)
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
