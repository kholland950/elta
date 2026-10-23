import { describe, expect, it } from 'vitest'
import { MAX_STAR_LAYERS, generateNebula, generateStarLayers, mulberry32 } from './starfield'

describe('mulberry32', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('generateStarLayers', () => {
  it('is deterministic for a seed', () => {
    expect(generateStarLayers(7, 3, 512)).toEqual(generateStarLayers(7, 3, 512))
    expect(generateStarLayers(7, 3, 512)).not.toEqual(generateStarLayers(8, 3, 512))
  })

  it('returns the requested number of layers, clamped to the maximum', () => {
    expect(generateStarLayers(1, 1, 512)).toHaveLength(1)
    expect(generateStarLayers(1, 3, 512)).toHaveLength(3)
    expect(generateStarLayers(1, 99, 512)).toHaveLength(MAX_STAR_LAYERS)
    expect(generateStarLayers(1, 0, 512)).toHaveLength(0)
  })

  it('keeps the far layer first so Low keeps the backdrop', () => {
    const low = generateStarLayers(3, 1, 512)
    const high = generateStarLayers(3, 3, 512)
    expect(low[0]).toEqual(high[0])
  })

  it('orders layers far to near with fewer stars nearer', () => {
    const layers = generateStarLayers(5, 3, 512)
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].scrollFactor).toBeGreaterThan(layers[i - 1].scrollFactor)
      expect(layers[i].stars.length).toBeLessThan(layers[i - 1].stars.length)
      expect(layers[i].scrollFactor).toBeLessThan(1)
    }
    layers.forEach((layer) => expect(layer.stars.length).toBeGreaterThan(0))
  })

  it('keeps every star inside the tile including its radius', () => {
    const tileSize = 256
    generateStarLayers(11, 3, tileSize).forEach((layer) =>
      layer.stars.forEach((star) => {
        expect(star.x - star.r).toBeGreaterThanOrEqual(0)
        expect(star.y - star.r).toBeGreaterThanOrEqual(0)
        expect(star.x + star.r).toBeLessThanOrEqual(tileSize)
        expect(star.y + star.r).toBeLessThanOrEqual(tileSize)
        expect(star.r).toBeGreaterThan(0)
        expect(star.alpha).toBeGreaterThan(0)
        expect(star.alpha).toBeLessThanOrEqual(1)
      }),
    )
  })
})

describe('generateNebula', () => {
  it('is deterministic for a seed', () => {
    expect(generateNebula(9, 2000)).toEqual(generateNebula(9, 2000))
    expect(generateNebula(9, 2000)).not.toEqual(generateNebula(10, 2000))
  })

  it('keeps every blob inside the world square', () => {
    const worldSize = 2000
    const half = worldSize / 2
    const blobs = generateNebula(4, worldSize, 50)
    expect(blobs).toHaveLength(50)
    blobs.forEach((blob) => {
      expect(blob.x - blob.radius).toBeGreaterThanOrEqual(-half)
      expect(blob.x + blob.radius).toBeLessThanOrEqual(half)
      expect(blob.y - blob.radius).toBeGreaterThanOrEqual(-half)
      expect(blob.y + blob.radius).toBeLessThanOrEqual(half)
      expect(blob.alpha).toBeGreaterThan(0)
      expect(blob.alpha).toBeLessThanOrEqual(1)
    })
  })
})
