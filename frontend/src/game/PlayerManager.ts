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
  endJumpCut,
  freshPilot,
  PilotState,
  recharge,
  seaDrag,
  isResting,
  stepPilot,
} from 'game/race/movement'
import { BODY, STEP_MS } from 'game/race/tuning'
import { type Bindings, mouseCode } from 'game/input/bindings'
import { Controls } from 'game/input/controls'
import { gamepadHub } from 'game/input/gamepadHub'

/** Own position updates sent per second. */
export const MOVE_TPS = 32

/** Where the local orb's movement goes (the room connection); absent when playing solo. */
export interface MoveSink {
  sendMove(m: Omit<PlayerMoveMessage, 'playerId'>): void
}

/** How far the camera closes on the orb it follows each frame. */
export const FOLLOW_LERP = 0.2

/** Velocity change (px/s) too small to send on its own. */
const SAME_VELOCITY = 1

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

const isControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button, a, input, select, textarea, label') !== null

export class PlayerManager {
  private remotePlayers: Array<Player> = []
  private localPlayer: Player
  private scene: MainScene
  private quality: QualityProfile
  private feel: FeelSink
  /** Remote orbs, as an Arcade group so one overlap covers players who join later. */
  private remoteGroup: Physics.Arcade.Group
  private controls: Controls
  private scoreboardKey: Phaser.Input.Keyboard.Key
  /** Off while the options menu is open; the keyboard is switched off separately. */
  private mouseEnabled = true
  private pilot: PilotState = freshPilot()
  private bumps = new BumpCooldowns()
  /** Off from a round's end until the next stage, so a lapping winner can't bump the losers. */
  private bumpsEnabled = true
  /** Physics steps run since the scene started; the clock for bump cooldowns. */
  private steps = 0
  /** The last position and velocity sent; NaN means send on the next tick whatever it is. */
  private lastSent = { x: 0, y: 0, velocityX: 0, velocityY: 0 }
  /** Remote players in the other world (lobby room vs match-end view); not shown, moves ignored. */
  private hidden: ReadonlySet<string> = new Set()
  /** Y of the energy sea surface; below it the orb is slowed. */
  private seaY = Infinity
  private restsOnGround: (body: Phaser.Physics.Arcade.Body) => boolean = () => false

