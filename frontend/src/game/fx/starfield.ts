export interface Star {
  x: number
  y: number
  r: number
  alpha: number
}

export interface StarLayer {
  scrollFactor: number
  stars: Array<Star>
}

export interface NebulaBlob {
  x: number
  y: number
  radius: number
  color: number
  alpha: number
}

/** Deterministic PRNG returning floats in [0, 1). */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Far layers scroll slowly and hold many small dim stars; near layers are sparse, bigger, brighter
const LAYER_SPECS = [
  { scrollFactor: 0.15, count: 220, minR: 0.4, maxR: 1.1, minAlpha: 0.25, maxAlpha: 0.6 },
  { scrollFactor: 0.4, count: 90, minR: 0.7, maxR: 1.6, minAlpha: 0.4, maxAlpha: 0.85 },
  { scrollFactor: 0.7, count: 35, minR: 1.2, maxR: 2.4, minAlpha: 0.6, maxAlpha: 1 },
]

export const MAX_STAR_LAYERS = LAYER_SPECS.length

/**
 * Star positions for each parallax layer, inside a square tile of `tileSize` that the renderer
 * repeats. Stars keep a margin of their radius so they never get cut at the tile seam.
 * With fewer layers than the maximum, the farthest layer is kept first.
 */
export const generateStarLayers = (
  seed: number,
  layerCount: number,
  tileSize: number,
): Array<StarLayer> => {
  const count = Math.max(0, Math.min(MAX_STAR_LAYERS, Math.floor(layerCount)))
  return LAYER_SPECS.slice(0, count).map((spec, index) => {
    const random = mulberry32(seed + index * 7919)
    const range = (min: number, max: number) => min + random() * (max - min)
    const stars: Array<Star> = []
    for (let i = 0; i < spec.count; i++) {
      const r = range(spec.minR, spec.maxR)
      stars.push({
        x: range(r, tileSize - r),
        y: range(r, tileSize - r),
        r,
        alpha: range(spec.minAlpha, spec.maxAlpha),
      })
    }
    return { scrollFactor: spec.scrollFactor, stars }
  })
}

export const NEBULA_COLORS = [0x3a1c71, 0x1b4f9c, 0x7b2a8c, 0x0f6c7a, 0x8c1f4f]

/**
 * Soft colour blobs centred on the origin, fully inside a `worldSize` square
 * (x and y in [-worldSize / 2, worldSize / 2], including radius).
 */
export const generateNebula = (seed: number, worldSize: number, count = 14): Array<NebulaBlob> => {
  const random = mulberry32(seed ^ 0x9e3779b9)
  const half = worldSize / 2
  const blobs: Array<NebulaBlob> = []
  for (let i = 0; i < count; i++) {
    const radius = Math.min(half, worldSize * (0.08 + random() * 0.14))
    const limit = half - radius
    blobs.push({
      x: -limit + random() * limit * 2,
      y: -limit + random() * limit * 2,
      radius,
      color: NEBULA_COLORS[Math.floor(random() * NEBULA_COLORS.length)],
      alpha: 0.12 + random() * 0.18,
    })
  }
  return blobs
}
