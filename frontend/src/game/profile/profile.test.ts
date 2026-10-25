import { describe, expect, it } from 'vitest'
import { validName, validProfile } from './profile'

describe('validName', () => {
  it('accepts 2 to 15 word characters and spaces', () => {
    expect(validName('Al')).toBe(true)
    expect(validName('A'.repeat(15))).toBe(true)
    expect(validName('Swift Otter_2')).toBe(true)
  })

  it('rejects too short, too long, symbols and non-strings', () => {
    expect(validName('A')).toBe(false)
    expect(validName('A'.repeat(16))).toBe(false)
    expect(validName('Bad-Name')).toBe(false)
    expect(validName('ok!')).toBe(false)
    expect(validName(null)).toBe(false)
  })
})

describe('validProfile', () => {
  it('needs a valid name and a palette color', () => {
    expect(validProfile({ name: 'SwiftOtter', color: 'Cyan' })).toBe(true)
    expect(validProfile({ name: 'SwiftOtter', color: 'Teal' })).toBe(false)
    expect(validProfile({ name: '!', color: 'Cyan' })).toBe(false)
  })
})
