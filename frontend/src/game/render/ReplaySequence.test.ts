import { describe, expect, it, vi } from 'vitest'
import { GROUP_PAD_PX, REPLAY_MIN_ZOOM, type Pose } from '../fx/replayCamera'
import type { PathSample } from '../race/pathRecorder'
import { ReplayPorts, ReplaySequence } from './ReplaySequence'

const bounds = { x: 0, y: 0, w: 16_000, h: 2000 }
const ENDED = 100_000
/** The race ran 6 s, so the server sends a 3 s replay beat (2×). */
const REPLAY = 3000
const ZOOM_IN = ENDED + 2500 + REPLAY
const LAP = ZOOM_IN + 800
const RESULTS = LAP + 4000
const paths = new Map<string, PathSample[]>([
  ['me', [{ t: 0, x: 100, y: 100 }, { t: 4000, x: 8000, y: 500 }]],
  ['you', [{ t: 0, x: 100, y: 200 }, { t: 6000, x: 6000, y: 900 }]],
])

const setup = (opts: { paths?: Map<string, PathSample[]> } = {}) => {
  const applied: Pose[] = []
  const sprites: Record<string, { x: number; y: number } | undefined> = {
    me: { x: 15_900, y: 1000 },
    you: { x: 9000, y: 800 },
  }
  const ports = {
    camera: {
      width: 1600,
      height: 900,
      current: (out: Pose) => Object.assign(out, { cx: 400, cy: 300, zoom: 1 }),
      begin: vi.fn(),
      apply: vi.fn((pose: Pose) => applied.push({ ...pose })),
      follow: vi.fn(),
      reset: vi.fn(),
    },
    paths: { setPaths: vi.fn(), update: vi.fn(), setAlpha: vi.fn(), clear: vi.fn() },
    players: {
      spriteFor: (id: string) => sprites[id],
      tintOf: (id: string) => (id === 'gone' ? undefined : 0xffffff),
      freezeRemote: vi.fn(),
    },
    director: { startVictoryLap: vi.fn(), endVictoryLap: vi.fn() },
  } satisfies ReplayPorts
  const seq = new ReplaySequence(ports)
  const last = () => applied[applied.length - 1]
  /** Frames at 60 Hz from `from` to `to` (server ms). */
  const play = (from: number, to: number) => {
    for (let t = from; t <= to; t += 1000 / 60) seq.update(t)
  }
  const startFinish = (winnerId = 'me', replayMs: number | undefined = REPLAY) =>
    seq.start({ reason: 'finish', winnerId, replayMs }, ENDED, bounds, opts.paths ?? paths, 'me')
  return { seq, ports, applied, last, sprites, play, startFinish }
}

