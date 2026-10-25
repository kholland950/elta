import { STICK_DEADZONE, STICK_SATURATION } from '../race/tuning'

/** The parts of a `Gamepad` this reads, so tests can pass plain objects. */
export interface PadLike {
  readonly connected: boolean
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>
  readonly axes: ReadonlyArray<number>
}

/** Buttons past this many are ignored; the standard layout has 17. */
export const MAX_BUTTONS = 32

/** Standard Gamepad button indexes the menus and the hub read directly. */
export const PAD = {
  a: 0,
  b: 1,
  lb: 4,
  rb: 5,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const

/** Menu presses from the face and shoulder buttons (names match the menus' actions). */
export const PAD_MENU_PRESSES: Readonly<Record<number, 'confirm' | 'back' | 'prev' | 'next'>> = {
  [PAD.a]: 'confirm',
  [PAD.b]: 'back',
  [PAD.lb]: 'prev',
  [PAD.rb]: 'next',
}

/** Every connected pad's buttons and left stick, merged. */
export interface MergedPads {
  down: Array<boolean>
  x: number
  y: number
}

/** A trigger is analog; pulled past half it counts as pressed even where `pressed` lags. */
const isDown = (button: { pressed: boolean; value: number }) => button.pressed || button.value > 0.5

/**
 * Merges all connected pads into `out`: a button is down when it is on any pad, and the stick is
 * the one pushed furthest. Nothing is allocated.
 */
export const mergePads = (pads: ArrayLike<PadLike | null>, out: MergedPads): MergedPads => {
  out.down.fill(false)
  out.x = 0
  out.y = 0
  let furthest = 0
  for (let p = 0; p < pads.length; p++) {
    const pad = pads[p]
    if (!pad || !pad.connected) continue
    const count = Math.min(pad.buttons.length, MAX_BUTTONS)
    for (let i = 0; i < count; i++) if (isDown(pad.buttons[i])) out.down[i] = true
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    const distance = x * x + y * y
    if (distance > furthest) {
      furthest = distance
      out.x = x
      out.y = y
    }
  }
  return out
}

/** A raw stick axis shaped for steering: 0 in the deadzone, ±1 past saturation, linear between. */
export const stickX = (raw: number): number => {
  const magnitude = Math.abs(raw)
  if (magnitude < STICK_DEADZONE) return 0
  const t = Math.min(1, (magnitude - STICK_DEADZONE) / (STICK_SATURATION - STICK_DEADZONE))
  return raw < 0 ? -t : t
}

const centred = (x: number, y: number) =>
  Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE

/** One poll's result. The object and its arrays are reused by the next poll. */
export interface PadPoll {
  /** Button indexes pressed since the last poll. */
  downs: Array<number>
  /** Button indexes released since the last poll, including every held one when its pad goes. */
  ups: Array<number>
  /** The shaped stick for steering. */
  stickX: number
}

/**
 * Turns `navigator.getGamepads()` snapshots into button edges and stick values. After a reset,
 * buttons already held stay quiet until released and the stick doesn't push the menu until it
 * returns to centre, so presses held over from the screen before never act on the next one. The
 * stick still steers the game straight away: holding it is steering, not a press.
 */
export class PadReader {
  private merged: MergedPads = { down: new Array(MAX_BUTTONS).fill(false), x: 0, y: 0 }
  private prev: Array<boolean> = new Array(MAX_BUTTONS).fill(false)
  /** Held buttons that act as released until they are let go. */
  private suppressed: Array<boolean> = new Array(MAX_BUTTONS).fill(false)
  private stickGuard = false
  private result: PadPoll = { downs: [], ups: [], stickX: 0 }
  private push = { x: 0, y: 0 }

  public poll(pads: ArrayLike<PadLike | null>): PadPoll {
    const { down, x, y } = mergePads(pads, this.merged)
    const result = this.result
    result.downs.length = 0
    result.ups.length = 0
    for (let i = 0; i < MAX_BUTTONS; i++) {
      if (down[i] === this.prev[i]) continue
      this.prev[i] = down[i]
      if (down[i]) result.downs.push(i)
      else if (this.suppressed[i]) this.suppressed[i] = false
      else result.ups.push(i)
    }
    if (this.stickGuard && centred(x, y)) this.stickGuard = false
    result.stickX = stickX(x)
    return result
  }

  /**
   * Where the menu highlight is pushed as of the last poll: the D-pad as ±1 while it is held,
   * else the raw stick. Read after handing out presses, so a D-pad press a screen took and
   * suppressed doesn't also move the highlight. The object is reused.
   */
  public menuPush(): { x: number; y: number } {
    const dx = Number(this.isDown(PAD.right)) - Number(this.isDown(PAD.left))
    const dy = Number(this.isDown(PAD.down)) - Number(this.isDown(PAD.up))
    const dpad = dx !== 0 || dy !== 0
    const guarded = this.stickGuard
    this.push.x = dpad ? dx : guarded ? 0 : this.merged.x
    this.push.y = dpad ? dy : guarded ? 0 : this.merged.y
    return this.push
  }

  /** Held now, as of the last poll, and not held over from before a reset. */
  public isDown(button: number): boolean {
    return this.prev[button] && !this.suppressed[button]
  }

  /** Takes what is held now as the baseline: those buttons, and the stick in menus, stay quiet until let go. */
  public reset() {
    for (let i = 0; i < MAX_BUTTONS; i++) this.suppressed[i] = this.prev[i]
    this.stickGuard = !centred(this.merged.x, this.merged.y)
  }

  /** Quiets one held button until it is let go, e.g. one a menu already used. */
  public suppress(button: number) {
    if (this.prev[button]) this.suppressed[button] = true
  }
}

export type MenuDir = 'up' | 'down' | 'left' | 'right'

/** Pushed this far along an axis the highlight moves; it stays held until below the release. */
const MENU_ENTER = 0.5
const MENU_RELEASE = 0.35
/** A held direction moves once, again after the delay, then at the repeat rate. */
const MENU_REPEAT_DELAY_MS = 400
const MENU_REPEAT_MS = 120

/** Value along a direction's axis; pad y grows downward. */
const along = (dir: MenuDir, x: number, y: number) =>
  dir === 'right' ? x : dir === 'left' ? -x : dir === 'down' ? y : -y

/**
 * Turns the D-pad or stick into highlight moves with key-like auto-repeat. The axis pushed
 * furthest wins, and a held direction is kept while it stays past the release point unless the
 * input swings clearly to another one.
 */
export class MenuRepeater {
  private dir: MenuDir | null = null
  private nextAt = 0

  public update(x: number, y: number, nowMs: number): MenuDir | null {
    const horizontal = Math.abs(x) >= Math.abs(y)
    const pushed: MenuDir = horizontal ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up'
    const amount = horizontal ? Math.abs(x) : Math.abs(y)
    let dir: MenuDir | null = amount >= MENU_ENTER ? pushed : null
    const stillHeld = this.dir !== null && along(this.dir, x, y) >= MENU_RELEASE
    if (stillHeld && (dir === null || dir === this.dir)) dir = this.dir

    if (dir !== this.dir) {
      this.dir = dir
      this.nextAt = nowMs + MENU_REPEAT_DELAY_MS
      return dir
    }
    if (dir === null || nowMs < this.nextAt) return null
    // Late frames don't bank repeats to fire in a burst
    this.nextAt += MENU_REPEAT_MS
    if (this.nextAt <= nowMs) this.nextAt = nowMs + MENU_REPEAT_MS
    return dir
  }

  /** Forgets the held direction; what is pushed next moves at once. */
  public reset() {
    this.dir = null
  }
}