  constructor(
    scene: MainScene,
    quality: QualityProfile,
    feel: FeelSink,
    bindings: Bindings,
    private readonly moves?: MoveSink,
  ) {
    this.scene = scene
    this.quality = quality
    this.feel = feel
    this.remoteGroup = scene.physics.add.group()
    // Keyboard input is enabled by default in the game config
    const keyboard = this.scene.input.keyboard!
    this.scoreboardKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB)
    // Bound keys are read by physical position; stopping their default keeps the page from
    // scrolling on Space or the arrows
    this.controls = new Controls(bindings)
    keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      if (this.controls.keyDown(event.code, event.repeat)) event.preventDefault()
    })
    keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_UP, (event: KeyboardEvent) =>
      this.controls.keyUp(event.code),
    )
    // Mouse buttons are read off the whole window, since the lobby and results cards sit over
    // the canvas, but a click on a control is the control's. Releases count anywhere.
    const onMouseDown = (event: MouseEvent) => {
      if (!this.mouseEnabled || isControl(event.target)) return
      if (this.controls.keyDown(mouseCode(event.button), false)) event.preventDefault()
    }
    const onMouseUp = (event: MouseEvent) => {
      const code = mouseCode(event.button)
      // Stops the back and forward buttons navigating away when they are bound
      if (this.controls.isBound(code)) event.preventDefault()
      this.controls.keyUp(code)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    // Pad buttons arrive as Pad<N> codes through the same Controls; the hub blocks them in menus
    const offPad = gamepadHub.setGameSink(this.controls)
    // Destroying the whole game emits DESTROY but not SHUTDOWN, so the pad lets go on either
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, offPad)
    // Key-ups are missed while the window is unfocused
    const onBlur = () => this.controls.releaseAll()
    this.scene.game.events.on(Phaser.Core.Events.BLUR, onBlur)
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.game.events.off(Phaser.Core.Events.BLUR, onBlur)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      this.scene.events.off(Phaser.Scenes.Events.DESTROY, offPad)
      offPad()
    })
  }

  /** The options menu takes the mouse while it's open. */
  public setMouseEnabled(enabled: boolean) {
    this.mouseEnabled = enabled
  }

  /** New key bindings, from the options menu; held keys are let go. */
  public setBindings(bindings: Bindings) {
    this.controls.setBindings(bindings)
  }

  private addLocalPlayer(player: Player) {
    this.localPlayer = player
    this.followLocal()
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
      // A hidden tab pauses the game loop, so this orb freezes where it is and the tick above
      // stops. Others would keep dead-reckoning it on its last velocity, so tell them it stopped,
      // and send the real state again once the tab is back.
      const events = this.scene.game.events
      const onHidden = () => {
        const { x, y } = player.sprite
        this.lastSent = { x, y, velocityX: 0, velocityY: 0 }
        moves.sendMove(this.lastSent)
      }
      const onVisible = () => this.resendPosition()
      events.on(Phaser.Core.Events.HIDDEN, onHidden)
      events.on(Phaser.Core.Events.VISIBLE, onVisible)
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        events.off(Phaser.Core.Events.HIDDEN, onHidden)
        events.off(Phaser.Core.Events.VISIBLE, onVisible)
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

  /** Puts the camera back on the local orb (after the round-end replay followed someone else). */
  public followLocal() {
    if (this.localPlayer) this.scene.cameras.main.startFollow(this.localPlayer.sprite, false, FOLLOW_LERP, FOLLOW_LERP)
  }

  /** Bumps between the local orb and remote ones; off while a round's end plays out. */
  public setBumpsEnabled(enabled: boolean) {
    this.bumpsEnabled = enabled
  }

  /** The physics sprite (camera target) of the local or a placed remote player. */
  public spriteFor(id: string): PhysicsSprite | undefined {
    if (this.localPlayer?.id === id) return this.localPlayer.sprite
    const remote = this.remotePlayers.find((player) => player.id === id)
    return remote?.placed ? remote.sprite : undefined
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

  /** Drops held keys and pending presses, e.g. when a menu takes the keyboard. */
  public releaseInput() {
    this.scene.input.keyboard?.resetKeys()
    this.controls.releaseAll()
    this.scene.events.emit('closeScoreboard')
  }

  private clearLatches() {
    this.controls.clearLatches()
  }

  private bumped(other: PhysicsSprite) {
    const remote = this.remotePlayers.find((player) => player.sprite === other)
    const local = this.localPlayer
    if (!remote || !local || !this.bumpsEnabled) return
    if (!this.bumps.tryBump(remote.id, this.steps * STEP_MS)) return
    const v = bumpVelocity(
      { id: local.id, x: local.sprite.body.center.x, y: local.sprite.body.center.y },
      { id: remote.id, x: other.body.center.x, y: other.body.center.y },
    )
    local.sprite.body.setVelocity(v.x, v.y)
    this.pilot = endJumpCut(this.pilot)
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
    this.lastSent = { x: NaN, y: NaN, velocityX: NaN, velocityY: NaN }
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

  /**
   * The local position and velocity, when either has changed since last sent. Remote orbs coast on
   * the sent velocity, so a change of velocity alone must go out too: an orb that lands from a
   * straight-up jump stops moving, and without a last move saying so it would keep falling (and
   * sink through the floor) on everyone else's screen.
   */
  private movedSinceLastSend(): Omit<PlayerMoveMessage, 'playerId'> | undefined {
    const sprite = this.localPlayer?.sprite
    if (!sprite) return undefined
    const { x, y } = sprite
    const { x: velocityX, y: velocityY } = sprite.body.velocity
    const last = this.lastSent
    // NaN (a resend was asked for) compares false, so it counts as changed
    const same =
      Math.abs(last.x - x) <= 1 &&
      Math.abs(last.y - y) <= 1 &&
      Math.abs(last.velocityX - velocityX) <= SAME_VELOCITY &&
      Math.abs(last.velocityY - velocityY) <= SAME_VELOCITY
    if (same) return undefined
    this.lastSent = { x, y, velocityX, velocityY }
    return this.lastSent
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
    this.remotePlayers.forEach((player) => this.freeze(player, frozen))
  }

  /** One remote orb, as `freezeRemotes`: a remote winner moves again for its victory lap. */
  public freezeRemote(id: string, frozen: boolean) {
    const player = this.remotePlayers.find((p) => p.id === id)
    if (player) this.freeze(player, frozen)
  }

  private freeze(player: Player, frozen: boolean) {
    player.sprite.body.moves = !frozen
    if (frozen) player.sprite.body.stop()
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

    const input = this.controls.frame()

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
    if (Phaser.Input.Keyboard.JustDown(this.scoreboardKey)) {
      this.scene.events.emit('openScoreboard')
    } else if (Phaser.Input.Keyboard.JustUp(this.scoreboardKey)) {
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
