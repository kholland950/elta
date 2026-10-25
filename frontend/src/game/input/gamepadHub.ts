import type { MenuAction } from 'app/menuNav'
import { padCode } from './bindings'
import { MenuRepeater, PAD, PAD_MENU_PRESSES, PadReader } from './gamepad'

/** Where pad input goes during play (the orb's Controls). */
export interface PadGameSink {
  keyDown(code: string, repeat: boolean): boolean
  keyUp(code: string): void
  setStick(x: number): void
  releaseAll(): void
}

/** A menu screen taking pad input while it is the top one. */
export interface PadMenuHandler {
  /** Every pad button press goes here first; return true to take it (e.g. while capturing). */
  button?(button: number): boolean
  /** A press not taken above as a menu action: D-pad or stick moves, A, B, LB and RB. */
  action?(action: MenuAction): void
}

const NO_PADS: ReadonlyArray<null> = []

/** Empty where the browser has no Gamepad API (insecure origins) or a policy blocks it. */
const connectedPads = () => {
  try {
    return navigator.getGamepads?.() ?? NO_PADS
  } catch {
    return NO_PADS
  }
}

/**
 * Polls the pads once per display frame and sends their input to the game, or to the open menu.
 * It runs its own loop rather than Phaser's gamepad plugin because the Svelte menus need the pad
 * while Phaser's input is off. Switching between game and menu, or the page losing focus, lets
 * go of everything and makes held buttons and the stick wait to be released before they count.
 */
export class GamepadHub {
  private reader = new PadReader()
  private repeater = new MenuRepeater()
  private startListeners = new Set<() => void>()
  private sink: PadGameSink | null = null
  /** Open menu screens, top last; only the top one hears the pad. */
  private menus: Array<PadMenuHandler> = []
  private menuOpen = false
  /** Pads keep reporting while the page is in the background; that input isn't ours. */
  private away = false
  private frame = 0

  public start() {
    if (this.frame) return
    window.addEventListener('blur', this.onAway)
    window.addEventListener('focus', this.onBack)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.away = document.hidden || !document.hasFocus()
    this.frame = requestAnimationFrame(this.tick)
  }

  public stop() {
    if (!this.frame) return
    cancelAnimationFrame(this.frame)
    this.frame = 0
    window.removeEventListener('blur', this.onAway)
    window.removeEventListener('focus', this.onBack)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.release()
  }

  /**
   * The game registers its controls here. The returned function unregisters them, unless a newer
   * game has registered since.
   */
  public setGameSink(sink: PadGameSink): () => void {
    this.sink?.releaseAll()
    this.sink = sink
    return () => {
      if (this.sink !== sink) return
      sink.releaseAll()
      this.sink = null
    }
  }

  /** Puts a menu screen on top; the returned function takes it off again, wherever it is. */
  public pushMenu(handler: PadMenuHandler): () => void {
    this.menus.push(handler)
    return () => {
      const index = this.menus.indexOf(handler)
      if (index >= 0) this.menus.splice(index, 1)
    }
  }

  /** Start, in play or in a menu (unless a capturing screen took it). */
  public onStart(listener: () => void): () => void {
    this.startListeners.add(listener)
    return () => this.startListeners.delete(listener)
  }

  /** While the menu is open the game gets no pad input. */
  public setMenuOpen(open: boolean) {
    if (open === this.menuOpen) return
    this.menuOpen = open
    this.release()
  }

  private release() {
    this.sink?.releaseAll()
    this.reader.reset()
    this.repeater.reset()
  }

  private onAway = () => {
    this.away = true
    this.release()
  }

  private onBack = () => {
    if (document.hidden) return
    this.away = false
    this.release()
  }

  private onVisibility = () => {
    if (document.hidden) this.onAway()
    else if (document.hasFocus()) this.onBack()
  }

  private tick = (nowMs: number) => {
    this.frame = requestAnimationFrame(this.tick)
    // Keeps reading while away, so what is held then is the baseline on coming back
    const poll = this.reader.poll(connectedPads())
    if (this.away) return
    if (this.menuOpen) this.toMenu(poll.downs, nowMs)
    else this.toGame(poll.downs, poll.ups, poll.stickX)
  }

  private toMenu(downs: ReadonlyArray<number>, nowMs: number) {
    for (const button of downs) {
      // Looked up per press, since a press can open or close a screen
      const menu = this.menus[this.menus.length - 1]
      // A press the screen took doesn't also count as held for moving the highlight
      if (menu?.button?.(button)) this.reader.suppress(button)
      else if (button === PAD.start) this.startListeners.forEach((listener) => listener())
      else if (PAD_MENU_PRESSES[button]) menu?.action?.(PAD_MENU_PRESSES[button])
    }
    const { x, y } = this.reader.menuPush()
    const dir = this.repeater.update(x, y, nowMs)
    if (dir) this.menus[this.menus.length - 1]?.action?.(dir)
  }

  private toGame(downs: ReadonlyArray<number>, ups: ReadonlyArray<number>, stickX: number) {
    for (const button of downs) {
      if (button === PAD.start) this.startListeners.forEach((listener) => listener())
    }
    const sink = this.sink
    if (!sink) return
    for (const button of downs) sink.keyDown(padCode(button), false)
    for (const button of ups) sink.keyUp(padCode(button))
    sink.setStick(stickX)
  }
}

export const gamepadHub = new GamepadHub()
