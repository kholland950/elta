import { describe, expect, it } from 'vitest'
import { FeelEvent, FeelSink, restoresCharge } from './feelEvents'

describe('restoresCharge', () => {
  it('is false when stall and every dash are already available', () => {
    expect(restoresCharge({ canStall: true, dashes: 2 }, 2)).toBe(false)
  })

  it('is true when the stall has been used', () => {
    expect(restoresCharge({ canStall: false, dashes: 2 }, 2)).toBe(true)
  })

  it('is true when any dash has been used', () => {
    expect(restoresCharge({ canStall: true, dashes: 1 }, 2)).toBe(true)
    expect(restoresCharge({ canStall: true, dashes: 0 }, 2)).toBe(true)
  })

  it('fires once per refill when contact repeats every frame', () => {
    const sink = recordingSink()
    const charge = { canStall: false, dashes: 0 }
    for (let frame = 0; frame < 5; frame++) {
      if (restoresCharge(charge, 2)) sink.emit({ kind: 'recharge', x: 0, y: 0 })
      charge.canStall = true
      charge.dashes = 2
    }
    expect(sink.events).toEqual([{ kind: 'recharge', x: 0, y: 0 }])
  })
})

const recordingSink = (): FeelSink & { events: FeelEvent[] } => {
  const events: FeelEvent[] = []
  return { events, emit: (e) => void events.push(e) }
}
