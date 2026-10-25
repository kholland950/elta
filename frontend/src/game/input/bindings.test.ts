import { describe, expect, it } from 'vitest'
import {
  BINDINGS_STORAGE_KEY,
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
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space', 'ArrowUp'])
    expect(DEFAULT_BINDINGS.stall).toEqual(['KeyE', null])
    expect(duplicates(DEFAULT_BINDINGS).size).toBe(0)
  })

  it('rebinds empty and filled slots without touching others', () => {
    const b = rebind(rebind(DEFAULT_BINDINGS, 'stall', 1, 'KeyQ'), 'jump', 0, 'KeyW')
    expect(b.stall).toEqual(['KeyE', 'KeyQ'])
    expect(b.jump).toEqual(['KeyW', 'ArrowUp'])
    expect(b.left).toBe(DEFAULT_BINDINGS.left)
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space', 'ArrowUp'])
  })

  it('refuses reserved and clear keys', () => {
    for (const code of ['Escape', 'Tab', 'Enter', 'KeyV', 'KeyR', 'MetaLeft', 'Backspace', 'Delete']) {
      expect(rebind(DEFAULT_BINDINGS, 'jump', 0, code)).toBe(DEFAULT_BINDINGS)
    }
  })

  it('clears a slot', () => {
    expect(clearSlot(DEFAULT_BINDINGS, 'dash', 1).dash).toEqual(['ShiftLeft', null])
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
      expect(parseBindings(JSON.stringify({ version: 2, actions: {} }))).toBe(DEFAULT_BINDINGS)
    })

    it('round-trips', () => {
      const b = clearSlot(rebind(DEFAULT_BINDINGS, 'jump', 0, 'KeyW'), 'left', 1)
      expect(parseBindings(serializeBindings(b))).toEqual(b)
    })

    it('fills missing or malformed actions with defaults and ignores unknown ones', () => {
      const raw = JSON.stringify({
        version: 1,
        actions: { jump: ['KeyW', null], dash: 'ShiftLeft', fly: ['KeyF', null] },
      })
      const b = parseBindings(raw)
      expect(b.jump).toEqual(['KeyW', null])
      expect(b.dash).toEqual(DEFAULT_BINDINGS.dash)
      expect(b.left).toEqual(DEFAULT_BINDINGS.left)
      expect(b).not.toHaveProperty('fly')
    })

    it('empties slots holding reserved or non-string keys', () => {
      const raw = JSON.stringify({ version: 1, actions: { jump: ['Tab', 7] } })
      expect(parseBindings(raw).jump).toEqual([null, null])
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
