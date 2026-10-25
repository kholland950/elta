import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from '../fx/quality'
import { loadProfile, saveProfile } from './profileStore'

const memoryStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  const writes: string[] = []
  const store: KeyValueStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key)
      data.set(key, value)
    },
  }
  return { store, data, writes }
}

const genName = () => 'SwiftOtter'
const rng = () => 0 // first palette color, Red

describe('loadProfile', () => {
  it('gives a new player a random name and color and saves them', () => {
    const { store, data } = memoryStore()
    expect(loadProfile(store, genName, rng)).toEqual({ name: 'SwiftOtter', color: 'Red' })
    expect(data.get('name')).toBe('SwiftOtter')
    expect(data.get('color')).toBe('Red')
  })

  it('keeps a valid saved profile without writing', () => {
    const { store, writes } = memoryStore({ name: 'Kevin', color: 'Blue' })
    expect(loadProfile(store, genName, rng)).toEqual({ name: 'Kevin', color: 'Blue' })
    expect(writes).toEqual([])
  })

  it('replaces only the invalid part', () => {
    expect(loadProfile(memoryStore({ name: 'x', color: 'Blue' }).store, genName, rng)).toEqual({
      name: 'SwiftOtter',
      color: 'Blue',
    })
    expect(loadProfile(memoryStore({ name: 'Kevin', color: 'Teal' }).store, genName, rng)).toEqual({
      name: 'Kevin',
      color: 'Red',
    })
  })

  it('still returns a profile when storage throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadProfile(broken, genName, rng)).toEqual({ name: 'SwiftOtter', color: 'Red' })
  })
})

describe('saveProfile', () => {
  it('writes the name and color', () => {
    const { store, data } = memoryStore()
    saveProfile(store, { name: 'Kevin', color: 'Mint' })
    expect(data.get('name')).toBe('Kevin')
    expect(data.get('color')).toBe('Mint')
  })
})
