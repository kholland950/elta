import Phaser from 'phaser'
import { MessageBroker } from 'game/MessageBroker'
import { PlayerManager } from 'game/PlayerManager'
import events from 'app/events'
import { loadQuality, QualityLevel, QualityProfile, qualityProfile } from 'game/fx/quality'
import { BackgroundRenderer } from 'game/render/BackgroundRenderer'
import { CameraFX } from 'game/render/CameraFX'
import { EffectsDirector } from 'game/render/EffectsDirector'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
  active: false,
  visible: false,
  key: 'Game',
}

export class MainScene extends Phaser.Scene {
  playerManager: PlayerManager
  messageBroker: MessageBroker
  private background: BackgroundRenderer
  private cameraFX: CameraFX
  private effects: EffectsDirector

  constructor() {
    super(sceneConfig)
  }

  public preload() {
    const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
    colors.forEach((color) => this.load.image(color, `/static/assets/${color}Light.png`))

    this.load.atlas('flares', '/static/assets/flares.png', '/static/assets/flares.json');
  }

  public create() {
    const worldSize = 4000
    this.physics.world.bounds.setTo(-worldSize / 2, -worldSize / 2, worldSize, worldSize)
    this.cameras.main.setBounds(-worldSize / 2, -worldSize / 2, worldSize, worldSize)

    const quality = this.qualityProfile(loadQuality(window.localStorage))
    this.background = new BackgroundRenderer(this, worldSize, quality)
    this.cameraFX = new CameraFX(this.cameras.main, quality)

    this.effects = new EffectsDirector(this, this.cameraFX, quality)
    this.playerManager = new PlayerManager(this, quality, this.effects)
    this.messageBroker = new MessageBroker(this)
    const color = window.localStorage.getItem('color') || 'Blue'
    const name = window.localStorage.getItem('name') || 'no name'
    this.playerManager.addPlayer(color, name, true, 0, worldSize / 2 - 100)
    const localVisuals = this.playerManager.localVisuals
    if (localVisuals) this.effects.setLocalPlayer(localVisuals)

    // Physics moves sprites in its own post-update, which was registered before this one
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => this.playerManager.updateVisuals())

    events.add('qualityChanged', (level: QualityLevel) =>
      this.applyQuality(this.qualityProfile(level)),
    )
    this.events.once(Phaser.Scenes.Events.DESTROY, () => events.remove('qualityChanged'))
  }

  private qualityProfile(level: QualityLevel): QualityProfile {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    return qualityProfile(level, reducedMotion)
  }

  private applyQuality(quality: QualityProfile) {
    this.background.applyQuality(quality)
    this.cameraFX.applyQuality(quality)
    this.effects.applyQuality(quality)
    this.playerManager.applyQuality(quality)
  }

  public update() {
    this.playerManager.update()
  }
}
