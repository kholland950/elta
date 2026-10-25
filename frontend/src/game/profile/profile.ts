import { isPaletteColor } from './palette'

export interface Profile {
  name: string
  color: string
}

export const NAME_MIN = 2
export const NAME_MAX = 15
// Same rule as Room.validName on the server
const NAME = /^[\w ]+$/

export const validName = (name: unknown): name is string =>
  typeof name === 'string' && name.length >= NAME_MIN && name.length <= NAME_MAX && NAME.test(name)

export const validProfile = (p: Profile): boolean => validName(p.name) && isPaletteColor(p.color)
