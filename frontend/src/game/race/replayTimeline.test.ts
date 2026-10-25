import { describe, expect, it } from 'vitest'
import { beatAt, fixedReplayMs, ReplayCursor, replayMs, replayTimeline, resultsShownAt } from './replayTimeline'

describe('replayTimeline', () => {
  it('matches the server fixed replay beats in Timings.kt', () => {
    expect(fixedReplayMs('finish')).toBe(7300)
    expect(fixedReplayMs('timeout')).toBe(2500)
    expect(fixedReplayMs('skipped')).toBe(0)
  })

  it('adds the replay beat the round end sends, or the fallback without one', () => {
    expect(replayMs('finish', 12_000)).toBe(19_300)
    expect(replayMs('timeout', 60_000)).toBe(62_500)
    expect(replayMs('skipped', 0)).toBe(0)
    expect(replayMs('finish')).toBe(9800)
    expect(replayMs('timeout')).toBe(5000)
  })

  it('sizes the replay beat from the round end', () => {
    const tl = replayTimeline('finish', 0, 10_000)
    expect(beatAt(tl, 2500).kind).toBe('replay')
    expect(beatAt(tl, 12_499).kind).toBe('replay')
    expect(beatAt(tl, 12_500).kind).toBe('zoomIn')
    expect(beatAt(tl, 7300 + 10_000 - 1).kind).toBe('victoryLap')
    expect(beatAt(tl, 7300 + 10_000).kind).toBe('results')
    // A zero-length replay is still entered, and passes at once
    const none = new ReplayCursor(replayTimeline('timeout', 0, 0))
    expect(none.advance(2500).entered).toEqual(['disintegrate', 'pause', 'zoomOut', 'replay', 'results'])
  })

  it('walks every finish beat at its boundaries', () => {
    const tl = replayTimeline('finish', 1000)
    const at = (t: number) => beatAt(tl, 1000 + t).kind
    expect(at(-1)).toBe('disintegrate')
    expect(at(0)).toBe('disintegrate')
    expect(at(1199)).toBe('disintegrate')
    expect(at(1200)).toBe('pause')
    expect(at(1700)).toBe('zoomOut')
    expect(at(2500)).toBe('replay')
    expect(at(4999)).toBe('replay')
    expect(at(5000)).toBe('zoomIn')
    expect(at(5800)).toBe('victoryLap')
    expect(at(9799)).toBe('victoryLap')
    expect(at(9800)).toBe('results')
    expect(at(99_999)).toBe('results')
  })

  it('goes from the replay straight to results on a timeout', () => {
    const tl = replayTimeline('timeout', 0)
    expect(beatAt(tl, 4999).kind).toBe('replay')
    expect(beatAt(tl, 5000).kind).toBe('results')
  })

  it('has only the results beat after a skip', () => {
    expect(replayTimeline('skipped', 0).map((s) => s.kind)).toEqual(['results'])
  })

  it('reports progress and time left within a beat', () => {
    const tl = replayTimeline('finish', 0)
    expect(beatAt(tl, 2500)).toEqual({ kind: 'replay', p: 0, leftMs: 2500 })
    expect(beatAt(tl, 3750)).toEqual({ kind: 'replay', p: 0.5, leftMs: 1250 })
    expect(beatAt(tl, -500)).toEqual({ kind: 'disintegrate', p: 0, leftMs: 1700 })
    expect(beatAt(tl, 50_000)).toMatchObject({ kind: 'results', p: 1, leftMs: 0 })
  })
})

describe('resultsShownAt', () => {
  it('waits out the replay from endedAt', () => {
    expect(resultsShownAt({ reason: 'finish', endedAt: 100 }, 999)).toBe(9900)
    expect(resultsShownAt({ reason: 'skipped', endedAt: 100 }, 999)).toBe(100)
  })

  it('falls back to the arrival time without endedAt', () => {
    expect(resultsShownAt({ reason: 'timeout' }, 200)).toBe(5200)
  })

  it('waits for the replay beat the round end sends', () => {
    expect(resultsShownAt({ reason: 'finish', endedAt: 100, replayMs: 15_000 }, 999)).toBe(100 + 7300 + 15_000)
    expect(resultsShownAt({ reason: 'skipped', endedAt: 100, replayMs: 0 }, 999)).toBe(100)
  })
})

describe('ReplayCursor', () => {
  it('enters each beat once, in order, even when frames skip past some', () => {
    const cursor = new ReplayCursor(replayTimeline('finish', 0))
    expect(cursor.advance(-10).entered).toEqual([])
    expect(cursor.advance(0).entered).toEqual(['disintegrate'])
    expect(cursor.advance(100).entered).toEqual([])
    expect(cursor.advance(5100).entered).toEqual(['pause', 'zoomOut', 'replay', 'zoomIn'])
    expect(cursor.advance(20_000).entered).toEqual(['victoryLap', 'results'])
    expect(cursor.advance(30_000).entered).toEqual([])
  })
})
