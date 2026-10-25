import { describe, expect, it } from 'vitest'
import {
  BINDINGS_STORAGE_KEY,
  captureOutcome,
  clearSlot,
  DEFAULT_BINDINGS,
  duplicates,
  loadBindings,
  parseBindings,
  rebind,
  saveBindings,
  serializeBindings,
} from './bindings'

const memoryStore = () => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwingStore = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('bindings', () => {
  it('defaults to the classic keys with no duplicates', () => {
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space', 'ArrowUp', 'Pad0'])
    expect(DEFAULT_BINDINGS.stall).toEqual(['KeyE', null, 'Pad5'])
    expect(duplicates(DEFAULT_BINDINGS).size).toBe(0)
  })

  it('rebinds empty and filled slots without touching others', () => {
    const b = rebind(rebind(DEFAULT_BINDINGS, 'stall', 1, 'KeyQ'), 'jump', 0, 'KeyW')
    expect(b.stall).toEqual(['KeyE', 'KeyQ', 'Pad5'])
    expect(b.jump).toEqual(['KeyW', 'ArrowUp', 'Pad0'])
    expect(b.left).toBe(DEFAULT_BINDINGS.left)
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space', 'ArrowUp', 'Pad0'])
    expect(rebind(DEFAULT_BINDINGS, 'jump', 2, 'Pad2').jump).toEqual(['Space', 'ArrowUp', 'Pad2'])
  })

  it('refuses reserved and clear keys', () => {
    for (const code of ['Escape', 'Tab', 'Enter', 'KeyV', 'KeyR', 'MetaLeft', 'Backspace', 'Delete']) {
      expect(rebind(DEFAULT_BINDINGS, 'jump', 0, code)).toBe(DEFAULT_BINDINGS)
    }
    for (const code of ['Pad1', 'Pad8', 'Pad9', 'Pad16']) {
      expect(rebind(DEFAULT_BINDINGS, 'jump', 2, code)).toBe(DEFAULT_BINDINGS)
    }
  })

  it('refuses a code from the wrong device for the slot', () => {
    expect(rebind(DEFAULT_BINDINGS, 'jump', 0, 'Pad2')).toBe(DEFAULT_BINDINGS)
    expect(rebind(DEFAULT_BINDINGS, 'jump', 1, 'Pad2')).toBe(DEFAULT_BINDINGS)
    expect(rebind(DEFAULT_BINDINGS, 'jump', 2, 'KeyW')).toBe(DEFAULT_BINDINGS)
    expect(rebind(DEFAULT_BINDINGS, 'jump', 2, 'Mouse0')).toBe(DEFAULT_BINDINGS)
  })

  it('clears a slot', () => {
    expect(clearSlot(DEFAULT_BINDINGS, 'dash', 1).dash).toEqual(['ShiftLeft', null, 'Pad4'])
    expect(clearSlot(DEFAULT_BINDINGS, 'dash', 2).dash).toEqual(['ShiftLeft', 'ShiftRight', null])
  })

  it('says what a press does while capturing', () => {
    const table: Array<[0 | 1 | 2, string, string]> = [
      [0, 'KeyW', 'bind'],
      [1, 'Mouse2', 'bind'],
      [2, 'Pad2', 'bind'],
      [2, 'Pad3', 'bind'],
      [2, 'Pad12', 'reserved'],
      [0, 'KeyT', 'reserved'],
      [0, 'Digit1', 'reserved'],
      [0, 'Escape', 'cancel'],
      [2, 'Escape', 'cancel'],
      [2, 'Pad1', 'cancel'],
      [0, 'Pad1', 'cancel'],
      [0, 'Backspace', 'clear'],
      [2, 'Delete', 'clear'],
      [2, 'Pad8', 'clear'],
      [1, 'Pad8', 'clear'],
      [0, 'Tab', 'reserved'],
      [2, 'Pad9', 'reserved'],
      [2, 'Pad16', 'reserved'],
      [0, 'Pad2', 'wrongDevice'],
      [0, 'Pad9', 'wrongDevice'],
      [2, 'KeyW', 'wrongDevice'],
      [2, 'Mouse0', 'wrongDevice'],
      [2, 'Tab', 'wrongDevice'],
    ]
    for (const [slot, code, outcome] of table) {
      expect([slot, code, captureOutcome(slot, code)]).toEqual([slot, code, outcome])
    }
  })

  it('finds keys used more than once, within and across actions', () => {
    const across = rebind(DEFAULT_BINDINGS, 'stall', 1, 'Space')
    expect([...duplicates(across)]).toEqual(['Space'])
    const within = rebind(DEFAULT_BINDINGS, 'left', 1, 'ArrowLeft')
    expect([...duplicates(within)]).toEqual(['ArrowLeft'])
  })

  describe('parsing', () => {
    it('falls back to defaults on missing, corrupt or other-version data', () => {
      expect(parseBindings(null)).toBe(DEFAULT_BINDINGS)
      expect(parseBindings('{nope')).toBe(DEFAULT_BINDINGS)
      expect(parseBindings('null')).toBe(DEFAULT_BINDINGS)
      expect(parseBindings(JSON.stringify({ version: 3, actions: {} }))).toBe(DEFAULT_BINDINGS)
    })

    it('round-trips', () => {
      const b = clearSlot(rebind(rebind(DEFAULT_BINDINGS, 'jump', 0, 'KeyW'), 'stall', 2, 'Pad3'), 'left', 1)
      expect(parseBindings(serializeBindings(b))).toEqual(b)
    })

    it('migrates a version 1 save, keeping its keys and adding the default pad buttons', () => {
      const raw = JSON.stringify({
        version: 1,
        actions: { jump: ['KeyW', null], stall: ['Mouse2', 'KeyQ'], dash: ['ShiftLeft', 'ShiftRight', 'Pad0'] },
      })
      const b = parseBindings(raw)
      expect(b.jump).toEqual(['KeyW', null, 'Pad0'])
      expect(b.stall).toEqual(['Mouse2', 'KeyQ', 'Pad5'])
      // Three slots was never a version 1 shape
      expect(b.dash).toEqual(DEFAULT_BINDINGS.dash)
      expect(b.left).toEqual(DEFAULT_BINDINGS.left)
    })

    it('takes the D-pad and the chat keys off a save from before quick chat', () => {
      const raw = JSON.stringify({
        version: 2,
        actions: { left: ['ArrowLeft', 'KeyA', 'Pad14'], jump: ['Digit1', 'KeyT', 'Pad0'] },
      })
      const b = parseBindings(raw)
      expect(b.left).toEqual(['ArrowLeft', 'KeyA', null])
      expect(b.jump).toEqual([null, null, 'Pad0'])
    })

    it('empties slots holding a code from the wrong device', () => {
      const v2 = JSON.stringify({ version: 2, actions: { jump: ['Pad0', 'KeyW', 'Space'] } })
      expect(parseBindings(v2).jump).toEqual([null, 'KeyW', null])
      const v1 = JSON.stringify({ version: 1, actions: { jump: ['Pad3', 'KeyW'] } })
      expect(parseBindings(v1).jump).toEqual([null, 'KeyW', 'Pad0'])
    })

    it('fills missing or malformed actions with defaults and ignores unknown ones', () => {
      const raw = JSON.stringify({
        version: 2,
        actions: { jump: ['KeyW', null, null], dash: 'ShiftLeft', fly: ['KeyF', null, null] },
      })
      const b = parseBindings(raw)
      expect(b.jump).toEqual(['KeyW', null, null])
      expect(b.dash).toEqual(DEFAULT_BINDINGS.dash)
      expect(b.left).toEqual(DEFAULT_BINDINGS.left)
      expect(b).not.toHaveProperty('fly')
    })

    it('empties slots holding reserved or non-string keys', () => {
      const raw = JSON.stringify({ version: 2, actions: { jump: ['Tab', 7, 'Pad9'] } })
      expect(parseBindings(raw).jump).toEqual([null, null, null])
    })
  })

  it('saves and loads through the store, surviving a blocked one', () => {
    const store = memoryStore()
    const b = rebind(DEFAULT_BINDINGS, 'stall', 1, 'KeyQ')
    saveBindings(store, b)
    expect(store.data.has(BINDINGS_STORAGE_KEY)).toBe(true)
    expect(loadBindings(store)).toEqual(b)
    expect(loadBindings(throwingStore)).toBe(DEFAULT_BINDINGS)
    expect(() => saveBindings(throwingStore, b)).not.toThrow()
  })
})
