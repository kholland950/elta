import Phaser from 'phaser'
import { BroadcastingFeelSink } from 'game/BroadcastingFeelSink'
import { MessageBroker } from 'game/MessageBroker'
import { PlayerManager } from 'game/PlayerManager'
import { RaceDirector } from 'game/RaceDirector'
import events from 'app/events'
import { loadQuality, QualityLevel, QualityProfile, qualityProfile } from 'game/fx/quality'
import { generateStage } from 'game/race/generateStage'
import type { Stage } from 'game/race/stage'
import { parseStageParams, randomSeed, StageParams, withStageParams } from 'game/race/stageParams'
import { BackgroundRenderer } from 'game/render/BackgroundRenderer'
import { CameraFX } from 'game/render/CameraFX'
import { EffectsDirector } from 'game/render/EffectsDirector'
import { EnergySea } from 'game/render/EnergySea'
import { StageRenderer } from 'game/render/StageRenderer'
import { StageWorld } from 'game/stage/StageWorld'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
  active: false,
  visible: false,
  key: 'Game',
}

export class MainScene extends Phaser.Scene {
  playerManager: PlayerManager
  messageBroker: MessageBroker
  /** Draws every player's action effects; relayed remote actions are emitted straight to it. */
  effects: EffectsDirector
  localId: string
  raceDirector: RaceDirector
  /** The stage being raced; replaced on restart. */
  stage: Stage
  private quality: QualityProfile
  private background?: BackgroundRenderer
  private cameraFX: CameraFX
  private stageWorld?: StageWorld
  private stageRenderer?: StageRenderer
  private sea?: EnergySea

  constructor() {
    super(sceneConfig)
  }

  public preload() {
    const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
    colors.forEach((color) => this.load.image(color, `/static/assets/${color}Light.png`))

    this.load.atlas('flares', '/static/assets/flares.png', '/static/assets/flares.json');
  }

  public create() {
    this.quality = this.qualityProfile(loadQuality(window.localStorage))
    this.cameraFX = new CameraFX(this.cameras.main, this.quality)

    // The local id is chosen here so the broadcaster knows it before the local player exists.
    // Incoming messages only arrive after the socket opens, by which time the player manager is set.
    this.localId = PlayerManager.generatePlayerId()
    this.effects = new EffectsDirector(this, this.cameraFX, this.quality)
    this.messageBroker = new MessageBroker(this)
    const feel = new BroadcastingFeelSink(this.effects, this.messageBroker, this.localId)
    this.playerManager = new PlayerManager(this, this.quality, feel)
    this.effects.setVisualsLookup((id) => this.playerManager.visualsFor(id), this.localId)
    this.raceDirector = new RaceDirector(
      () => this.playerManager.localSprite,
      () => this.playerManager.resetPilot(),
    )
    const color = window.localStorage.getItem('color') || 'Blue'
    const name = window.localStorage.getItem('name') || 'no name'
    // Placed properly at its start slot by the race director on the first step
    this.playerManager.addPlayer(color, name, true, 0, 0, this.localId)
    this.loadStage(parseStageParams(window.location.search))

    // Every movement rule runs once per fixed physics step, after the step moved the bodies
    const onStep = () => {
      this.raceDirector.step()
      this.playerManager.step(this.raceDirector.locked)
    }
    this.physics.world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep)

    this.input.keyboard!.on('keydown-R', (event: KeyboardEvent) => {
      if (!event.repeat) this.loadStage({ seed: randomSeed(), difficulty: this.stage.difficulty })
    })

    // Physics moves sprites in its own post-update, which was registered before this one
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.playerManager.updateVisuals())

    events.add('qualityChanged', (level: QualityLevel) =>
      this.applyQuality(this.qualityProfile(level)),
    )
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      events.remove('qualityChanged')
      this.physics.world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep)
    })
  }

  /** Builds (or rebuilds) the stage for a seed and starts a solo round on it. */
  private loadStage(params: StageParams) {
    this.stageWorld?.destroy()
    this.stageRenderer?.destroy()
    this.sea?.destroy()
    this.background?.destroy()

    const stage = generateStage(params.seed, params.difficulty)
    this.stage = stage
    const { bounds } = stage
    this.cameras.main.setBounds(bounds.x, bounds.y, bounds.w, bounds.h)
    this.background = new BackgroundRenderer(this, bounds, this.quality)
    this.stageWorld = new StageWorld(this, stage)
    this.stageRenderer = new StageRenderer(this, stage)
    this.sea = new EnergySea(this, stage)
    this.playerManager.setSeaY(stage.seaY)

    const sprite = this.playerManager.localSprite
    if (sprite) {
      this.stageWorld.attach(sprite, { onSurface: () => this.playerManager.touchedSurface() })
    }
    const slot = stage.startSlots[0]
    this.raceDirector.start(this.stageWorld.gate, slot)
    this.cameras.main.centerOn(slot.x, slot.y)

    // Keep the URL pointing at this stage so it can be shared or reloaded
    const search = withStageParams(window.location.search, { seed: stage.seed, difficulty: stage.difficulty })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
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
    this.playerManager.applyQuality(quality)
  }

  public update() {
    this.playerManager.update()
  }
}
