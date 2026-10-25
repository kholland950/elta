import { describe, expect, it } from 'vitest'
import { BEAT_MS } from '../race/replayTimeline'
import { IN_GAME_SET, isQuickLineId, lineForSlot, modeForBeat, quickChatMode, WINNER_SET } from './quickChat'

describe('modeForBeat', () => {
  it('is the in-game set with bubbles in live play', () => {
    expect(modeForBeat(null, false)).toEqual({ set: IN_GAME_SET, bubble: true })
  })

  it('lets everyone chat into the log during the replay beats', () => {
    for (const beat of ['disintegrate', 'pause', 'zoomOut', 'replay'] as const) {
      expect(modeForBeat(beat, false)).toEqual({ set: IN_GAME_SET, bubble: false })
      expect(modeForBeat(beat, true)).toEqual({ set: IN_GAME_SET, bubble: false })
    }
  })

  it('gives the celebration to the winner only, with the winner set', () => {
    for (const beat of ['zoomIn', 'victoryLap'] as const) {
      expect(modeForBeat(beat, true)).toEqual({ set: WINNER_SET, bubble: true })
      expect(modeForBeat(beat, false)).toBeNull()
    }
  })

  it('has no quick chat on the results', () => {
    expect(modeForBeat('results', true)).toBeNull()
    expect(modeForBeat('results', false)).toBeNull()
  })
})

describe('quickChatMode', () => {
  const endedAt = 10_000
  const replayMs = 2_000
  const replayAt = endedAt + BEAT_MS.disintegrate + BEAT_MS.pause + BEAT_MS.zoomOut + 1
  const lapAt = replayAt + replayMs + BEAT_MS.zoomIn
  const finish = { reason: 'finish' as const, winnerId: 'w', endedAt, replayMs }

  it('is live with no round end shown', () => {
    expect(quickChatMode(null, 'a', 0)?.bubble).toBe(true)
  })

  it('follows the round-end timeline for a finish', () => {
    expect(quickChatMode(finish, 'a', replayAt)).toEqual({ set: IN_GAME_SET, bubble: false })
    expect(quickChatMode(finish, 'w', lapAt)).toEqual({ set: WINNER_SET, bubble: true })
    expect(quickChatMode(finish, 'a', lapAt)).toBeNull()
    expect(quickChatMode(finish, 'w', lapAt + BEAT_MS.victoryLap)).toBeNull()
  })

  it('stays on results long after the timeline', () => {
    expect(quickChatMode(finish, 'w', endedAt + 600_000)).toBeNull()
  })

  it('has no celebration after a timeout: the replay, then results', () => {
    const timeout = { ...finish, reason: 'timeout' as const, winnerId: null }
    expect(quickChatMode(timeout, 'a', replayAt)?.set).toBe(IN_GAME_SET)
    expect(quickChatMode(timeout, 'a', replayAt + replayMs)).toBeNull()
  })

  it('goes straight to results after a skip', () => {
    expect(quickChatMode({ ...finish, reason: 'skipped', winnerId: null }, 'a', endedAt)).toBeNull()
  })
})

describe('lines', () => {
  it('maps slots 1-4 to the mode set', () => {
    expect(lineForSlot({ set: WINNER_SET, bubble: true }, 2)).toBe('ez')
    expect(lineForSlot({ set: IN_GAME_SET, bubble: true }, 5)).toBeUndefined()
    expect(lineForSlot(null, 1)).toBeUndefined()
  })

  it('knows its line ids and nothing else', () => {
    expect(isQuickLineId('wtf')).toBe(true)
    expect(isQuickLineId('toString')).toBe(false)
  })
})
