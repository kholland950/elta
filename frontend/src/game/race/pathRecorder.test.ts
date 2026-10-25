import { describe, expect, it } from 'vitest'
import { PATH_CAP, PATH_MIN_DIST, PathRecorder } from './pathRecorder'

const GO = 10_000

const recorder = () => {
  const r = new PathRecorder()
  r.begin(GO)
  return r
}

describe('PathRecorder', () => {
  it('ignores samples before GO and before begin', () => {
    const idle = new PathRecorder()
    idle.record('a', GO, 0, 0)
    expect(idle.finalize(GO + 1000, []).size).toBe(0)

    const r = recorder()
    r.record('a', GO - 1, 999, 999)
    r.record('a', GO, 0, 0)
    expect(r.finalize(GO + 1000, []).get('a')).toEqual([{ t: 0, x: 0, y: 0 }])
  })

  it('keeps a sample only once it is far enough from the last kept one', () => {
    const r = recorder()
    for (let i = 0; i <= 10; i++) r.record('a', GO + i * 10, i * 5, 0)
    const path = r.finalize(GO + 100, [])!.get('a')!
    // Every 5 px over 50 px: kept at 0, 25 and 50 (the last is flushed as the end point)
    expect(path.map((s) => s.x)).toEqual([0, 25, 50])
    for (let i = 1; i < path.length; i++) expect(path[i].x - path[i - 1].x).toBeGreaterThanOrEqual(PATH_MIN_DIST)
  })

  it('anchors the end of a wait so the line pauses there', () => {
    const r = recorder()
    r.record('a', GO, 0, 0)
    // Sits within reach for a second, then leaves
    for (let t = 10; t <= 1000; t += 10) r.record('a', GO + t, 2, 0)
    r.record('a', GO + 1010, 100, 0)
    const path = r.finalize(GO + 1010, [])!.get('a')!
    expect(path).toEqual([
      { t: 0, x: 0, y: 0 },
      { t: 1000, x: 2, y: 0 },
      { t: 1010, x: 100, y: 0 },
    ])
  })

  it('anchors the sample before a long gap in moves', () => {
    const r = recorder()
    r.record('a', GO, 0, 0)
    r.record('a', GO + 100, 10, 0)
    // No moves for 2 s (a remote orb sitting still), then it goes on
    r.record('a', GO + 2100, 11, 0)
    r.record('a', GO + 2200, 80, 0)
    const path = r.finalize(GO + 2200, [])!.get('a')!
    expect(path.map((s) => s.t)).toEqual([0, 100, 2100, 2200])
  })

  it('does not pile up samples while sitting still', () => {
    const r = recorder()
    for (let t = 0; t <= 60_000; t += 8) r.record('a', GO + t, 0, 0)
    expect(r.finalize(GO + 60_000, [])!.get('a')!.length).toBeLessThanOrEqual(2)
  })

  it('halves the path and doubles the spacing at the cap', () => {
    const r = recorder()
    const steps = PATH_CAP + 10
    for (let i = 0; i < steps; i++) r.record('a', GO + i * 10, i * PATH_MIN_DIST, 0)
    const path = r.finalize(GO + steps * 10, [])!.get('a')!
    expect(path.length).toBeLessThanOrEqual(PATH_CAP)
    expect(path.length).toBeGreaterThan(PATH_CAP / 2)
    expect(path[0]).toEqual({ t: 0, x: 0, y: 0 })
    for (let i = 1; i < path.length; i++) expect(path[i].t).toBeGreaterThan(path[i - 1].t)
    // Past the cap new samples come every 2 × the old spacing (the end point is just the last seen)
    const tail = path.slice(-5, -1)
    for (let i = 1; i < tail.length; i++) expect(tail[i].x - tail[i - 1].x).toBeGreaterThanOrEqual(2 * PATH_MIN_DIST)
  })

  it('ends a finisher at their race time and everyone else at the round end', () => {
    const r = recorder()
    for (let i = 0; i <= 100; i++) {
      r.record('win', GO + i * 100, i * 100, 0)
      r.record('lose', GO + i * 100, 0, i * 100)
    }
    const paths = r.finalize(GO + 5050, [{ playerId: 'win', raceTimeMs: 3050 }])
    const win = paths.get('win')!
    expect(win[win.length - 1]).toEqual({ t: 3050, x: 3050, y: 0 })
    const lose = paths.get('lose')!
    expect(lose[lose.length - 1]).toEqual({ t: 5050, x: 0, y: 5050 })
  })

  it('stops recording once finalized, until the next begin', () => {
    const r = recorder()
    r.record('a', GO, 0, 0)
    r.finalize(GO + 100, [])
    r.record('a', GO + 200, 500, 0)
    r.begin(GO + 1000)
    expect(r.finalize(GO + 2000, []).size).toBe(0)
  })

  it('takes a replaced path as it is', () => {
    const r = recorder()
    r.record('a', GO, 0, 0)
    r.replace('a', [
      { t: 0, x: 5, y: 5 },
      { t: 500, x: 50, y: 5 },
    ])
    expect(r.finalize(GO + 1000, []).get('a')).toEqual([
      { t: 0, x: 5, y: 5 },
      { t: 500, x: 50, y: 5 },
    ])
  })
})
