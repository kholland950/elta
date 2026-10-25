import Phaser from 'phaser'
import { lighten } from 'game/fx/color'
import { headAt, lineWidth, PathHead } from 'game/fx/replayPath'
import type { PathSample } from 'game/race/pathRecorder'

// Above the stage (−2) and finish (−1), below every orb (0 and up); the winner's line sits over
// everyone else's
const DEPTH = { line: -0.7, winnerLine: -0.4, heads: -0.3 }
// Lightened past the bloom threshold (0.55 per channel, CameraFX) so the bloom gives the lines
// their glow; no glow pass of their own. The winner's runs whiter.
const LINE_LIGHTEN = 0.35
const WINNER_LIGHTEN = 0.6
const HEAD_LIGHTEN = 0.75
const LINE_ALPHA = 0.9
/** Head dot radius, as a multiple of the line width. */
const HEAD_RADIUS = 1.8
/** Lines are redrawn at the new width once the zoom has changed by this factor. */
const REDRAW_ZOOM = 1.1

interface Line {
  path: ReadonlyArray<PathSample>
  graphics: Phaser.GameObjects.Graphics
  winner: boolean
  color: number
  alpha: number
  headColor: number
  /** World width at the zoom the line is drawn for. */
  width: number
  /** The sample the drawn line has reached. */
  drawn: number
}

/**
 * Every player's route, drawn on as a thin bright line in a lightened orb colour, ADD-blended so
 * the camera bloom makes the glow. Each frame appends only the segments completed since the last
 * one; a shared `heads` layer redraws the partial last segments and a dot at every head (what the
 * replay camera frames). Widths are screen px (see `lineWidth`), so a zoom change redraws.
 */
export class PathRenderer {
  private lines: Line[] = []
  private heads: Phaser.GameObjects.Graphics
  private drawnZoom = 0
  /** Whether the heads layer still has something on it to redraw or clear. */
  private headsLive = false
  private readonly head: PathHead = { x: 0, y: 0, index: -1 }

  constructor(private readonly scene: Phaser.Scene) {
    this.heads = scene.add.graphics().setDepth(DEPTH.heads).setBlendMode(Phaser.BlendModes.ADD)
  }

  /** The routes to draw from the start, coloured by `tintOf` (players without one are skipped). */
  public setPaths(
    paths: ReadonlyMap<string, ReadonlyArray<PathSample>>,
    winnerId: string | null,
    tintOf: (id: string) => number | undefined,
  ) {
    this.clear()
    paths.forEach((path, id) => {
      const tint = tintOf(id)
      if (tint === undefined || path.length === 0) return
      const winner = id === winnerId
      this.lines.push({
        path,
        graphics: this.scene.add
          .graphics()
          .setDepth(winner ? DEPTH.winnerLine : DEPTH.line)
          .setBlendMode(Phaser.BlendModes.ADD),
        winner,
        color: lighten(tint, winner ? WINNER_LIGHTEN : LINE_LIGHTEN),
        alpha: winner ? 1 : LINE_ALPHA,
        headColor: lighten(tint, HEAD_LIGHTEN),
        width: 0,
        drawn: 0,
      })
    })
    // The winner's head goes on the shared layer last, on top
    this.lines.sort((a, b) => Number(a.winner) - Number(b.winner))
    this.drawnZoom = 0
  }

  /** Draws every line up to `raceMs` of race time, at widths for `zoom`. */
  public update(raceMs: number, zoom: number) {
    if (this.lines.length === 0) return
    if (this.drawnZoom === 0 || Math.abs(Math.log(zoom / this.drawnZoom)) > Math.log(REDRAW_ZOOM)) {
      this.drawnZoom = zoom
      for (const line of this.lines) {
        line.width = lineWidth(line.winner, zoom)
        line.graphics.clear()
        line.drawn = 0
      }
      this.headsLive = true
    }
    let partial = false
    for (const line of this.lines) {
      headAt(line.path, raceMs, this.head)
      if (this.head.index > line.drawn) {
        this.stroke(line, line.drawn, this.head.index)
        line.drawn = this.head.index
      }
      if (this.head.index < line.path.length - 1) partial = true
    }
    if (!partial && !this.headsLive) return
    this.heads.clear()
    // Once every line is complete the dots go: the orbs take over
    this.headsLive = partial
    if (partial) this.drawHeads(raceMs)
  }

  /** Fades every line, e.g. under the winner's victory lap. */
  public setAlpha(alpha: number) {
    for (const line of this.lines) line.graphics.setAlpha(alpha)
    this.heads.setAlpha(alpha)
  }

  private stroke(line: Line, from: number, to: number) {
    const { graphics: g, path } = line
    g.lineStyle(line.width, line.color, line.alpha)
    g.beginPath()
    g.moveTo(path[from].x, path[from].y)
    for (let i = from + 1; i <= to; i++) g.lineTo(path[i].x, path[i].y)
    g.strokePath()
  }

  private drawHeads(raceMs: number) {
    const g = this.heads
    for (const line of this.lines) {
      const head = headAt(line.path, raceMs, this.head)
      if (head.index >= 0 && head.index < line.path.length - 1) {
        const a = line.path[head.index]
        g.lineStyle(line.width, line.color, line.alpha)
        g.lineBetween(a.x, a.y, head.x, head.y)
      }
      g.fillStyle(line.headColor, 1)
      g.fillCircle(head.x, head.y, line.width * HEAD_RADIUS)
    }
  }

  /** Removes every line (a new round, or the replay was cancelled). */
  public clear() {
    for (const line of this.lines) line.graphics.destroy()
    this.lines = []
    this.heads.clear().setAlpha(1)
    this.headsLive = false
    this.drawnZoom = 0
  }

  public destroy() {
    this.clear()
    this.heads.destroy()
  }
}
