import type { InputFrame } from '../race/movement'
import { actionsFor, type Bindings } from './bindings'

type Dir = 1 | -1

/**
 * The orb's key and mouse-button state under some bindings, fed raw events by code. Left/right are held;
 * jump and stall latch on a fresh press. Dash is a held modifier: a dash latches on a fresh
 * direction press while it's held, or on a fresh dash press while a direction is held (the one
 * pressed last, if both are). Latches wait for the next physics step, so a press shorter than a
 * step is never lost and one is never seen twice when several steps run in a frame.
 */
export class Controls {
  private bindings: Bindings
  private held = new Set<string>()
  /** Held directions, most recently pressed last. */
  private dirs: Array<Dir> = []
  private jump = false
  private stall = false
  private dash: Dir | 0 = 0

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
      if (action === 'left' || action === 'right') {
        const dir: Dir = action === 'right' ? 1 : -1
        this.dirs = [...this.dirs.filter((d) => d !== dir), dir]
      }
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
      if ((action === 'left' || action === 'right') && !this.isHeld(action)) {
        const dir: Dir = action === 'right' ? 1 : -1
        this.dirs = this.dirs.filter((d) => d !== dir)
      }
    }
  }

  /** This physics step's input; the latched presses are used up. */
  public frame(): InputFrame {
    const input: InputFrame = {
      left: this.isHeld('left'),
      right: this.isHeld('right'),
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

  /** Lets go of every key, e.g. when the window loses focus and key-ups would be missed. */
  public releaseAll() {
    this.held.clear()
    this.dirs = []
    this.clearLatches()
  }

  private isHeld(action: 'left' | 'right' | 'dash'): boolean {
    return this.bindings[action].some((code) => code !== null && this.held.has(code))
  }
}
