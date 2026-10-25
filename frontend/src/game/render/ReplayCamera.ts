import Phaser from 'phaser'
import { FOLLOW_LERP } from 'game/PlayerManager'
import type { Pose } from 'game/fx/replayCamera'

/**
 * The main camera during the round-end replay. Every pose comes from the server-clocked timeline
 * (`apply` each frame, no tweens), so all clients frame the same thing at the same moment.
 *
 * The camera's bounds are lifted while it frames the field: Phaser's clampX would hold a group
 * near the stage edge off centre, and pins the view to the bounds' left and top edges once it is
 * wider than them. They come back with the follow.
 */
export class ReplayCamera {
  private readonly camera: Phaser.Cameras.Scene2D.Camera
  /** The bounds lifted by `begin`, to restore; undefined while they're in place. */
  private lifted?: Phaser.Geom.Rectangle

  constructor(
    scene: Phaser.Scene,
    /** Puts the camera back on the local orb. */
    private readonly followLocal: () => void,
  ) {
    this.camera = scene.cameras.main
  }

  /** The view size in screen px. */
  public get width(): number {
    return this.camera.width
  }

  public get height(): number {
    return this.camera.height
  }

  /** Where the camera is looking now. */
  public current(out: Pose): Pose {
    out.cx = this.camera.midPoint.x
    out.cy = this.camera.midPoint.y
    out.zoom = this.camera.zoom
    return out
  }

  /** Takes the camera over: no follow and no bounds until `follow` or `reset`. */
  public begin() {
    this.camera.stopFollow()
    if (this.lifted) return
    if (this.camera.useBounds) this.lifted = this.camera.getBounds()
    this.camera.removeBounds()
  }

  public apply(pose: Pose) {
    this.camera.setZoom(pose.zoom)
    this.camera.centerOn(pose.cx, pose.cy)
  }

  /** Back to zoom 1 inside the bounds, following `target` the way the camera follows the local orb. */
  public follow(target: Phaser.GameObjects.GameObject | { x: number; y: number }) {
    this.restore()
    this.camera.startFollow(target, false, FOLLOW_LERP, FOLLOW_LERP)
  }

  /** Back to normal play: zoom 1, the bounds, and following the local orb. */
  public reset() {
    this.restore()
    this.followLocal()
  }

  private restore() {
    this.camera.setZoom(1)
    const bounds = this.lifted
    this.lifted = undefined
    if (bounds) this.camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height)
  }
}
