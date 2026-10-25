export type QualityLevel = 'high' | 'low'

/** Minimal storage port, satisfied by `window.localStorage` or an in-memory fake. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface QualityProfile {
  bloom: boolean
  parallaxLayers: number
  nebula: boolean
  /** Trail particles per 100px travelled; distance-based so the ribbon holds at any fps. */
  trailRate: number
  /** Particle count for burst effects (collision). */
  burstCount: number
  /** Particle count for the flap puff. */
  puffCount: number
  /** Fading orb copies left along a dash. */
  afterimages: number
  /** Soft glow motes shed behind the orb at the start of a dash. */
  wisps: number
  /** Faint sparks drifting up off the bounce pads at rest. */
  padMotes: boolean
  /** Particle count for the spark fountain off a pad launch. */
  padBurstCount: number
  shake: boolean
}

export const QUALITY_STORAGE_KEY = 'quality'
export const DEFAULT_QUALITY: QualityLevel = 'high'

const isQualityLevel = (value: unknown): value is QualityLevel =>
  value === 'high' || value === 'low'

export const loadQuality = (store: KeyValueStore): QualityLevel => {
  try {
    const value = store.getItem(QUALITY_STORAGE_KEY)
    return isQualityLevel(value) ? value : DEFAULT_QUALITY
  } catch {
    return DEFAULT_QUALITY
  }
}

export const saveQuality = (store: KeyValueStore, level: QualityLevel) => {
  try {
    store.setItem(QUALITY_STORAGE_KEY, level)
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the setting just won't persist
  }
}

export const qualityProfile = (level: QualityLevel, reducedMotion: boolean): QualityProfile => {
  const high = level === 'high'
  return {
    bloom: high,
    parallaxLayers: high ? 3 : 1,
    nebula: high,
    trailRate: high ? 25 : 8,
    burstCount: high ? 40 : 15,
    puffCount: high ? 10 : 4,
    afterimages: high ? 4 : 2,
    wisps: high ? 55 : 20,
    padMotes: high,
    padBurstCount: high ? 24 : 10,
    shake: high && !reducedMotion,
  }
}
