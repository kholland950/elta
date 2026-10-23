import Phaser from 'phaser'
import { formatRaceTime } from 'game/race/round'
import type { RaceView } from 'game/RaceDirector'

const RUNNING_COLOR = '#e8f6ff'
const FINISHED_COLOR = '#f4ff6b'

/** Race clock, top centre. Text is only rewritten when the shown value changes. */
export class RaceTimer {
  private text: Phaser.GameObjects.Text
  private shown = ''

  constructor(private readonly scene: Phaser.Scene) {
    this.text = scene.add
      .text(scene.scale.width / 2, 16, '', {
        font: '28px monospace',
        color: RUNNING_COLOR,
        stroke: '#001018',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(900)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
  }

  private layout(size: Phaser.Structs.Size) {
    this.text.setX(size.width / 2)
  }

  public update(view: RaceView) {
    const visible = view.phase.kind === 'race' || view.phase.kind === 'countdown'
    const label = !visible
      ? ''
      : view.finishedMs !== undefined
        ? `FINISH ${formatRaceTime(view.finishedMs)}`
        : formatRaceTime(view.raceMs)
    if (label === this.shown) return
    this.shown = label
    this.text.setText(label)
    this.text.setColor(view.finishedMs !== undefined ? FINISHED_COLOR : RUNNING_COLOR)
  }

  public destroy() {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.text.destroy()
  }
}
