import Phaser from 'phaser'
import events from 'app/events'
import type { MainScene } from 'game/MainScene'
import { Countdown } from 'game/render/hud/Countdown'
import { RaceTimer } from 'game/render/hud/RaceTimer'

// Refresh the ?perf readout a few times a second so the number is readable
const PERF_INTERVAL_MS = 250

type MessageObject = {
  id: string
  message: string
}

export class HUDScene extends Phaser.Scene {
  private messages: Array<MessageObject> = []
  private perfText?: Phaser.GameObjects.Text
  private perfElapsed = 0
  private worstFrame = 0
  private raceTimer: RaceTimer
  private countdown: Countdown
  private stageInfo: Phaser.GameObjects.Text
  private stageInfoShown = ''

  constructor() {
    super({
      key: 'HUD',
      active: true,
    })

    this.messages = []
  }

  public create() {
    const gameScene = this.scene.get('Game')
    this.raceTimer = new RaceTimer(this)
    this.countdown = new Countdown(this)
    this.stageInfo = this.add
      .text(10, this.scale.height - 10, '', { font: '14px monospace', color: '#7fb8c8' })
      .setOrigin(0, 1)
      .setDepth(900)
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.stageInfo.setY(size.height - 10))
    gameScene.events.on('message', (message: string, timeout: number) =>
      this.addMessage(message, timeout),
    )
    gameScene.events.on('openScoreboard', () => {
      events.send('showScoreboard', true)
    })
    gameScene.events.on('closeScoreboard', () => {
      events.send('showScoreboard', false)
    })

    if (new URLSearchParams(window.location.search).has('perf')) {
      const perfText = this.add
        .text(this.scale.width - 10, 10, '', { font: '16px monospace', color: '#00ff88' })
        .setOrigin(1, 0)
        .setDepth(1000)
      this.scale.on('resize', (size: Phaser.Structs.Size) => perfText.setX(size.width - 10))
      this.perfText = perfText
    }
  }

  public update(_time: number, delta: number) {
    this.updateRace()
    if (!this.perfText) return
    this.worstFrame = Math.max(this.worstFrame, delta)
    this.perfElapsed += delta
    if (this.perfElapsed < PERF_INTERVAL_MS) return

    const fps = this.game.loop.actualFps
    this.perfText.setText(`${fps.toFixed(0)} fps\nworst ${this.worstFrame.toFixed(1)} ms`)
    this.perfElapsed = 0
    this.worstFrame = 0
  }

  private updateRace() {
    const game = this.scene.get('Game') as MainScene
    const view = game.raceDirector?.view()
    if (!view) return
    this.raceTimer.update(view)
    this.countdown.update(view)
    const stage = game.stage
    const info = stage
      ? `seed ${stage.seed} | difficulty ${stage.difficulty} | R: new stage${view.finishedMs !== undefined ? ' - go again!' : ''}`
      : ''
    if (info !== this.stageInfoShown) {
      this.stageInfoShown = info
      this.stageInfo.setText(info)
    }
  }

  private addMessage(message: string, timeout: number = 5000) {
    const newY = this.messages.length * 25 + 10

    const text = this.add.text(10, newY, message, { font: '20px Comfortaa' })

    const messageId: string = '_' + Math.random().toString(36).substr(2, 9)
    this.messages.push({ message, id: messageId })

    setTimeout(() => {
      text.destroy()
      this.messages = this.messages.filter((message) => messageId !== message.id)
    }, timeout)
  }
}
