import { MessageBroker } from 'game/MessageBroker'
import { PlayerManager } from 'game/PlayerManager'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
  active: false,
  visible: false,
  key: 'Game',
}

export class MainScene extends Phaser.Scene {
  playerManager: PlayerManager
  messageBroker: MessageBroker

  constructor() {
    super(sceneConfig)
  }

  public preload() {
    const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
    colors.forEach((color) => this.load.image(color, `/static/assets/${color}Light.png`))

    this.load.image('bg', '/static/assets/spacebg.jpg')
    this.load.atlas('flares', '/static/assets/flares.png', '/static/assets/flares.json');
  }

  public create() {
    const worldSize = 4000
    this.physics.world.bounds.setTo(-worldSize / 2, -worldSize / 2, worldSize, worldSize)
    this.cameras.main.setBounds(-worldSize / 2, -worldSize / 2, worldSize, worldSize)

    this.add.tileSprite(0, 0, worldSize, worldSize, 'bg')

    this.playerManager = new PlayerManager(this)
    this.messageBroker = new MessageBroker(this)
    const color = window.localStorage.getItem('color') || 'Blue'
    const name = window.localStorage.getItem('name') || 'no name'
    this.playerManager.addPlayer(color, name, true, 0, worldSize / 2 - 100)
  }

  public update() {
    this.playerManager.update()
  }
}
