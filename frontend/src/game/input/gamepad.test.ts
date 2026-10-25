import { describe, expect, it } from 'vitest'
import {
  MAX_BUTTONS,
  MenuRepeater,
  mergePads,
  PadReader,
  stickX,
  type MergedPads,
  type PadLike,
} from './gamepad'

/** A connected standard pad with the given buttons held (index → value) and left stick. */
const fakePad = ({
  held = {},
  x = 0,
  y = 0,
  connected = true,
}: { held?: Record<number, number>; x?: number; y?: number; connected?: boolean } = {}): PadLike => ({
  connected,
  buttons: Array.from({ length: 17 }, (_, i) => {
    const value = held[i] ?? 0
    // Real pads report digital buttons as pressed with value 1, and triggers by value
    return { pressed: value === 1, value }
  }),
  axes: [x, y, 0, 0],
})

const merged = (): MergedPads => ({ down: new Array(MAX_BUTTONS).fill(false), x: 0, y: 0 })

describe('stickX', () => {
  it('reads 0 inside the deadzone, full past saturation and linear between', () => {
    expect(stickX(0)).toBe(0)
    expect(stickX(0.19)).toBe(0)
    expect(stickX(-0.19)).toBe(0)
    expect(stickX(0.2)).toBe(0)
    expect(stickX(0.575)).toBeCloseTo(0.5, 6)
    expect(stickX(-0.575)).toBeCloseTo(-0.5, 6)
    expect(stickX(0.95)).toBe(1)
    expect(stickX(-1)).toBe(-1)
  })
})

describe('mergePads', () => {
  it('holds a button held on any connected pad and skips empty or disconnected ones', () => {
    const pads = [
      null,
      fakePad({ held: { 0: 1 } }),
      fakePad({ held: { 5: 1 } }),
      fakePad({ held: { 2: 1 }, connected: false }),
    ]
    const out = mergePads(pads, merged())
    expect(out.down[0]).toBe(true)
    expect(out.down[5]).toBe(true)
    expect(out.down[2]).toBe(false)
  })

  it('counts a trigger pulled past half as down', () => {
    expect(mergePads([fakePad({ held: { 7: 0.6 } })], merged()).down[7]).toBe(true)
    expect(mergePads([fakePad({ held: { 7: 0.4 } })], merged()).down[7]).toBe(false)
  })

  it('takes the stick pushed furthest', () => {
    const out = mergePads([fakePad({ x: 0.3 }), fakePad({ x: -0.1, y: 0.9 })], merged())
    expect(out).toMatchObject({ x: -0.1, y: 0.9 })
  })
})

describe('PadReader', () => {
  it('reports each press and release once', () => {
    const reader = new PadReader()
    expect(reader.poll([fakePad()]).downs).toEqual([])
    expect(reader.poll([fakePad({ held: { 0: 1, 4: 1 } })]).downs).toEqual([0, 4])
    const held = reader.poll([fakePad({ held: { 0: 1, 4: 1 } })])
    expect([held.downs, held.ups]).toEqual([[], []])
    const released = reader.poll([fakePad({ held: { 4: 1 } })])
    expect([released.downs, released.ups]).toEqual([[], [0]])
    expect(reader.isDown(4)).toBe(true)
    expect(reader.isDown(0)).toBe(false)
  })

  it('reuses its result between polls', () => {
    const reader = new PadReader()
    expect(reader.poll([fakePad()])).toBe(reader.poll([fakePad({ held: { 0: 1 } })]))
  })

  it('merges buttons across pads, so a button held on two pads releases when both let go', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 0: 1 } }), fakePad({ held: { 0: 1 } })])
    expect(reader.poll([fakePad(), fakePad({ held: { 0: 1 } })]).ups).toEqual([])
    expect(reader.poll([fakePad(), fakePad()]).ups).toEqual([0])
  })

  it('releases every held button when the pad disconnects', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 0: 1, 14: 1 }, x: 0.9 })])
    const gone = reader.poll([null])
    expect(gone.ups).toEqual([0, 14])
    expect(gone.stickX).toBe(0)
    expect(reader.poll([fakePad({ held: { 0: 1 } })]).downs).toEqual([0])
  })

  it('keeps buttons held at a reset quiet until they are let go', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 0: 1 } })])
    reader.reset()
    expect(reader.isDown(0)).toBe(false)
    const held = reader.poll([fakePad({ held: { 0: 1, 1: 1 } })])
    expect(held.downs).toEqual([1])
    expect(reader.isDown(0)).toBe(false)
    // Its release is no event either: nothing saw it go down
    expect(reader.poll([fakePad({ held: { 1: 1 } })]).ups).toEqual([])
    expect(reader.poll([fakePad({ held: { 0: 1, 1: 1 } })]).downs).toEqual([0])
    expect(reader.isDown(0)).toBe(true)
  })

  it('quiets a single held button on request', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 12: 1 } })])
    reader.suppress(12)
    reader.suppress(13)
    expect(reader.isDown(12)).toBe(false)
    expect(reader.poll([fakePad()]).ups).toEqual([])
    expect(reader.poll([fakePad({ held: { 13: 1 } })]).downs).toEqual([13])
  })

  it('keeps a held stick out of the menu after a reset until it returns to centre, but still steers', () => {
    const reader = new PadReader()
    expect(reader.poll([fakePad({ x: 0.95 })]).stickX).toBe(1)
    reader.reset()
    expect(reader.poll([fakePad({ x: 0.95, y: 0.3 })]).stickX).toBe(1)
    expect(reader.menuPush()).toEqual({ x: 0, y: 0 })
    expect(reader.poll([fakePad({ x: 0.1 })]).stickX).toBe(0)
    expect(reader.poll([fakePad({ x: -0.95, y: 0.5 })]).stickX).toBe(-1)
    expect(reader.menuPush()).toEqual({ x: -0.95, y: 0.5 })
  })

  it('needs no centring after a reset with the stick at rest', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ x: 0.05 })])
    reader.reset()
    reader.poll([fakePad({ x: 0.6 })])
    expect(reader.menuPush().x).toBe(0.6)
  })
})

