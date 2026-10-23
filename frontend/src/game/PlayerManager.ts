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
import { FeelSink, restoresCharge } from 'game/fx/feelEvents'
import { PhysicsSprite, PlayerVisuals } from 'game/render/PlayerVisuals'

const playerConfig = {
  startingPosition: { x: 400, y: 400 },
  scale: 0.1,
  hitboxOffset: 125,
  hitboxRadius: 70,
  physics: {
    friction: 800,
    drag: 200,
    bounce: 0.4,
    maxSpeed: 2000,
    dashSpeed: 1500,
    dashesAllowed: 2,
    acceleration: 3000,
    jumpVelocity: 1000,
  },
}

export interface Player {
  sprite: PhysicsSprite
  visuals: PlayerVisuals
  id: string
  color: string
  isLocal: boolean
  name: string
}

let lastX: number = 0
let lastY: number = 0

export class PlayerManager {
  private remotePlayers: Array<Player> = []
  private localPlayer: Player
  private scene: MainScene
  private quality: QualityProfile
  private feel: FeelSink
  private controls: {
    left: Array<Phaser.Input.Keyboard.Key>
    right: Array<Phaser.Input.Keyboard.Key>
    jump: Array<Phaser.Input.Keyboard.Key>
    dash: Phaser.Input.Keyboard.Key
    stall: Phaser.Input.Keyboard.Key
    scoreboard: Phaser.Input.Keyboard.Key
  }
  private state: {
    canStall: boolean
    dashes: number
  }

