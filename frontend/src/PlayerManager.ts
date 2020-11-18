const emitterConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
    lifespan: 3000,
    gravityY: 2000,
    blendMode: 'SCREEN',
    scale: { start: 0.3, end: 0.2 },
    on: false
}

interface Player {
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
    private scene: Phaser.Scene & { socket: WebSocket }
    private controls: {
        left: Phaser.Input.Keyboard.Key
        right: Phaser.Input.Keyboard.Key
        jump: Phaser.Input.Keyboard.Key
    }

    constructor(scene: Phaser.Scene) {
        this.scene = scene as any
        this.controls = {
            left: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            jump: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        }
    }


    private addLocalPlayer(player: Player) {
        this.localPlayer = player
        this.scene.socket.send(JSON.stringify({
            event: 'newPlayer',
            data: {
                id: player.id,
                color: player.color,
                name: player.name
            }
        }))
        setInterval(this.sendPlayerPosition, 1000/20, this.scene, player)
    }

    private addRemotePlayer(player: Player) {
        this.remotePlayers.push(player)
    }

    public addPlayer(
        { id, color, name, isLocal, x, y}:
        { id: string, color: string, name: string, isLocal: boolean, x: number, y: number }
    ) {

        const player: Player = { particles: this.scene.add.particles(color) } as any
        player.particles.createEmitter(emitterConfig)

        player.sprite = this.scene.add.sprite(x || 400, y || 400, color) as any
        player.id = id
        player.isLocal = isLocal
        player.name = name
        player.color = color

        player.sprite.setScale(0.4)
        player.sprite.setTint(0xFFFFFFFF)

        this.scene.physics.add.existing(player.sprite)

        player.sprite.body.setCircle(125, 70, 70)
        player.sprite.body.setFriction(800, 800)
        player.sprite.body.setDrag(200, 200)
        player.sprite.body.setCollideWorldBounds(true)
        player.sprite.body.setBounce(.4, .4)
        player.sprite.body.setMaxSpeed(2000)

        player.text = this.scene.add.text(player.sprite.x - 50, player.sprite.y - 50, name, { fontFamily: 'Georgia, "Goudy Bookletter 1911", Times, serif' })

        if (isLocal) {
            this.addLocalPlayer(player)
        } else {
            this.addRemotePlayer(player)
        }
    }

    public updateGameState(
        { players }: { players: Array<any> }
    ) {
        players?.forEach(player => {
            if (!this.remotePlayers.find(p => p.id === player.id)) {
                this.addPlayer({ ...player, isLocal: false })
            }
        })
    }

    private sendPlayerPosition(scene: Phaser.Scene & { socket: WebSocket }, player: Player) {
        if (Math.abs(lastX - player.sprite.x) > 1 || Math.abs(lastY - player.sprite.y) > 1) {
            scene.socket.send(JSON.stringify({
                event: 'playerMove',
                data: {
                    playerId: player.id,
                    x: player.sprite.x,
                    y: player.sprite.y,
                    velocityX: player.sprite.body.velocity.x,
                    velocityY: player.sprite.body.velocity.y
                }
            }))
        }
        lastX = player.sprite.x
        lastY = player.sprite.y
    }

    public playerMoved(data: any) {
        const playerUpdated = this.remotePlayers.find(player => player.id === data.playerId)
        if (playerUpdated) {
            playerUpdated.sprite.x = data.x
            playerUpdated.sprite.y = data.y
            playerUpdated.sprite.body.setVelocityX(data.velocityX)
            playerUpdated.sprite.body.setVelocityY(data.velocityY)
        }
    }

    public playerLeft(data: any) {
        const playerToRemove = this.remotePlayers.find(player => player.id === data.playerId)
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
        if (Phaser.Input.Keyboard.JustDown(this.controls.jump)) {
            this.localPlayer.sprite.body.setVelocityY(-1000);
        } else {
            this.localPlayer.sprite.body.setAccelerationY(0);
        }

        if (this.controls.right.isDown) {
            this.localPlayer.sprite.body.setAccelerationX(1200);
        } else if (this.controls.left.isDown) {
            this.localPlayer.sprite.body.setAccelerationX(-1200);
        } else {
            this.localPlayer.sprite.body.setAccelerationX(0);
        }
    }

    private updatePlayer(player: Player) {
        player.text.setPosition(player.sprite.x - 25, player.sprite.y - 100)
        if (Math.abs(player.sprite.body.velocity.x) > 10 || Math.abs(player.sprite.body.velocity.y) > 10) {
            player.particles.emitParticleAt(player.sprite.x, player.sprite.y, 1)
        }
    }
}