describe('ReplaySequence', () => {
  it('leaves the camera alone until the zoom-out, then eases to frame where the heads start', () => {
    const { seq, ports, last, startFinish } = setup()
    startFinish()
    seq.update(ENDED + 1699)
    expect(ports.camera.begin).not.toHaveBeenCalled()
    expect(ports.camera.apply).not.toHaveBeenCalled()
    seq.update(ENDED + 1700)
    expect(ports.camera.begin).toHaveBeenCalledTimes(1)
    expect(last()).toEqual({ cx: 400, cy: 300, zoom: 1 })
    seq.update(ENDED + 2499)
    // Both heads start close together: centred between them at zoom 1
    expect(last().cx).toBeCloseTo(100, 0)
    expect(last().cy).toBeCloseTo(150, 0)
    expect(last().zoom).toBeCloseTo(1)
  })

  it('replays the routes at twice race speed, stopping at the last path end', () => {
    const { seq, ports, startFinish } = setup()
    startFinish('me', 4000)
    seq.update(ENDED + 2500)
    expect(ports.paths.setPaths).toHaveBeenCalledTimes(1)
    expect(ports.paths.update).toHaveBeenLastCalledWith(0, expect.any(Number))
    seq.update(ENDED + 2500 + 750)
    expect(ports.paths.update).toHaveBeenLastCalledWith(1500, expect.any(Number))
    // 4 s of beat would be 8 s of race; the race was only 6 s
    seq.update(ENDED + 2500 + 3999)
    expect(ports.paths.update.mock.lastCall![0]).toBe(6000)
  })

  it('fits the whole race into the beat for an older server with no replayMs', () => {
    const { seq, ports } = setup()
    seq.start({ reason: 'finish', winnerId: 'me' }, ENDED, bounds, paths, 'me')
    seq.update(ENDED + 2500 + 1250)
    expect(ports.paths.update.mock.lastCall![0]).toBeCloseTo(3000)
  })

  it('follows the group smoothly, settling on a fit of every head', () => {
    const { seq, last, play } = setup()
    seq.start({ reason: 'timeout', winnerId: null, replayMs: REPLAY }, ENDED, bounds, paths, 'me')
    play(ENDED + 1700, ENDED + 2500 + REPLAY + 2000)
    // Heads parked at (8000, 500) and (6000, 900): 2000 × 400, padded 140 px a side
    expect(last().cx).toBeCloseTo(7000, 0)
    expect(last().cy).toBeCloseTo(700, 0)
    // The zoom is the slower to settle (a 400 ms halflife)
    expect(last().zoom).toBeCloseTo((1600 - 280) / 2000, 1)
  })

  it('never jumps from frame to frame while following', () => {
    const { applied, play, startFinish } = setup()
    startFinish()
    play(ENDED + 1700, ZOOM_IN - 1)
    for (let i = 1; i < applied.length; i++) {
      // At 2× the heads cover at most ~70 px a frame here; the camera never outruns that much
      expect(Math.abs(applied[i].cx - applied[i - 1].cx)).toBeLessThan(150)
      expect(Math.abs(Math.log(applied[i].zoom / applied[i - 1].zoom))).toBeLessThan(0.05)
    }
  })

  it('never zooms out past the floor, even when the field spreads across the stage', () => {
    const wide = new Map<string, PathSample[]>([
      ['me', [{ t: 0, x: 0, y: 0 }, { t: 6000, x: 15_000, y: 0 }]],
      ['you', [{ t: 0, x: 0, y: 0 }, { t: 6000, x: 0, y: 1900 }]],
    ])
    const { applied, play, startFinish } = setup({ paths: wide })
    startFinish()
    play(ENDED + 1700, ZOOM_IN - 1)
    const lowest = Math.min(...applied.map((p) => p.zoom))
    expect(lowest).toBeGreaterThanOrEqual(REPLAY_MIN_ZOOM - 1e-9)
    expect(lowest).toBeLessThan(REPLAY_MIN_ZOOM + 0.01)
  })

  it('keeps the leader in frame when the field is too spread to fit, at every frame', () => {
    // The winner races off to the right while the other orb hangs back at the start
    const spread = new Map<string, PathSample[]>([
      ['me', [{ t: 0, x: 0, y: 500 }, { t: 6000, x: 15_000, y: 500 }]],
      ['you', [{ t: 0, x: 0, y: 500 }, { t: 6000, x: 200, y: 500 }]],
    ])
    const { seq, last, startFinish } = setup({ paths: spread })
    startFinish()
    const halfView = (pose: Pose) => (1600 / 2 - GROUP_PAD_PX) / pose.zoom
    for (let t = ENDED + 2500; t < ZOOM_IN; t += 1000 / 60) {
      seq.update(t)
      // Replayed race time at 2×, and the winner's head moves linearly along x
      const leaderX = Math.min(15_000, ((t - ENDED - 2500) * 2 * 15_000) / 6000)
      expect(Math.abs(last().cx - leaderX)).toBeLessThanOrEqual(halfView(last()) + 1e-6)
    }
  })

  it('keeps the timeout leader (the route ending nearest the finish) in frame', () => {
    const spread = new Map<string, PathSample[]>([
      ['me', [{ t: 0, x: 0, y: 500 }, { t: 6000, x: 200, y: 500 }]],
      ['you', [{ t: 0, x: 0, y: 500 }, { t: 6000, x: 15_000, y: 500 }]],
    ])
    const { seq, last } = setup({ paths: spread })
    seq.start({ reason: 'timeout', winnerId: null, replayMs: REPLAY }, ENDED, bounds, spread, 'me', { x: 15_500, y: 500 })
    seq.update(ENDED + 2500 + REPLAY + 2000)
    expect(15_000 - last().cx).toBeLessThanOrEqual((1600 / 2 - GROUP_PAD_PX) / last().zoom + 1e-6)
  })

  it('zooms in from the group to a local winner, then follows them through their lap', () => {
    const { seq, ports, last, play, startFinish } = setup()
    startFinish()
    play(ENDED + 1700, LAP - 1)
    // Aimed where the bounded follow will sit: pulled in from the stage's right edge
    expect(last().cx).toBeCloseTo(16_000 - 800, -1)
    expect(last().zoom).toBeCloseTo(1, 2)
    seq.update(LAP)
    expect(ports.camera.follow).toHaveBeenCalledWith({ x: 15_900, y: 1000 })
    expect(ports.director.startVictoryLap).toHaveBeenCalledTimes(1)
    expect(ports.paths.setAlpha).toHaveBeenLastCalledWith(0.4)
    const applies = ports.camera.apply.mock.calls.length
    seq.update(LAP + 1000)
    expect(ports.camera.apply.mock.calls.length).toBe(applies)
    seq.update(RESULTS)
    expect(ports.director.endVictoryLap).toHaveBeenCalledTimes(1)
  })

  it('starts the zoom-in from where the follow cam was', () => {
    const { seq, last, play, startFinish } = setup()
    startFinish()
    play(ENDED + 1700, ZOOM_IN - 1)
    const before = { ...last() }
    seq.update(ZOOM_IN)
    expect(last().cx).toBeCloseTo(before.cx, 0)
    expect(last().zoom).toBeCloseTo(before.zoom, 3)
  })

  it('lets a remote winner move for their lap and freezes them after', () => {
    const { seq, ports, startFinish } = setup()
    startFinish('you')
    seq.update(LAP + 100)
    expect(ports.camera.follow).toHaveBeenCalledWith({ x: 9000, y: 800 })
    expect(ports.players.freezeRemote).toHaveBeenLastCalledWith('you', false)
    expect(ports.director.startVictoryLap).not.toHaveBeenCalled()
    seq.update(RESULTS + 100)
    expect(ports.players.freezeRemote).toHaveBeenLastCalledWith('you', true)
  })

  it('runs every missed enter hook in order when a tab wakes late', () => {
    const { seq, ports, startFinish } = setup()
    startFinish()
    seq.update(RESULTS + 100)
    expect(ports.camera.begin).toHaveBeenCalledTimes(1)
    expect(ports.paths.setPaths).toHaveBeenCalledTimes(1)
    expect(ports.director.startVictoryLap).toHaveBeenCalledTimes(1)
    expect(ports.director.endVictoryLap).toHaveBeenCalledTimes(1)
  })

  it('keeps following the field after a timeout, with no zoom-in or lap', () => {
    const { seq, ports, last, play } = setup()
    seq.start({ reason: 'timeout', winnerId: null, replayMs: REPLAY }, ENDED, bounds, paths, 'me')
    play(ENDED + 1700, ENDED + 20_000)
    expect(last().cx).toBeCloseTo(7000, 0)
    expect(ports.camera.follow).not.toHaveBeenCalled()
    expect(ports.director.startVictoryLap).not.toHaveBeenCalled()
  })

  it('stays on the field when the winner has left before the lap', () => {
    const { ports, last, sprites, play, startFinish } = setup()
    startFinish('you')
    sprites.you = undefined
    play(ENDED + 1700, LAP + 2000)
    expect(last().cx).toBeCloseTo(7000, 0)
    expect(ports.camera.follow).not.toHaveBeenCalled()
    expect(ports.players.freezeRemote).not.toHaveBeenCalled()
  })

  it('drops the routes of players who have left', () => {
    const { seq, ports } = setup()
    const withGone = new Map(paths).set('gone', [{ t: 0, x: 99_999, y: 0 }])
    seq.start({ reason: 'finish', winnerId: 'me', replayMs: REPLAY }, ENDED, bounds, withGone, 'me')
    seq.update(ENDED + 2500)
    expect([...ports.paths.setPaths.mock.lastCall![0].keys()]).toEqual(['me', 'you'])
  })

  it('plays nothing for a skipped round', () => {
    const { seq, ports } = setup()
    seq.start({ reason: 'skipped', winnerId: null, replayMs: 0 }, ENDED, bounds, paths, 'me')
    expect(seq.active).toBe(false)
    seq.update(ENDED + 2000)
    expect(ports.camera.begin).not.toHaveBeenCalled()
    expect(ports.paths.setPaths).not.toHaveBeenCalled()
  })

  it('cancels once, putting everything back, and is safe to repeat', () => {
    const { seq, ports, startFinish } = setup()
    seq.cancel()
    expect(ports.camera.reset).not.toHaveBeenCalled()
    startFinish()
    seq.update(LAP + 100)
    seq.cancel()
    seq.cancel()
    expect(ports.camera.reset).toHaveBeenCalledTimes(1)
    expect(ports.director.endVictoryLap).toHaveBeenCalledTimes(1)
    expect(ports.paths.clear).toHaveBeenCalledTimes(1)
    const applies = ports.camera.apply.mock.calls.length
    seq.update(LAP + 1000)
    expect(ports.camera.apply.mock.calls.length).toBe(applies)
  })
})
