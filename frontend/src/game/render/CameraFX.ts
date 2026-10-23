import Phaser from 'phaser'
import { KICK_MS, kickOffset } from 'game/fx/cameraKick'
import type { QualityProfile } from 'game/fx/quality'

/**
 * Full-screen camera filters: bloom (High only) followed by a subtle vignette.
 * The vignette shader goes fully dark outside `radius` (UV distance), so the radius stays past
 * the screen corner (~0.71) and strength stays low.
 */
export class CameraFX {
  private camera: Phaser.Cameras.Scene2D.Camera
  private bloom: Phaser.Types.Actions.AddEffectBloomReturn
  private shakeEnabled: boolean
  private kickStart = 0
  private kickDir: 1 | -1 | 0 = 0

  constructor(camera: Phaser.Cameras.Scene2D.Camera, profile: QualityProfile) {
    this.camera = camera
    // Filters render the camera into a framebuffer that starts transparent. ADD-blended objects
    // (halos, nebula, trails) then punch dark holes and the page shows through the canvas, so
    // give the camera an opaque background.
    camera.setBackgroundColor(0x000000)
    this.bloom = Phaser.Actions.AddEffectBloom(camera, {
      threshold: 0.55,
      blurRadius: 2,
      blurSteps: 4,
      blurQuality: 0,
      blendAmount: 0.9,
    })[0]
    camera.filters.external.addVignette(0.5, 0.5, 0.9, 0.1)
    this.applyQuality(profile)
    // FOLLOW_UPDATE fires at the end of Camera.preRender, after follow lerp, bounds clamp and shake
    camera.on(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, this.applyKick)
  }

  public applyQuality(profile: QualityProfile) {
    this.bloom.parallelFilters.active = profile.bloom
    this.shakeEnabled = profile.shake
  }

  /** Few-pixel recoil against a dash (see fx/cameraKick.ts). A no-op when the profile disables shake (Low or reduced motion). */
  public kick(scene: Phaser.Scene, dir: 1 | -1) {
    if (!this.shakeEnabled) return
    this.kickStart = scene.time.now
    this.kickDir = dir
  }

  // Applied at render time, the way Camera's shake effect is: translate the view matrix after the
  // follow lerp has set scroll, so the lerp can't smooth it away and scroll itself never drifts.
  // matrix is what the filter framebuffer renders with; matrixCombined is rebuilt from it.
  private applyKick = () => {
    if (this.kickDir === 0) return
    const cam = this.camera
    const t = cam.scene.time.now - this.kickStart
    if (t >= KICK_MS || !this.shakeEnabled) {
      this.kickDir = 0
      return
    }
    let dx = kickOffset(t, this.kickDir)
    // Don't kick past the world edge when the camera is already pinned against a bound
    if (cam.useBounds) dx = cam.clampX(cam.scrollX + dx) - cam.scrollX
    if (dx === 0) return
    // `matrix` is @private in the typings but public at runtime; Shake.preRender translates it the same way
    const view = (cam as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix })
      .matrix
    view.translate(-dx, 0)
    cam.matrixExternal.multiply(view, cam.matrixCombined)
  }

  /** Small camera shake; a no-op when the profile disables shake (Low or reduced motion). */
  public shake(duration = 160, intensity = 0.004) {
    if (!this.shakeEnabled) return
    // force=false lets a running shake finish instead of restarting on back-to-back hits
    this.camera.shake(duration, intensity)
  }
}
