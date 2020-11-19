import { MainScene } from 'MainScene'
import { MessageEventType, NewPlayerMessage, PlayerDataMessage, PlayerMoveMessage } from 'messages'

const emitterConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
    lifespan: 1000,
    gravityY: 2000,
    blendMode: 'SCREEN',
    scale: { start: 0.1, end: 0 },
    on: false
}

const playerConfig = {
    startingPosition: { x: 400, y: 400 },
    scale: 0.1,
    hitboxOffset: 125,
    hitboxRadius: 70,
    textStyle: {
        fontFamily: 'sans-serif'
    },
    physics: {
        friction: 800,
        drag: 200,
        bounce: .4,
        maxSpeed: 2000,
        acceleration: 3000,
        jumpVelocity: 1000,
    }
}

export interface Player {
    sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body }
    text: Phaser.GameObjects.Text
    id: string
    color: string
    isLocal: boolean
    name: string
    particles: Phaser.GameObjects.Particles.ParticleEmitterManager
}

let lastX: number = 0
let lastY: number = 0

export class PlayerManager {
    private remotePlayers: Array<Player> = []
    private localPlayer: Player
    private scene: MainScene
    private controls: {
        left: Array<Phaser.Input.Keyboard.Key>
        right: Array<Phaser.Input.Keyboard.Key>
        jump: Array<Phaser.Input.Keyboard.Key>
    }

    constructor(scene: MainScene) {
        this.scene = scene as any
        this.controls = {
            left: [
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A)
            ],
            right: [
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
            ],
            jump: [
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
                this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
            ],
        }
    }

    private addLocalPlayer(player: Player) {
        this.localPlayer = player
        this.scene.messageBroker.send(
            MessageEventType.NEW_PLAYER,
            { id: player.id, color: player.color, name: player.name } as NewPlayerMessage
        )
        this.scene.messageBroker.schedule(
            MessageEventType.PLAYER_MOVE,
            this.getPlayerPosition,
            player
        )
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
        id = PlayerManager.generatePlayerId()
    ) {
        const player: Player = {} as any
        player.id = id
        player.isLocal = isLocal
        player.name = name
        player.color = color

        this.createParticles(player)

        this.createSprite(player, x, y)

        this.addPhysics(player)

        player.text = this.scene.add.text(player.sprite.x - 50, player.sprite.y - 50, name, playerConfig.textStyle)
        
        if (isLocal) {
            this.addLocalPlayer(player)
        } else {
            this.addRemotePlayer(player)
        }
    }

    private createParticles(player: Player) {
        player.particles = this.scene.add.particles(player.color)
        player.particles.createEmitter(emitterConfig)
    }

    private createSprite(player: Player, x: number, y: number) {
        player.sprite = this.scene.add.sprite(
            x || playerConfig.startingPosition.x,
            y || playerConfig.startingPosition.y,
            player.color) as any

        player.sprite.setScale(playerConfig.scale)
    }

    private addPhysics(player: Player) {
        this.scene.physics.add.existing(player.sprite)

        player.sprite.body.setCircle(playerConfig.hitboxOffset, playerConfig.hitboxOffset, playerConfig.hitboxOffset)
        player.sprite.body.setFriction(playerConfig.physics.friction, playerConfig.physics.friction)
        player.sprite.body.setDrag(playerConfig.physics.drag, playerConfig.physics.drag)
        player.sprite.body.setCollideWorldBounds(true)
        player.sprite.body.setBounce(playerConfig.physics.bounce, playerConfig.physics.bounce)
        player.sprite.body.setMaxSpeed(playerConfig.physics.maxSpeed)
    }

    public updateGameState(players: Array<PlayerDataMessage>) {
        players?.forEach(player => {
            if (!this.remotePlayers.find(p => p.id === player.id)) {
                this.addPlayer(player.color, player.name, false, 0, 0, player.id)
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
                velocityY: player.sprite.body.velocity.y
            }
        }
        lastX = player.sprite.x
        lastY = player.sprite.y
        return playerPostion
    }

    public playerMoved(id: string, x: number, y: number, velocityX: number, velocityY: number) {
        const playerUpdated = this.remotePlayers.find(player => player.id === id)
        if (playerUpdated) {
            playerUpdated.sprite.x = x
            playerUpdated.sprite.y = y
            playerUpdated.sprite.body.setVelocityX(velocityX)
            playerUpdated.sprite.body.setVelocityY(velocityY)
        }
    }

    public playerLeft(id: string) {
        const playerToRemove = this.remotePlayers.find(player => player.id === id)
        playerToRemove?.sprite.destroy()
        playerToRemove?.text.destroy()

        const index = this.remotePlayers.indexOf(playerToRemove as Player, 0);
        if (index > -1) {
            this.remotePlayers.splice(index, 1);
        }
    }

    public update() {
        this.scene.physics.collide(this.remotePlayers.map(player => player.sprite).concat(this.localPlayer.sprite))

        this.updatePlayer(this.localPlayer)
        this.remotePlayers.forEach(player => this.updatePlayer(player))

        //controls
        if (this.jump()) {
            this.localPlayer.sprite.body.setVelocityY(-playerConfig.physics.jumpVelocity);
        } else {
            this.localPlayer.sprite.body.setAccelerationY(0);
        }

        if (this.right()) {
            this.localPlayer.sprite.body.setAccelerationX(playerConfig.physics.acceleration);
        } else if (this.left()) {
            this.localPlayer.sprite.body.setAccelerationX(-playerConfig.physics.acceleration);
        } else {
            this.localPlayer.sprite.body.setAccelerationX(0);
        }
    }

    private jump() {
        return this.controls.jump.some(key => Phaser.Input.Keyboard.JustDown(key))
    }

    private left() {
        return this.controls.left.some(key => key.isDown)
    }

    private right() {
        return this.controls.right.some(key => key.isDown)
    }

    private updatePlayer(player: Player) {
        player.text.setPosition(player.sprite.x - 25, player.sprite.y - 100)
        if (Math.abs(player.sprite.body.velocity.x) > 10 || Math.abs(player.sprite.body.velocity.y) > 10) {
            player.particles.emitParticleAt(player.sprite.x, player.sprite.y, 1)
        }
    }

    private static generatePlayerId(): string {
        return '_' + Math.random().toString(36).substr(2, 9);
    }
}