describe('PadReader menu input', () => {
  it('pushes the menu with the D-pad over the stick, and with the stick otherwise', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ x: 0.3, y: -0.7 })])
    expect(reader.menuPush()).toEqual({ x: 0.3, y: -0.7 })
    reader.poll([fakePad({ held: { 13: 1, 14: 1 }, x: 0.3 })])
    expect(reader.menuPush()).toEqual({ x: -1, y: 1 })
  })

  it('leaves out a D-pad press suppressed after the poll', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 12: 1 } })])
    reader.suppress(12)
    expect(reader.menuPush()).toEqual({ x: 0, y: 0 })
  })

  it('leaves out a D-pad direction held over from before a reset', () => {
    const reader = new PadReader()
    reader.poll([fakePad({ held: { 15: 1 } })])
    reader.reset()
    reader.poll([fakePad({ held: { 15: 1 } })])
    expect(reader.menuPush()).toEqual({ x: 0, y: 0 })
  })
})

describe('MenuRepeater', () => {
  it('moves at once, again after 400 ms, then every 120 ms', () => {
    const r = new MenuRepeater()
    const fired: Array<[number, string | null]> = []
    for (const t of [0, 100, 399, 400, 450, 519, 520, 640, 760]) fired.push([t, r.update(0, 1, t)])
    expect(fired.filter(([, dir]) => dir !== null)).toEqual([
      [0, 'down'],
      [400, 'down'],
      [520, 'down'],
      [640, 'down'],
      [760, 'down'],
    ])
  })

  it('does not burst after a late frame', () => {
    const r = new MenuRepeater()
    r.update(1, 0, 0)
    expect(r.update(1, 0, 1000)).toBe('right')
    expect(r.update(1, 0, 1016)).toBeNull()
    expect(r.update(1, 0, 1120)).toBe('right')
  })

  it('enters at 0.5 and lets go below 0.35', () => {
    const r = new MenuRepeater()
    expect(r.update(0.45, 0, 0)).toBeNull()
    expect(r.update(0.5, 0, 10)).toBe('right')
    // Dipping between the two thresholds is still the same hold: no fresh move
    expect(r.update(0.4, 0, 20)).toBeNull()
    expect(r.update(0.6, 0, 30)).toBeNull()
    expect(r.update(0.3, 0, 40)).toBeNull()
    expect(r.update(0.6, 0, 50)).toBe('right')
  })

  it('follows the axis pushed furthest and switches at once', () => {
    const r = new MenuRepeater()
    expect(r.update(0.3, -0.8, 0)).toBe('up')
    expect(r.update(-0.9, -0.4, 10)).toBe('left')
    expect(r.update(-0.2, 0.1, 20)).toBeNull()
    expect(r.update(-0.2, 0.7, 30)).toBe('down')
  })

  it('moves at once after a reset even while held', () => {
    const r = new MenuRepeater()
    r.update(0, -1, 0)
    r.reset()
    expect(r.update(0, -1, 10)).toBe('up')
  })
})
