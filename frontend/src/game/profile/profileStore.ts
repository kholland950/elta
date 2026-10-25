import type { KeyValueStore } from '../fx/quality'
import { isPaletteColor, randomColor } from './palette'
import { type Profile, validName } from './profile'

export const NAME_STORAGE_KEY = 'name'
export const COLOR_STORAGE_KEY = 'color'

const read = (store: KeyValueStore, key: string): string | null => {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

export const saveProfile = (store: KeyValueStore, profile: Profile) => {
  try {
    store.setItem(NAME_STORAGE_KEY, profile.name)
    store.setItem(COLOR_STORAGE_KEY, profile.color)
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the profile just won't persist
  }
}

/**
 * The saved profile, with a missing or invalid name or color replaced by a random one. Anything
 * replaced is saved straight away, so a new player keeps the same look on the next visit.
 */
export const loadProfile = (store: KeyValueStore, genName: () => string, rng: () => number): Profile => {
  const name = read(store, NAME_STORAGE_KEY)
  const color = read(store, COLOR_STORAGE_KEY)
  const profile: Profile = {
    name: validName(name) ? name : genName(),
    color: isPaletteColor(color) ? color : randomColor(rng),
  }
  if (profile.name !== name || profile.color !== color) saveProfile(store, profile)
  return profile
}
