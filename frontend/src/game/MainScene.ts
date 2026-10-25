import Phaser from 'phaser'
import { BroadcastingFeelSink } from 'game/BroadcastingFeelSink'
import { PlayerManager } from 'game/PlayerManager'
import { RaceDirector, RaceView } from 'game/RaceDirector'
import events from 'app/events'
import { isQuickLineId, lineForSlot, QUICK_TEXT, quickChatMode, type ShownEnd } from 'game/chat/quickChat'
import { fromActionMessage, shouldShowRemote } from 'game/fx/actions'
import type { FeelSink } from 'game/fx/feelEvents'
import { loadQuality, QualityLevel, QualityProfile, qualityProfile } from 'game/fx/quality'
import { type Bindings, loadBindings } from 'game/input/bindings'
import { gamepadHub } from 'game/input/gamepadHub'
import { generateStage } from 'game/race/generateStage'
import { lobbyRoom } from 'game/race/lobbyRoom'
import { PathRecorder } from 'game/race/pathRecorder'
import {
  canVoteSkip,
  hiddenRemoteIds,
  lobbySlotIndex,
  MatchTracker,
  MatchView,
  planOf,
  remotePlayers,
  shownVotes,
  stageFor,
  startSlotIndex,
} from 'game/race/match'
import type { PlayerMoveMessage, RoundStartMessage } from 'game/race/protocol'
import type { RaceStage, Stage } from 'game/race/stage'
import { parseStageParams, randomSeed, stageArchetype, StageParams, withStageParams } from 'game/race/stageParams'
import type { RoomConnection } from 'game/net/RoomConnection'
import { BackgroundRenderer } from 'game/render/BackgroundRenderer'
import { CameraFX } from 'game/render/CameraFX'
import { ChatBubbles } from 'game/render/ChatBubbles'
import { EffectsDirector } from 'game/render/EffectsDirector'
import { EnergySea } from 'game/render/EnergySea'
import { GateRenderer } from 'game/render/GateRenderer'
import { PathRenderer } from 'game/render/PathRenderer'
import { ReplayCamera } from 'game/render/ReplayCamera'
import { ReplaySequence } from 'game/render/ReplaySequence'
import { RoundEndFX } from 'game/render/RoundEndFX'
import { StageRenderer } from 'game/render/StageRenderer'
import { StageWorld } from 'game/stage/StageWorld'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
  active: false,
  visible: false,
  key: 'Game',
}

/** Quick-chat slots on the number row; the D-pad's come from the gamepad hub. */
const QUICK_CHAT_KEYS: Readonly<Record<string, number>> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 }

/** Local id before the server has assigned one (and always, when playing solo). */
const PENDING_ID = 'local'

/** What the HUD scene reads each frame. */
export interface HudState {
  race: RaceView
  /** Null when playing solo. */
  room: {
    /** Round number, or null in the lobby sandbox. */
    round: number | null
    votes: { votes: number; needed: number; voted: boolean } | null
  } | null
  stage?: Stage
}

/**
 * The world. With a room connection the server drives it: the lobby sandbox, then each round's
 * explore, snap, countdown, race and end. Without one it runs a solo round (`?seed=`, `?diff=`,
 * R for a new stage), which is kept for development and headless checks.
 */
export class MainScene extends Phaser.Scene {
  playerManager: PlayerManager
  /** Draws every player's action effects; relayed remote actions are emitted straight to it. */
  effects: EffectsDirector
  localId: string
  raceDirector: RaceDirector
  /** The stage being raced; replaced on every new round (or R when solo). */
  stage: Stage
  private quality: QualityProfile
  private background?: BackgroundRenderer
  private cameraFX: CameraFX
  private roundFX: RoundEndFX
  private stageWorld?: StageWorld
  private stageRenderer?: StageRenderer
  private gateRenderer?: GateRenderer
  private sea?: EnergySea
  /** Every player's route through the current race, for the round-end replay. */
  private readonly recorder = new PathRecorder()
  private paths: PathRenderer
  private replay: ReplaySequence
  /** Subscribed from construction, so nothing sent before `create` is lost. */
  private readonly tracker?: MatchTracker
  /** Which stage is built (see `stageFor`). */
  private stageKey?: string
  /** The round whose end has been shown. */
  private endShown?: number
  /** That end while its stage is up; it decides what quick chat can say (see `quickChatMode`). */
  private shownEnd: ShownEnd | null = null
  private bubbles: ChatBubbles
  private reportedRound?: number
  private votedRound?: number
  private rosterSeen = false
  /** Pins the remote orbs to their bays; set for the current round. */
  private placeRemotes?: () => void
  /**
   * The latest move of each player received before `create`. Moves are only sent on change, so
   * one lost while loading leaves a player who is sitting still invisible until they move.
   */
  private earlyMoves?: Map<string, PlayerMoveMessage>
  private offEarlyMoves?: () => void

