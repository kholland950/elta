import 'phaser';

export class GameScene extends Phaser.Scene {
  private player: Phaser.GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };
  private particles: Phaser.GameObjects.Particles.ParticleEmitterManager;

  constructor() {
    super(sceneConfig);
  }

  public create() {
    this.particles = this.add.particles('Blue')

    this.particles.createEmitter({lifespan: 300, gravityY: 2000, blendMode: 'SCREEN', scale: { start: 0.3, end: 0.2 }, on: false })

    this.player = this.add.sprite(400, 400, 'Blue') as any;
    this.player.setScale(0.4)
    this.player.setTint(0xFFFFFFFF)
    this.physics.add.existing(this.player);
    this.player.body.setCircle(125, 70, 70)
    this.player.body.setDrag(500, 300);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setBounce(.4, .4)
    this.player.body.setMaxSpeed(2000)
  }

  public preload() {
    const colors = ['Blue', 'Green', 'Orange', 'Red', 'Violet', 'Yellow']
    colors.forEach(color => this.load.image(color, `assets/${color}Light.png`))
  }

  public update() {
    const keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    const keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    const space = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    if (Math.abs(this.player.body.velocity.x) > 10 || Math.abs(this.player.body.velocity.y) > 10) {
      this.particles.emitParticleAt(this.player.x, this.player.y, 1)
    }

    if (Phaser.Input.Keyboard.JustDown(space)) {
      this.player.body.setVelocityY(-1000);
    } else {
      this.player.body.setAccelerationY(0);
    }

    if (keyD.isDown) {
      this.player.body.setAccelerationX(1200);
    } else if (keyA.isDown) {
      this.player.body.setAccelerationX(-1200);
    } else {
      this.player.body.setAccelerationX(0);
    }
  }
}

const gameConfig: Phaser.Types.Core.GameConfig = {
  title: 'Sample',

  type: Phaser.AUTO,

  scale: {
    width: window.innerWidth,
    height: window.innerHeight,
  },

  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,
      gravity: { x: 0, y: 2000 },
    },
  },

  parent: 'game',
  backgroundColor: '#000000',

  scene: GameScene,
};

const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
  active: false,
  visible: false,
  key: 'Game',
};

new Phaser.Game(gameConfig);
