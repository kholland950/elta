import Phaser from 'phaser'
import type { RaceView } from 'game/RaceDirector'

/** How long "GO!" stays up after the start. */
const GO_SHOW_MS = 700
const COLORS: Record<string, string> = { '3': '#ff3df0', '2': '#ffb13d', '1': '#5ff6ff', 'GO!': '#f4ff6b' }

/** Big centred 3-2-1-GO. Each new label pops in with a short scale punch. */
export class Countdown {
  private text: Phaser.GameObjects.Text
  private shown = ''

  constructor(private readonly scene: Phaser.Scene) {
    this.text = scene.add
      .text(scene.scale.width / 2, scene.scale.height * 0.35, '', {
        // Separate fields: the `font` shorthand only keeps the first family name
        fontFamily: 'Comfortaa, sans-serif',
        fontSize: '120px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#001018',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(901)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
  }

  private layout(size: Phaser.Structs.Size) {
    this.text.setPosition(size.width / 2, size.height * 0.35)
  }

  public update(view: RaceView) {
    const { phase } = view
    let label = ''
    if (phase.kind === 'countdown') label = String(phase.digit)
    else if (phase.kind === 'race' && view.sinceGoMs !== undefined && view.sinceGoMs < GO_SHOW_MS) label = 'GO!'
    if (label === this.shown) return
    this.shown = label
    this.text.setText(label)
    if (!label) return
    this.text.setColor(COLORS[label] ?? '#ffffff')
    this.scene.tweens.killTweensOf(this.text)
    this.text.setScale(1.4).setAlpha(1)
    this.scene.tweens.add({ targets: this.text, scale: 1, duration: 220, ease: 'Back.Out' })
  }

  public destroy() {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.text.destroy()
  }
}
