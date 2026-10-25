import Phaser from 'phaser'
import type { HudState } from 'game/MainScene'

const EXPLORE_COLOR = '#5ff6ff'
const VOTE_COLOR = '#7fb8c8'
const VOTED_COLOR = '#f4ff6b'

/**
 * Server-round readouts: the explore time left (top centre, where the race timer goes once the
 * countdown starts) and the skip vote (bottom left, under the chat). Text is only rewritten when it changes.
 */
export class RoundStatus {
  private explore: Phaser.GameObjects.Text
  private votes: Phaser.GameObjects.Text
  private exploreShown = ''
  private votesShown = ''

  constructor(private readonly scene: Phaser.Scene) {
    this.explore = scene.add
      .text(scene.scale.width / 2, 16, '', {
        font: '28px monospace',
        color: EXPLORE_COLOR,
        stroke: '#001018',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(900)
    this.votes = scene.add
      .text(10, scene.scale.height - 10, '', {
        font: '16px monospace',
        color: VOTE_COLOR,
        stroke: '#001018',
        strokeThickness: 3,
        align: 'left',
      })
      .setOrigin(0, 1)
      .setDepth(900)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this)
  }

  private layout(size: Phaser.Structs.Size) {
    this.explore.setX(size.width / 2)
    this.votes.setY(size.height - 10)
  }

  public update(hud: HudState) {
    const { race, room } = hud
    const exploreLabel =
      race.exploreLeftMs !== undefined
        ? `EXPLORE ${Math.ceil(race.exploreLeftMs / 1000)}`
        : ''
    if (exploreLabel !== this.exploreShown) {
      this.exploreShown = exploreLabel
      this.explore.setText(exploreLabel)
    }

    const v = room?.votes
    const votesLabel = v ? `${v.voted ? 'voted' : 'V: vote skip'}  ${v.votes}/${v.needed}` : ''
    if (votesLabel !== this.votesShown) {
      this.votesShown = votesLabel
      this.votes.setText(votesLabel)
      this.votes.setColor(v?.voted ? VOTED_COLOR : VOTE_COLOR)
    }
  }

  public destroy() {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this)
    this.explore.destroy()
    this.votes.destroy()
  }
}
