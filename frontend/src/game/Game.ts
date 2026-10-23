import Phaser from 'phaser'
import { HUDScene } from './HUDScene'
import { MainScene } from './MainScene'
import { GRAVITY, STEP_HZ } from './race/tuning'

const gameConfig: Phaser.Types.Core.GameConfig = {
  title: 'elta',

  type: Phaser.AUTO,

  scale: {
    mode: Phaser.Scale.RESIZE,
  },

  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,
      gravity: { x: 0, y: GRAVITY },
      // Fixed physics rate: movement rules run once per step on 'worldstep', so the game plays
      // the same at any display refresh rate
      fps: STEP_HZ,
    },
  },

  parent: 'game',
  backgroundColor: '#000000',

  scene: [MainScene, HUDScene],
}

const startGame = () => {
  const game = new Phaser.Game(gameConfig)
  // Test hook: `?debugGame` exposes the game so a headless browser can inspect live state
  if (new URLSearchParams(window.location.search).has('debugGame')) {
    ;(window as unknown as { __PHASER_GAME__: Phaser.Game }).__PHASER_GAME__ = game
  }
  return game
}

export { startGame }
