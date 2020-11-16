import { MainScene } from './MainScene';

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

  scene: MainScene,
};

export default new Phaser.Game(gameConfig);
