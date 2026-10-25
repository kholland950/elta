import { adjectives, animals, uniqueNamesGenerator } from 'unique-names-generator'
import { validName } from './profile'

// Some pairs are longer than names may be; a few re-rolls always find one that fits
const MAX_TRIES = 50
const FALLBACK = 'NewOrb'

/** An adjective-animal name in PascalCase, e.g. `SwiftOtter`, that passes `validName`. */
export const randomName = (): string => {
  for (let i = 0; i < MAX_TRIES; i++) {
    const name = uniqueNamesGenerator({ dictionaries: [adjectives, animals], style: 'capital', separator: '' })
    if (validName(name)) return name
  }
  return FALLBACK
}
