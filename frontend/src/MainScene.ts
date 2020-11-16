import { PlayerManager } from './PlayerManager'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
    active: false,
    visible: false,
    key: 'Game',
};

export class MainScene extends Phaser.Scene {
    private playerManager: PlayerManager

    constructor() {
        super(sceneConfig)
    }

    public preload() {
        const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
        colors.forEach(color => this.load.image(color, `assets/${color}Light.png`))
    }

    public create() {
        this.playerManager = new PlayerManager(this)
        this.playerManager.addPlayer('Blue', 'player1', true)
        this.playerManager.addPlayer('Green', 'player2')
    }

    public update() {
        this.playerManager.update()
    }
}