  constructor(private readonly conn?: RoomConnection) {
    super(sceneConfig)
    if (conn) {
      this.tracker = new MatchTracker(conn)
      const early = new Map<string, PlayerMoveMessage>()
      this.earlyMoves = early
      this.offEarlyMoves = conn.on('playerMove', (m) => early.set(m.playerId, m))
    }
  }

  public preload() {
    const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
    for (const color of colors) this.load.image(color, `/static/assets/${color}Light.png`)

    this.load.atlas('flares', '/static/assets/flares.png', '/static/assets/flares.json')
  }

  public create() {
    this.quality = this.qualityProfile(loadQuality(window.localStorage))
    this.cameraFX = new CameraFX(this.cameras.main, this.quality)

    const conn = this.conn
    this.localId = conn?.playerId ?? PENDING_ID
    this.effects = new EffectsDirector(this, this.cameraFX, this.quality)
    this.roundFX = new RoundEndFX(this, this.quality)
    const feel: FeelSink = conn
      ? new BroadcastingFeelSink(this.effects, conn, () => conn.playerId)
      : this.effects
    // Own movement goes out only once the server has accepted the join
    const moves = conn && {
      sendMove: (m: Parameters<RoomConnection['sendMove']>[0]) => {
        if (conn.playerId !== null) conn.sendMove(m)
      },
    }
    this.playerManager = new PlayerManager(this, this.quality, feel, loadBindings(window.localStorage), moves)
    this.effects.setVisualsLookup((id) => this.playerManager.visualsFor(id), this.localId)
    this.raceDirector = new RaceDirector(
      () => this.playerManager.localSprite,
      () => this.playerManager.resetPilot(),
    )
    this.paths = new PathRenderer(this)
    const players = this.playerManager
    this.replay = new ReplaySequence({
      camera: new ReplayCamera(this, () => players.followLocal()),
      paths: this.paths,
      players: {
        spriteFor: (id) => players.spriteFor(id),
        tintOf: (id) => players.visualsFor(id)?.tint,
        freezeRemote: (id, frozen) => players.freezeRemote(id, frozen),
      },
      director: this.raceDirector,
    })
    const color = window.localStorage.getItem('color') || 'Blue'
    const name = window.localStorage.getItem('name') || 'no name'
    // Placed at its slot when the first stage is built
    this.playerManager.addPlayer(color, name, true, 0, 0, this.localId)

    // Every movement rule runs once per fixed physics step, after the step moved the bodies
    const onStep = () => {
      this.raceDirector.step()
      // The body, not the sprite: within a frame of several steps the sprite only catches up after
      const sprite = this.playerManager.localSprite
      if (conn && sprite) this.recorder.record(this.localId, conn.serverNow(), sprite.body.center.x, sprite.body.center.y)
      // Everyone is held in their bay, so a late update can't pull a remote orb out of its own
      if (this.raceDirector.heldInBays) this.placeRemotes?.()
      this.stageWorld?.setGatesOpen(this.raceDirector.gatesOpen)
      this.playerManager.step(this.raceDirector.locked)
    }
    this.physics.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep)

    // Before connect: its first sync clears the bubbles
    this.bubbles = new ChatBubbles(this, (id) =>
      this.playerManager.isHidden(id) ? undefined : this.playerManager.visualsFor(id),
    )

    const offs = conn && this.tracker ? this.connect(conn, this.tracker) : this.startSolo()

