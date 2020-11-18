import { PlayerManager } from './PlayerManager'

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
    active: false,
    visible: false,
    key: 'Game',
};

function ID () {
  return '_' + Math.random().toString(36).substr(2, 9);
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
            const message = JSON.parse(event.data)
            if (message.event === 'newPlayer') {
                this.playerManager.addPlayer(message.data)
            } else if (message.event === 'playerMove') {
                this.playerManager.playerMoved(message.data)
            } else if (message.event === 'gameState') {
                this.playerManager.updateGameState(message.data)
            } else if (message.event === 'playerLeft') {
                this.playerManager.playerLeft(message.data)
            }
        }
    }

    public create() {
        this.playerManager = new PlayerManager(this)
        const [color, name] = window.location.hash.slice(1).split(',')
        this.playerManager.addPlayer({
            id: ID(),
            color,
            name,
            isLocal: true,
            x: 400,
            y: 400
        })
    }

    public update() {
        this.playerManager.update()
    }
}
