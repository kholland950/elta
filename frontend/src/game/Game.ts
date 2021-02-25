import { HUDScene } from './HUDScene'
import { MainScene } from './MainScene'

const gameConfig: Phaser.Types.Core.GameConfig = {
  title: 'Sample',

  type: Phaser.AUTO,

  scale: {
    mode: Phaser.Scale.RESIZE,
    resolution: window.devicePixelRatio || 1,
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

  scene: [MainScene, HUDScene],
}

const startGame = () => {
  return new Phaser.Game(gameConfig)
}

export { startGame }