    // Physics moves sprites in its own post-update, which was registered before this one
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.playerManager.updateVisuals()
      this.bubbles.update(this.time.now)
    })

    events.add('qualityChanged', (level: QualityLevel) =>
      this.applyQuality(this.qualityProfile(level)),
    )
    events.add('menuOpen', (open: boolean) => this.setMenuOpen(open))
    events.add('bindingsChanged', (bindings: Bindings) => this.playerManager.setBindings(bindings))
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      events.remove('qualityChanged')
      events.remove('menuOpen')
      events.remove('bindingsChanged')
      // The physics plugin can be torn down first when the whole game is destroyed
      this.physics.world?.off(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep)
      this.offEarlyMoves?.()
      for (const off of offs) off()
      this.tracker?.dispose()
      this.roundFX.destroy()
      this.paths.destroy()
      this.bubbles.clear()
    })
  }

  /** The options menu owns the keyboard while it's open; the race carries on without input. */
  private setMenuOpen(open: boolean) {
    const keyboard = this.input.keyboard!
    keyboard.enabled = !open
    this.playerManager.setMouseEnabled(!open)
    if (open) {
      // Let Tab and Space reach the menu's buttons
      keyboard.disableGlobalCapture()
      this.playerManager.releaseInput()
    } else {
      keyboard.enableGlobalCapture()
    }
  }

  /** Solo: the stage from the URL, and R for a new one. */
  private startSolo(): Array<() => void> {
    const params = parseStageParams(window.location.search)
    this.loadSoloStage(params)
    // A new stage keeps an asked-for `?arch=`; without one each seed brings its own archetype
    const archetype = params.archetype
    const onR = (event: KeyboardEvent) => {
      if (!event.repeat) {
        const seed = randomSeed()
        this.loadSoloStage(archetype ? { seed, difficulty: this.stage.difficulty, archetype } : { seed, difficulty: this.stage.difficulty })
      }
    }
    this.input.keyboard!.on('keydown-R', onR)
    return [() => this.input.keyboard?.off('keydown-R', onR)]
  }

  /** Multiplayer: the server's messages drive the world from here on. */
  private connect(conn: RoomConnection, tracker: MatchTracker): Array<() => void> {
    const offs = [
      conn.on('playerMove', (m) => {
        if (m.playerId !== this.localId) {
          this.playerManager.playerMoved(m.playerId, m.x, m.y, m.velocityX, m.velocityY)
          // Stamped on arrival, so a remote line lags by about the latency
          if (!this.playerManager.isHidden(m.playerId)) this.recorder.record(m.playerId, conn.serverNow(), m.x, m.y)
        }
      }),
      conn.on('playerAction', (m) => {
        // Relayed unvalidated by the server, so parse defensively
        const e = fromActionMessage(m)
        // A player in the other world (lobby room vs match-end view) acts in its coordinates
        if (e && shouldShowRemote(e, this.localId) && !this.playerManager.isHidden(e.playerId)) {
          this.effects.emit(e)
        }
      }),
    ]
    const onV = (event: KeyboardEvent) => {
      if (event.repeat) return
      const view = tracker.view
      if (!canVoteSkip(view) || !view.round) return
      this.votedRound = view.round.round
      conn.voteSkip(view.round.round)
    }
    this.input.keyboard!.on('keydown-V', onV)
    offs.push(() => this.input.keyboard?.off('keydown-V', onV))

    // Phaser's keyboard is off while the chat input or the menu is up, and so is the pad's play mode
    const onDigit = (event: KeyboardEvent) => {
      const slot = QUICK_CHAT_KEYS[event.code]
      if (slot && !event.repeat) this.quickChat(conn, slot)
    }
    this.input.keyboard!.on('keydown', onDigit)
    offs.push(() => this.input.keyboard?.off('keydown', onDigit))
    offs.push(gamepadHub.onQuickChat((slot) => this.quickChat(conn, slot)))
    offs.push(
      conn.on('chatMessage', (m) => {
        if (!m.quick || !isQuickLineId(m.text)) return
        if (quickChatMode(this.shownEnd, m.playerId, conn.serverNow())?.bubble) {
          this.bubbles.show(m.playerId, QUICK_TEXT[m.text], this.time.now)
        }
      }),
    )

    tracker.onChange((view) => this.sync(view))
    this.sync(tracker.view)
    // Moves that arrived while loading, now that the remote orbs exist
    this.offEarlyMoves?.()
    this.offEarlyMoves = undefined
    this.earlyMoves?.forEach((m) => {
      if (m.playerId !== this.localId) {
        this.playerManager.playerMoved(m.playerId, m.x, m.y, m.velocityX, m.velocityY)
      }
    })
    this.earlyMoves = undefined
    return offs
  }

  /** Sends the line in `slot` if quick chat has one for me right now. */
  private quickChat(conn: RoomConnection, slot: number) {
    const line = lineForSlot(quickChatMode(this.shownEnd, this.localId, conn.serverNow()), slot)
    if (line) conn.sendQuickChat(line)
  }

  /**
   * Brings the world in line with the room. Idempotent: safe to call after any message.
   * - the local id, once the server assigns it
   * - remote orbs for the room's other players, hiding those in the other world during the
   *   match-over wait (see `hiddenRemoteIds`)
   * - the stage: the lobby room in the lobby (and once I have returned to it), else the current
   *   round's, rebuilt when it changes
   * - the round's end, once per round and on the race stage only: celebrate and disintegrate,
   *   then the replay sequence (see ReplaySequence)
   */
  private sync(view: MatchView) {
    if (view.me && view.me !== this.localId) {
      this.localId = view.me
      this.playerManager.setLocalId(view.me)
      this.effects.setVisualsLookup((id) => this.playerManager.visualsFor(id), view.me)
    }
    // The first roster is who was already here, not who joined
    this.playerManager.syncRemotes(remotePlayers(view), this.rosterSeen)
    if (view.players.length > 0) this.rosterSeen = true
    // During the match-over wait, players who went back to the lobby room and those still on the
    // match-end view don't see each other
    this.playerManager.setHiddenRemotes(hiddenRemoteIds(view))

    const choice = stageFor(view)
    if (choice.key !== this.stageKey) {
      this.stageKey = choice.key
      this.endShown = undefined
      this.shownEnd = null
      this.bubbles.clear()
      this.replay.cancel()
      this.roundFX.cancel()
      this.playerManager.freezeRemotes(false)
      this.playerManager.setBumpsEnabled(true)
      for (const player of this.playerManager.allPresent()) this.roundFX.reform(player.visuals)
      if (choice.kind === 'race' && view.round && this.conn) {
        const stage = this.buildStage(generateStage(choice.seed, choice.difficulty, choice.bays, choice.archetype))
        this.startRound(this.conn, stage, view.round)
      } else {
        this.startSandbox(this.buildStage(lobbyRoom()), view)
      }
    }

    // Only on the race stage: a player who returned to the lobby room keeps playing there
    const ended = choice.kind === 'race' ? view.ended : null
    if (ended && this.endShown !== ended.round) {
      this.endShown = ended.round
      // An older server sends no endedAt: the sequence runs from when the end arrived
      const endedAt = ended.endedAt ?? this.conn?.serverNow() ?? 0
      this.shownEnd = { reason: ended.reason, winnerId: ended.winnerId, endedAt, replayMs: ended.replayMs }
      this.raceDirector.end()
      this.playerManager.freezeRemotes(true)
      // Until the next stage: the winner's lap mustn't knock the (invisible) losers about
      this.playerManager.setBumpsEnabled(false)
      this.playerManager.allPresent().forEach((player) => {
        if (player.id === ended.winnerId) this.roundFX.celebrate(player.visuals)
        else this.roundFX.disintegrate(player.visuals)
      })
      const conn = this.conn
      if (conn && ended.reason !== 'skipped') {
        const paths = this.recorder.finalize(endedAt, ended.times)
        const { finish } = this.stage
        const finishAt = finish && { x: (finish.x + finish.right) / 2, y: (finish.top + finish.bottom) / 2 }
        this.replay.start(ended, endedAt, this.stage.bounds, paths, this.localId, finishAt)
      }
    }
  }

  private startSandbox(stage: Stage, view: MatchView) {
    this.placeRemotes = undefined
    const slot = stage.startSlots[lobbySlotIndex(view, stage.startSlots.length)]
    this.raceDirector.startFree(slot)
    this.cameras.main.centerOn(slot.x, slot.y)
  }

  /**
   * A server round: every orb waits in its own start bay (the index in `startOrder`), starts
   * explore there with the gates open, returns to it at the snap, and leaves it at GO.
   */
  private startRound(conn: RoomConnection, stage: RaceStage, round: RoundStartMessage) {
    const slots = stage.startSlots
    const slot = slots[startSlotIndex(round.startOrder, this.localId, slots.length)]
    // Show the others in their bays straight away, not where they were in the lobby; their own
    // updates follow
    const placeRemotes = () => {
      for (const id of round.startOrder) {
        if (id === this.localId) continue
        this.playerManager.placeRemote(id, slots[startSlotIndex(round.startOrder, id, slots.length)])
      }
    }
    placeRemotes()
    this.placeRemotes = placeRemotes
    this.recorder.begin(round.goAt)
    this.raceDirector.startRound(stage.finish, slot, planOf(round), () => conn.serverNow(), {
      onFinish: (raceMs) => {
        if (this.reportedRound === round.round) return
        this.reportedRound = round.round
        conn.reportFinish(round.round, raceMs)
      },
      onExplore: () => {
        this.cameras.main.centerOn(slot.x, slot.y)
        placeRemotes()
      },
      onSnap: () => {
        // Cut straight to the start rather than panning back across the stage
        this.cameras.main.centerOn(slot.x, slot.y)
        placeRemotes()
      },
    })
    this.cameras.main.centerOn(slot.x, slot.y)
  }

  /** Builds (or rebuilds) the stage for a seed (one start bay) and starts a solo round on it. */
  private loadSoloStage(params: StageParams) {
    const stage = this.buildStage(generateStage(params.seed, params.difficulty, 1, stageArchetype(params)))
    const slot = stage.startSlots[0]
    this.raceDirector.startSolo(stage.finish, slot)
    this.cameras.main.centerOn(slot.x, slot.y)

    // Keep the URL pointing at this stage so it can be shared or reloaded
    const search = withStageParams(window.location.search, {
      seed: stage.seed,
      difficulty: stage.difficulty,
      ...(params.archetype ? { archetype: params.archetype } : {}),
    })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
  }

  /** Replaces the world: bodies, drawing, gates, sea and background for a new stage. */
  private buildStage<S extends Stage>(stage: S): S {
    this.stageWorld?.destroy()
    this.stageRenderer?.destroy()
    this.gateRenderer?.destroy()
    this.sea?.destroy()
    this.background?.destroy()

    this.stage = stage
    const { bounds } = stage
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.w, bounds.h)
    this.background = new BackgroundRenderer(this, bounds, this.quality)
    this.stageWorld = new StageWorld(this, stage)
    this.stageRenderer = new StageRenderer(this, stage)
    this.gateRenderer = new GateRenderer(this, stage.bays, this.quality, false)
    this.sea = new EnergySea(this, stage)
    this.playerManager.setSeaY(stage.seaY)
    const world = this.stageWorld
    this.playerManager.setGroundProbe((body) => world.restsOnGround(body))

    const sprite = this.playerManager.localSprite
    if (sprite) {
      this.stageWorld.attach(sprite, { onSurface: () => this.playerManager.touchedSurface() })
    }
    return stage
  }

  /** Everything the HUD shows, read once per frame. */
  public hud(): HudState {
    const race = this.raceDirector.view()
    const view = this.tracker?.view
    if (!view) return { race, room: null, stage: this.stage }
    const votes = shownVotes(view)
    return {
      race,
      room: {
        round: this.stage?.kind === 'lobby' ? null : (view.round?.round ?? null),
        votes: votes && { ...votes, voted: this.votedRound === view.round?.round },
      },
      stage: this.stage,
    }
  }

  private qualityProfile(level: QualityLevel): QualityProfile {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    return qualityProfile(level, reducedMotion)
  }

  private applyQuality(quality: QualityProfile) {
    this.quality = quality
    this.background?.applyQuality(quality)
    this.cameraFX.applyQuality(quality)
    this.effects.applyQuality(quality)
    this.roundFX.applyQuality(quality)
    this.gateRenderer?.applyQuality(quality)
    this.playerManager.applyQuality(quality)
  }

  public update(time: number, delta: number) {
    this.playerManager.update()
    if (this.conn) this.replay.update(this.conn.serverNow())
    this.gateRenderer?.update(time, delta, this.raceDirector.gatesOpen)
  }
}
