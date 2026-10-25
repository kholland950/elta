import type { KeyValueStore } from '../fx/quality'

/**
 * The race actions a player can rebind. Keys are `KeyboardEvent.code` (physical positions) and
 * mouse buttons are `Mouse<MouseEvent.button>`.
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

export type Slot = 0 | 1

/** Two slots per action, primary then secondary; null is an empty slot. */
export type Bindings = Readonly<Record<Action, readonly [string | null, string | null]>>

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp'],
  dash: ['ShiftLeft', 'ShiftRight'],
  stall: ['KeyE', null],
}

/** Menu keys, the fixed hotkeys (V vote skip, R new stage) and OS keys can't be bound. */
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
])

/** Pressed while capturing a key, these empty the slot instead. */
export const CLEAR_CODES: ReadonlySet<string> = new Set(['Backspace', 'Delete'])

export const mouseCode = (button: number) => `Mouse${button}`

export const isBindable = (code: string) => !RESERVED.has(code) && !CLEAR_CODES.has(code)

const withSlot = (b: Bindings, action: Action, slot: Slot, code: string | null): Bindings => {
  const slots: [string | null, string | null] = [...b[action]]
  slots[slot] = code
  return { ...b, [action]: slots }
}

/** Puts `code` in the slot. Duplicates are allowed; a reserved or clear code changes nothing. */
export const rebind = (b: Bindings, action: Action, slot: Slot, code: string): Bindings =>
  isBindable(code) ? withSlot(b, action, slot, code) : b

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
const VERSION = 1

const parseSlot = (value: unknown): string | null =>
  typeof value === 'string' && isBindable(value) ? value : null

/**
 * Saved bindings merged over the defaults: an action missing from the save (one added since, or a
 * malformed entry) gets its default keys, and a slot holding an unbindable key comes back empty.
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
  if (version !== VERSION || typeof actions !== 'object' || !actions) return DEFAULT_BINDINGS
  const out = { ...DEFAULT_BINDINGS }
  for (const action of ACTIONS) {
    const slots = (actions as Record<string, unknown>)[action]
    if (Array.isArray(slots) && slots.length === 2) out[action] = [parseSlot(slots[0]), parseSlot(slots[1])]
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
