import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUALITY,
  KeyValueStore,
  QUALITY_STORAGE_KEY,
  loadQuality,
  qualityProfile,
  saveQuality,
} from './quality'

type MapStore = KeyValueStore & { map: Map<string, string> }

const mapStore = (initial: Record<string, string> = {}): MapStore => {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('loadQuality', () => {
  it('defaults to high when nothing is stored', () => {
    expect(DEFAULT_QUALITY).toBe('high')
    expect(loadQuality(mapStore())).toBe('high')
  })

  it('returns a stored level', () => {
    expect(loadQuality(mapStore({ [QUALITY_STORAGE_KEY]: 'low' }))).toBe('low')
    expect(loadQuality(mapStore({ [QUALITY_STORAGE_KEY]: 'high' }))).toBe('high')
  })

  it('falls back to the default for garbage values', () => {
    expect(loadQuality(mapStore({ [QUALITY_STORAGE_KEY]: 'ultra' }))).toBe('high')
  })

  it('falls back to the default when the store throws', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadQuality(throwing)).toBe('high')
    expect(() => saveQuality(throwing, 'low')).not.toThrow()
  })
})

describe('saveQuality', () => {
  it('round-trips through the store', () => {
    const store = mapStore()
    saveQuality(store, 'low')
    expect(store.map.get(QUALITY_STORAGE_KEY)).toBe('low')
    expect(loadQuality(store)).toBe('low')
    saveQuality(store, 'high')
    expect(loadQuality(store)).toBe('high')
  })
})

describe('qualityProfile', () => {
  it('high enables bloom, nebula, shake and extra parallax layers', () => {
    const p = qualityProfile('high', false)
    expect(p.bloom).toBe(true)
    expect(p.nebula).toBe(true)
    expect(p.shake).toBe(true)
    expect(p.padMotes).toBe(true)
    expect(p.parallaxLayers).toBeGreaterThan(1)
  })

  it('low disables bloom and shake and cuts layers and particles', () => {
    const high = qualityProfile('high', false)
    const low = qualityProfile('low', false)
    expect(low.bloom).toBe(false)
    expect(low.shake).toBe(false)
    expect(low.nebula).toBe(false)
    expect(low.padMotes).toBe(false)
    expect(low.padBurstCount).toBeLessThan(high.padBurstCount)
    expect(low.padBurstCount).toBeGreaterThan(0)
    expect(low.parallaxLayers).toBe(1)
    expect(low.trailRate).toBeLessThan(high.trailRate)
    expect(low.burstCount).toBeLessThan(high.burstCount)
    expect(low.puffCount).toBeLessThan(high.puffCount)
    expect(low.afterimages).toBeLessThan(high.afterimages)
    expect(low.wisps).toBeLessThan(high.wisps)
    expect(low.wisps).toBeGreaterThan(0)
    expect(low.afterimages).toBeGreaterThan(0)
  })

  it('reduced motion kills shake at any level', () => {
    expect(qualityProfile('high', true).shake).toBe(false)
    expect(qualityProfile('low', true).shake).toBe(false)
    expect(qualityProfile('high', true).bloom).toBe(true)
  })
})
