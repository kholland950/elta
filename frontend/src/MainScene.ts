import { PlayerManager } from './PlayerManager'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
    active: false,
    visible: false,
    key: 'Game',
};

export class MainScene extends Phaser.Scene {
    private playerManager: PlayerManager
    private socket: WebSocket

    constructor() {
        super(sceneConfig)
    }

    public preload() {
        const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
        colors.forEach(color => this.load.image(color, `assets/${color}Light.png`))
        this.socket = new WebSocket('ws://localhost:3000/ws/game')

        this.socket.onmessage = event => {
            console.log(event.data)
            // const data = JSON.parse(event.data)
            const data = {}
            if (data.event === 'newPlayer') {
                this.playerManager.addPlayer(data.color, data.name)
            } else if (data.event === 'playerMove') {
                this.playerManager.playerMoved(data)
            }
        }
    }

    public create() {
        this.playerManager = new PlayerManager(this)
        const [color, name] = window.location.hash.slice(1).split(',')
        this.playerManager.addPlayer(color, name, true)
    }

    public update() {
        this.playerManager.update()
    }
}
