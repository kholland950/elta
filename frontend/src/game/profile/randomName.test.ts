import { describe, expect, it } from 'vitest'
import { validName } from './profile'
import { randomName } from './randomName'

describe('randomName', () => {
  it('always gives a valid PascalCase name', () => {
    for (let i = 0; i < 500; i++) {
      const name = randomName()
      expect(validName(name)).toBe(true)
      expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/)
    }
  })
})
