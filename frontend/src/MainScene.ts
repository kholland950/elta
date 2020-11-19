import { MessageBroker } from 'MessageBroker'
import { PlayerManager } from 'PlayerManager'

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
        colors.forEach(color => this.load.image(color, `assets/${color}Light.png`))
    }

    public create() {
        this.playerManager = new PlayerManager(this)
        this.messageBroker = new MessageBroker(this)
        const [color, name] = window.location.hash.slice(1).split(',')
        this.playerManager.addPlayer(
            color,
            name,
            true,
            400,
            400,
        )
    }

    public update() {
        this.playerManager.update()
    }
}
