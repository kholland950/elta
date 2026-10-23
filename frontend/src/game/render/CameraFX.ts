import Phaser from 'phaser'
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
  }

  public applyQuality(profile: QualityProfile) {
    this.bloom.parallelFilters.active = profile.bloom
    this.shakeEnabled = profile.shake
  }

  /** Small camera shake; a no-op when the profile disables shake (Low or reduced motion). */
  public shake(duration = 160, intensity = 0.004) {
    if (!this.shakeEnabled) return
    // force=false lets a running shake finish instead of restarting on back-to-back hits
    this.camera.shake(duration, intensity)
  }
}
