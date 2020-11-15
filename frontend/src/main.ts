import 'phaser'

export class GameScene extends Phaser.Scene {
  private square: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };

  constructor() {
    super(sceneConfig);
  }

  public create() {
    this.square = this.add.rectangle(400, 400, 100, 100, 0xFFFFFF) as any;
    this.physics.add.existing(this.square);
    this.square.body.setDrag(500, 300);
    this.square.body.setCollideWorldBounds(true);
    this.square.body.setBounce(1, 1)
  }

  public update() {
    const cursorKeys = this.input.keyboard.createCursorKeys();

    if (Phaser.Input.Keyboard.JustDown(cursorKeys.space)) {
      this.square.body.setVelocityY(-1000);
    } else {
      this.square.body.setAccelerationY(0);
    }

    if (cursorKeys.right.isDown) {
      this.square.body.setAccelerationX(800);
    } else if (cursorKeys.left.isDown) {
      this.square.body.setAccelerationX(-800);
    } else {
      this.square.body.setAccelerationX(0);
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
      debug: true,
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

const game = new Phaser.Game(gameConfig);

// let game = new Phaser.Game(config)

// function preload() {

// }

// function create() {
//   // this.add.image(400, 300, 'sky');

//   var particles = this.add.particles('red');

//   var emitter = particles.createEmitter({
//     speed: 100,
//     scale: { start: 1, end: 0 },
//     blendMode: 'ADD'
//   });

//   var logo = this.physics.add(400, 100, 'logo');

//   logo.setVelocity(100, 200);
//   logo.setBounce(1, 1);
//   logo.setCollideWorldBounds(true);

//   emitter.startFollow(logo);
// }
