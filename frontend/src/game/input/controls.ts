import type { InputFrame } from '../race/movement'
import { STICK_PRESS, STICK_RELEASE } from '../race/tuning'
import { actionsFor, type Bindings } from './bindings'

type Dir = 1 | -1

/**
 * The orb's key, mouse-button and pad state under some bindings, fed raw events by code (pad
 * buttons come as `Pad<N>` codes like any key) plus the shaped left stick. Left/right are held;
 * jump and stall latch on a fresh press. Dash is a held modifier: a dash latches on a fresh
 * direction press while it's held, or on a fresh dash press while a direction is held (the one
 * pressed last, if both are). The stick pushed past STICK_PRESS counts as pressing its direction.
 * Latches wait for the next physics step, so a press shorter than a step is never lost and one is
 * never seen twice when several steps run in a frame.
 */
export class Controls {
  private bindings: Bindings
  private held = new Set<string>()
  /** Held directions, most recently pressed last. */
  private dirs: Array<Dir> = []
  private jump = false
  private stall = false
  private dash: Dir | 0 = 0
  /** Shaped stick, -1 to 1. */
  private stick = 0
  /** The direction the stick is pressing, with hysteresis between STICK_PRESS and STICK_RELEASE. */
  private stickDir: Dir | 0 = 0

  constructor(bindings: Bindings) {
    this.bindings = bindings
  }

  /** Held keys are dropped too, so none stays stuck under its old meaning. */
  public setBindings(bindings: Bindings) {
    this.bindings = bindings
    this.releaseAll()
  }

  public isBound(code: string): boolean {
    return actionsFor(this.bindings, code).length > 0
  }

  /** True when the key is bound, so the caller can stop the browser acting on it. */
  public keyDown(code: string, repeat: boolean): boolean {
    const actions = actionsFor(this.bindings, code)
    if (actions.length === 0) return false
    if (repeat || this.held.has(code)) return true
    // A second key of a held action is no fresh press of it; jump and stall fire per key
    const fresh = actions.filter((a) => a === 'jump' || a === 'stall' || !this.isHeld(a))
    this.held.add(code)

    for (const action of fresh) {
      if (action === 'jump') this.jump = true
      if (action === 'stall') this.stall = true
      if (action === 'left' || action === 'right') this.pressDir(action === 'right' ? 1 : -1)
    }
    // After directions are in, so a key bound to both dash and a direction dashes that way
    const newDir = fresh.find((a) => a === 'left' || a === 'right')
    if (newDir && this.isHeld('dash')) this.dash = newDir === 'right' ? 1 : -1
    else if (fresh.includes('dash') && this.dirs.length > 0) this.dash = this.dirs[this.dirs.length - 1]
    return true
  }

  public keyUp(code: string) {
    if (!this.held.delete(code)) return
    for (const action of actionsFor(this.bindings, code)) {
      if (action === 'left' || action === 'right') this.releaseDir(action === 'right' ? 1 : -1)
    }
  }

  /** The shaped left stick, -1 to 1; crossing STICK_PRESS presses a direction like a key. */
  public setStick(x: number) {
    this.stick = x
    const magnitude = Math.abs(x)
    const sign: Dir = x > 0 ? 1 : -1
    const was = this.stickDir
    let now: Dir | 0 = was
    if (magnitude >= STICK_PRESS) now = sign
    else if (was !== 0 && (sign !== was || magnitude < STICK_RELEASE)) now = 0
    if (now === was) return

    this.stickDir = 0
    if (was !== 0) this.releaseDir(was)
    // A direction already held on a key is no fresh press
    const fresh = now !== 0 && !this.isHeld(now === 1 ? 'right' : 'left')
    this.stickDir = now
    if (now !== 0 && fresh) {
      this.pressDir(now)
      if (this.isHeld('dash')) this.dash = now
    }
  }

  /**
   * This physics step's input; the latched presses are used up. A held key or D-pad direction
   * moves at full strength over whatever the stick says.
   */
  public frame(): InputFrame {
    const left = this.keyHeld('left')
    const right = this.keyHeld('right')
    const input: InputFrame = {
      moveX: left || right ? Number(right) - Number(left) : this.stick,
      flapPressed: this.jump,
      dash: this.dash,
      stallPressed: this.stall,
    }
    this.clearLatches()
    return input
  }

  public clearLatches() {
    this.jump = false
    this.stall = false
    this.dash = 0
  }

  /**
   * Lets go of every key and the stick, e.g. when the window loses focus and key-ups would be
   * missed.
   */
  public releaseAll() {
    this.held.clear()
    this.dirs = []
    this.stick = 0
    this.stickDir = 0
    this.clearLatches()
  }

  private pressDir(dir: Dir) {
    this.dirs = [...this.dirs.filter((d) => d !== dir), dir]
  }

  /** Drops a direction once neither a key nor the stick still holds it. */
  private releaseDir(dir: Dir) {
    if (!this.isHeld(dir === 1 ? 'right' : 'left')) this.dirs = this.dirs.filter((d) => d !== dir)
  }

  private keyHeld(action: 'left' | 'right' | 'dash'): boolean {
    return this.bindings[action].some((code) => code !== null && this.held.has(code))
  }

  private isHeld(action: 'left' | 'right' | 'dash'): boolean {
    if (this.keyHeld(action)) return true
    return this.stickDir !== 0 && action === (this.stickDir === 1 ? 'right' : 'left')
  }
}