  constructor(scene: MainScene, quality: QualityProfile, feel: FeelSink) {
    this.scene = scene as any
    this.quality = quality
    this.feel = feel
    this.state = {
      canStall: false,
      dashes: 2,
    }
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
      jump: [
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      ],
      dash: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      stall: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      scoreboard: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
    }
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
      (body: Physics.Arcade.Body, up: Boolean, down: Boolean, left: Boolean, right: Boolean) => {
        if (body == player.sprite.body && (left || right || down)) {
          this.recharge()
        }
      },
    )
  }

  /** The visuals of the local or a remote player, if that player is currently in the game. */
  public visualsFor(id: string): PlayerVisuals | undefined {
    if (this.localPlayer?.id === id) return this.localPlayer.visuals
    return this.remotePlayers.find((player) => player.id === id)?.visuals
  }

  /** Restores stall and dashes; feedback only fires when something was actually used up. */
  private recharge() {
    const restored = restoresCharge(this.state, playerConfig.physics.dashesAllowed)
    this.state.canStall = true
    this.state.dashes = playerConfig.physics.dashesAllowed
    if (restored) this.emitLocal('recharge')
  }

  private emitLocal(kind: 'flap' | 'stall' | 'recharge') {
    const { id: playerId, sprite } = this.localPlayer
    this.feel.emit({ kind, playerId, x: sprite.x, y: sprite.y })
  }

  private emitDash(dir: 1 | -1) {
    const { id: playerId, sprite } = this.localPlayer
    this.feel.emit({ kind: 'dash', playerId, x: sprite.x, y: sprite.y, dir })
  }

  private addRemotePlayer(player: Player) {
    this.remotePlayers.push(player)
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
      playerConfig.physics.maxSpeed,
      this.quality,
    )

    if (isLocal) {
      this.addLocalPlayer(player)
    } else {
      this.addRemotePlayer(player)
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
    this.scene.physics.add.existing(player.sprite)

    player.sprite.body.setCircle(
      playerConfig.hitboxOffset,
      playerConfig.hitboxOffset,
      playerConfig.hitboxOffset,
    )
    player.sprite.body.setFriction(playerConfig.physics.friction, playerConfig.physics.friction)
    player.sprite.body.setDrag(playerConfig.physics.drag, playerConfig.physics.drag)
    player.sprite.body.setCollideWorldBounds(true)
    player.sprite.body.setBounce(playerConfig.physics.bounce, playerConfig.physics.bounce)
    player.sprite.body.setMaxSpeed(playerConfig.physics.maxSpeed)
  }

  public updateGameState(players: Array<PlayerDataMessage>) {
    players?.forEach((player) => {
      if (!this.remotePlayers.find((p) => p.id === player.id)) {
        this.addPlayer(player.color, player.name, false, player.x, player.y, player.id)
      }
    })
  }

  private getPlayerPosition(player: Player): PlayerMoveMessage | undefined {
    let playerPostion: PlayerMoveMessage | undefined = undefined
    if (Math.abs(lastX - player.sprite.x) > 1 || Math.abs(lastY - player.sprite.y) > 1) {
      playerPostion = {
        playerId: player.id,
        x: player.sprite.x,
        y: player.sprite.y,
        velocityX: player.sprite.body.velocity.x,
        velocityY: player.sprite.body.velocity.y,
      }
    }
    lastX = player.sprite.x
    lastY = player.sprite.y
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

    const index = this.remotePlayers.indexOf(playerToRemove as Player, 0)
    if (index > -1) {
      this.remotePlayers.splice(index, 1)
      this.scene.events.emit('message', `${playerToRemove?.name} left`)
    }
  }

  public update() {
    this.scene.physics.collide(
      this.remotePlayers.map((player) => player.sprite).concat(this.localPlayer.sprite),
      undefined,
      (p1, p2) => {
        const body1 = p1 as Phaser.Types.Physics.Arcade.GameObjectWithBody
        const body2 = p2 as Phaser.Types.Physics.Arcade.GameObjectWithBody
        if (body1.body === this.localPlayer.sprite.body || body2.body === this.localPlayer.sprite.body) {
          const otherBody = body1.body === this.localPlayer.sprite.body ? body2.body : body1.body
          const other = this.remotePlayers.find((player) => player.sprite.body === otherBody)
          if (other) {
            this.feel.emit({
              kind: 'collision',
              playerId: this.localPlayer.id,
              otherId: other.id,
              x: body1.body.center.x,
              y: body1.body.center.y,
            })
          }
          this.recharge()

          if (body1.body.x > body2.body.x) {
            body1.body.velocity.add({ x: 500, y: 800})
            body2.body.velocity.add({ x: -500, y: 800})
          } else {
            body1.body.velocity.add({ x: -500, y: 800})
            body2.body.velocity.add({ x: 500, y: 800})
          }
        }
      },
    )

    //controls
    if (this.jump()) {
      this.localPlayer.sprite.body.setVelocityY(-playerConfig.physics.jumpVelocity)
      this.emitLocal('flap')
    } else {
      this.localPlayer.sprite.body.setAccelerationY(0)
    }

    if (this.openScoreboard()) {
      this.scene.events.emit('openScoreboard')
    } else if (this.closeScoreboard()) {
      this.scene.events.emit('closeScoreboard')
    }

    if (this.right()) {
      this.localPlayer.sprite.body.setAccelerationX(playerConfig.physics.acceleration)
      if (this.dash()) {
        this.localPlayer.sprite.body.setVelocityX(playerConfig.physics.dashSpeed)
        this.state.dashes -= 1
        this.emitDash(1)
      }
    } else if (this.left()) {
      this.localPlayer.sprite.body.setAccelerationX(-playerConfig.physics.acceleration)
      if (this.dash()) {
        this.localPlayer.sprite.body.setVelocityX(-playerConfig.physics.dashSpeed)
        this.state.dashes -= 1
        this.emitDash(-1)
      }
    } else if (this.stall()) {
      this.localPlayer.sprite.body.setVelocity(0, 0)
      this.state.canStall = false
      this.emitLocal('stall')
    } else {
      this.localPlayer.sprite.body.setAccelerationX(0)
    }
  }

  private stall() {
    return this.state.canStall && Phaser.Input.Keyboard.DownDuration(this.controls.stall, 500)
  }

  private dash() {
    return this.state.dashes > 0 && Phaser.Input.Keyboard.JustDown(this.controls.dash)
  }

  private jump() {
    return this.controls.jump.some((key) => Phaser.Input.Keyboard.JustDown(key))
  }

  private left() {
    return this.controls.left.some((key) => key.isDown)
  }

  private right() {
    return this.controls.right.some((key) => key.isDown)
  }

  private openScoreboard() {
    return Phaser.Input.Keyboard.JustDown(this.controls.scoreboard)
  }

  private closeScoreboard() {
    return Phaser.Input.Keyboard.JustUp(this.controls.scoreboard)
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
