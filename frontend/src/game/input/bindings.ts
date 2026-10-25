import type { KeyValueStore } from '../fx/quality'

/**
 * The race actions a player can rebind. Keys are `KeyboardEvent.code` (physical positions), mouse
 * buttons are `Mouse<MouseEvent.button>` and pad buttons are `Pad<index>` in the Standard Gamepad
 * layout (0 A, 1 B, 4 LB, 5 RB, 8 View, 9 Start, 12–15 D-pad up, down, left, right).
 */
export type Action = 'left' | 'right' | 'jump' | 'dash' | 'stall'

export const ACTIONS: ReadonlyArray<Action> = ['left', 'right', 'jump', 'dash', 'stall']

export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  left: 'Left',
  right: 'Right',
  jump: 'Jump',
  dash: 'Dash (hold)',
  stall: 'Stall',
}

export type Slot = 0 | 1 | 2

/** The third slot, which takes pad buttons only; the first two take keys and mouse buttons. */
export const PAD_SLOT = 2

type Slots = readonly [string | null, string | null, string | null]

/** Three slots per action: primary, secondary, then pad; null is an empty slot. */
export type Bindings = Readonly<Record<Action, Slots>>

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA', 'Pad14'],
  right: ['ArrowRight', 'KeyD', 'Pad15'],
  jump: ['Space', 'ArrowUp', 'Pad0'],
  dash: ['ShiftLeft', 'ShiftRight', 'Pad4'],
  stall: ['KeyE', null, 'Pad5'],
}

/**
 * Menu keys, the fixed hotkeys (V vote skip, R new stage), OS keys and the pad's menu buttons
 * (B back, Start, Home) can't be bound.
 */
export const RESERVED: ReadonlySet<string> = new Set([
  'Escape',
  'Tab',
  'Enter',
  'NumpadEnter',
  'KeyV',
  'KeyR',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
  'Pad1',
  'Pad9',
  'Pad16',
])

/** Pressed while capturing, these empty the slot instead (View on the pad). */
export const CLEAR_CODES: ReadonlySet<string> = new Set(['Backspace', 'Delete', 'Pad8'])

/** Pressed while capturing, these stop capturing (B on the pad). */
export const CANCEL_CODES: ReadonlySet<string> = new Set(['Escape', 'Pad1'])

export const mouseCode = (button: number) => `Mouse${button}`

export const padCode = (button: number) => `Pad${button}`

export const isPadCode = (code: string) => /^Pad\d+$/.test(code)

export const isBindable = (code: string) => !RESERVED.has(code) && !CLEAR_CODES.has(code)

/** The pad slot takes pad buttons only, and the other slots take anything but. */
export const slotAccepts = (slot: Slot, code: string) => (slot === PAD_SLOT) === isPadCode(code)

export type CaptureOutcome = 'bind' | 'cancel' | 'clear' | 'reserved' | 'wrongDevice'

/**
 * What a press does while a slot waits for one. Either device can cancel or clear; otherwise a
 * press from the other device is refused before a reserved one, so the notice says what to use.
 */
export const captureOutcome = (slot: Slot, code: string): CaptureOutcome => {
  if (CANCEL_CODES.has(code)) return 'cancel'
  if (CLEAR_CODES.has(code)) return 'clear'
  if (!slotAccepts(slot, code)) return 'wrongDevice'
  if (RESERVED.has(code)) return 'reserved'
  return 'bind'
}

const withSlot = (b: Bindings, action: Action, slot: Slot, code: string | null): Bindings => {
  const slots: [string | null, string | null, string | null] = [...b[action]]
  slots[slot] = code
  return { ...b, [action]: slots }
}

/**
 * Puts `code` in the slot. Duplicates are allowed; a reserved or clear code, or one from the
 * wrong device for the slot, changes nothing.
 */
export const rebind = (b: Bindings, action: Action, slot: Slot, code: string): Bindings =>
  isBindable(code) && slotAccepts(slot, code) ? withSlot(b, action, slot, code) : b

export const clearSlot = (b: Bindings, action: Action, slot: Slot): Bindings =>
  withSlot(b, action, slot, null)

/** Codes held by more than one slot, in any actions. */
export const duplicates = (b: Bindings): ReadonlySet<string> => {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const action of ACTIONS) {
    for (const code of b[action]) {
      if (code === null) continue
      if (seen.has(code)) dup.add(code)
      seen.add(code)
    }
  }
  return dup
}

/** The actions a code is bound to. */
export const actionsFor = (b: Bindings, code: string): Array<Action> =>
  ACTIONS.filter((action) => b[action].includes(code))

export const BINDINGS_STORAGE_KEY = 'keyBindings'
/** 2 added the pad slot; a version 1 save keeps its keys and gets the default pad buttons. */
const VERSION = 2

const parseSlot = (value: unknown, slot: Slot): string | null =>
  typeof value === 'string' && isBindable(value) && slotAccepts(slot, value) ? value : null

/**
 * Saved bindings merged over the defaults: an action missing from the save (one added since, or a
 * malformed entry) gets its default keys, and a slot holding an unbindable key, or one from the
 * wrong device, comes back empty.
 */
export const parseBindings = (raw: string | null): Bindings => {
  if (raw === null) return DEFAULT_BINDINGS
  let saved: unknown
  try {
    saved = JSON.parse(raw)
  } catch {
    return DEFAULT_BINDINGS
  }
  const { version, actions } = (saved ?? {}) as { version?: unknown; actions?: unknown }
  if ((version !== 1 && version !== VERSION) || typeof actions !== 'object' || !actions) {
    return DEFAULT_BINDINGS
  }
  const length = version === 1 ? 2 : 3
  const out = { ...DEFAULT_BINDINGS }
  for (const action of ACTIONS) {
    const slots = (actions as Record<string, unknown>)[action]
    if (!Array.isArray(slots) || slots.length !== length) continue
    const pad = version === 1 ? DEFAULT_BINDINGS[action][PAD_SLOT] : parseSlot(slots[2], PAD_SLOT)
    out[action] = [parseSlot(slots[0], 0), parseSlot(slots[1], 1), pad]
  }
  return out
}

export const serializeBindings = (b: Bindings): string =>
  JSON.stringify({ version: VERSION, actions: b })

export const loadBindings = (store: KeyValueStore): Bindings => {
  try {
    return parseBindings(store.getItem(BINDINGS_STORAGE_KEY))
  } catch {
    return DEFAULT_BINDINGS
  }
}

export const saveBindings = (store: KeyValueStore, b: Bindings) => {
  try {
    store.setItem(BINDINGS_STORAGE_KEY, serializeBindings(b))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the bindings just won't persist
  }
}
