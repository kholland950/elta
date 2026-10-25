import { describe, expect, it } from 'vitest'
import { fromActionMessage, shouldBroadcast, shouldShowRemote, toActionMessage } from './actions'
import type { FeelEvent } from './feelEvents'

const dash: FeelEvent = { kind: 'dash', playerId: 'a', x: 10, y: -20, dir: -1 }
const stall: FeelEvent = { kind: 'stall', playerId: 'a', x: 1, y: 2 }
const flap: FeelEvent = { kind: 'flap', playerId: 'a', x: 3, y: 4 }
const recharge: FeelEvent = { kind: 'recharge', playerId: 'a', x: 5, y: 6 }
const bounce: FeelEvent = { kind: 'bounce', playerId: 'a', x: 150, y: 400 }
const collision = (playerId: string, otherId: string): FeelEvent => ({
  kind: 'collision',
  playerId,
  otherId,
  x: 7,
  y: 8,
})

describe('action messages', () => {
  it.each([dash, stall, flap, recharge, bounce, collision('a', 'b')])(
    'round-trips a $kind event',
    (e) => {
      expect(fromActionMessage(JSON.parse(JSON.stringify(toActionMessage(e))))).toEqual(e)
    },
  )

  it('parses a relayed bounce with just the shared fields', () => {
    expect(toActionMessage(bounce)).toEqual({ kind: 'bounce', playerId: 'a', x: 150, y: 400 })
    expect(fromActionMessage({ playerId: 'b', kind: 'bounce', x: 20, y: -350 })).toEqual({
      kind: 'bounce',
      playerId: 'b',
      x: 20,
      y: -350,
    })
    expect(fromActionMessage({ playerId: 'b', kind: 'bounce', x: 20 })).toBeUndefined()
  })

  it('only carries dir on dash and otherId on collision', () => {
    expect(toActionMessage(flap)).toEqual({ kind: 'flap', playerId: 'a', x: 3, y: 4 })
    expect(toActionMessage(dash)).not.toHaveProperty('otherId')
    expect(toActionMessage(collision('a', 'b'))).not.toHaveProperty('dir')
  })

  it('drops extra fields from the wire', () => {
    expect(fromActionMessage({ ...toActionMessage(flap), dir: 1, otherId: 'b', junk: 1 })).toEqual(
      flap,
    )
  })

  it('rejects an unknown kind', () => {
    expect(fromActionMessage({ playerId: 'a', kind: 'teleport', x: 0, y: 0 })).toBeUndefined()
  })

  it.each([0, 2, '1', undefined])('rejects a dash with dir %s', (dir) => {
    expect(fromActionMessage({ playerId: 'a', kind: 'dash', x: 0, y: 0, dir })).toBeUndefined()
  })

  it('rejects a collision without a distinct other id', () => {
    expect(fromActionMessage({ playerId: 'a', kind: 'collision', x: 0, y: 0 })).toBeUndefined()
    expect(
      fromActionMessage({ playerId: 'a', kind: 'collision', x: 0, y: 0, otherId: 'a' }),
    ).toBeUndefined()
  })

  it.each([
    null,
    'flap',
    { kind: 'flap', x: 0, y: 0 },
    { playerId: '', kind: 'flap', x: 0, y: 0 },
    { playerId: 'a', kind: 'flap', x: '0', y: 0 },
    { playerId: 'a', kind: 'flap', x: 0, y: NaN },
  ])('rejects malformed message %j', (m) => {
    expect(fromActionMessage(m)).toBeUndefined()
  })
})

describe('shouldBroadcast', () => {
  it.each([dash, stall, flap, recharge, bounce])('broadcasts the local $kind', (e) => {
    expect(shouldBroadcast(e, 'a')).toBe(true)
  })

  it('does not broadcast another player’s event', () => {
    expect(shouldBroadcast(flap, 'b')).toBe(false)
  })

  it('broadcasts a collision only from the participant with the smaller id', () => {
    expect(shouldBroadcast(collision('a', 'b'), 'a')).toBe(true)
    expect(shouldBroadcast(collision('b', 'a'), 'b')).toBe(false)
  })

  it('compares ids lexicographically, not numerically', () => {
    expect(shouldBroadcast(collision('_10', '_9'), '_10')).toBe(true)
  })
})

describe('shouldShowRemote', () => {
  it('ignores echoes of own actions', () => {
    expect(shouldShowRemote(flap, 'a')).toBe(false)
  })

  it('shows another player’s action', () => {
    expect(shouldShowRemote(dash, 'b')).toBe(true)
  })

  it('ignores collisions this player took part in', () => {
    expect(shouldShowRemote(collision('a', 'b'), 'a')).toBe(false)
    expect(shouldShowRemote(collision('a', 'b'), 'b')).toBe(false)
  })

  it('shows a collision to a bystander', () => {
    expect(shouldShowRemote(collision('a', 'b'), 'c')).toBe(true)
  })
})
