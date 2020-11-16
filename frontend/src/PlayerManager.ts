const emitterConfig: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
    lifespan: 300,
    gravityY: 2000,
    blendMode: 'SCREEN',
    scale: { start: 0.3, end: 0.2 },
    on: false
}

type Player = {
    sprite: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body }
    text: Phaser.GameObjects.Text
    isLocal: boolean
    name: string
    particles: Phaser.GameObjects.Particles.ParticleEmitterManager
}

export class PlayerManager {
    private players: Array<Player> = []
    private scene: Phaser.Scene
    private controls: {
        left: Phaser.Input.Keyboard.Key
        right: Phaser.Input.Keyboard.Key
        jump: Phaser.Input.Keyboard.Key
    }

    constructor(scene: Phaser.Scene) {
        this.scene = scene
        this.controls = {
            left: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            jump: this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        }
    }

    public addPlayer(color: string, name: string, isLocal: boolean = false) {
        const player: Player = { particles: this.scene.add.particles(color) } as any
        player.particles.createEmitter(emitterConfig)

        player.sprite = this.scene.add.sprite(400, 400, color) as any
        player.isLocal = isLocal
        player.name = name

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

        this.players.push(player)
    }

    public update() {
        this.scene.physics.collide(this.players[0].sprite, this.players[1].sprite)

        this.players.forEach(player => {
            player.text.setPosition(player.sprite.x - 25, player.sprite.y - 100)

            if (player.isLocal) {
                if (Math.abs(player.sprite.body.velocity.x) > 10 || Math.abs(player.sprite.body.velocity.y) > 10) {
                    player.particles.emitParticleAt(player.sprite.x, player.sprite.y, 1)
                }

                if (Phaser.Input.Keyboard.JustDown(this.controls.jump)) {
                    player.sprite.body.setVelocityY(-1000);
                } else {
                    player.sprite.body.setAccelerationY(0);
                }

                if (this.controls.right.isDown) {
                    player.sprite.body.setAccelerationX(1200);
                } else if (this.controls.right.isDown) {
                    player.sprite.body.setAccelerationX(-1200);
                } else {
                    player.sprite.body.setAccelerationX(0);
                }
            }
        })
    }
}
