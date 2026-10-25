import { describe, expect, it } from 'vitest'
import { appendEntry, FADE_MS, MAX_ENTRIES, SHOW_MS, visibleEntries, type ChatEntry } from './chatLog'

const entry = (key: number, at = 0): ChatEntry => ({
  key, playerId: 'p', name: 'Ann', color: '#fff', text: `m${key}`, quick: false, system: false, at,
})

describe('chatLog', () => {
  it('keeps only the newest lines', () => {
    let log: ChatEntry[] = []
    for (let i = 0; i < MAX_ENTRIES + 3; i++) log = appendEntry(log, entry(i))
    expect(log).toHaveLength(MAX_ENTRIES)
    expect(log[0]!.key).toBe(3)
  })

  it('shows everything while open', () => {
    const log = [entry(1, 0), entry(2, 100)]
    expect(visibleEntries(log, 1_000_000, true).map((v) => v.alpha)).toEqual([1, 1])
  })

  it('fades lines out while closed', () => {
    const log = [entry(1, 0), entry(2, SHOW_MS)]
    const half = visibleEntries(log, SHOW_MS + FADE_MS / 2, false)
    expect(half.map((v) => [v.entry.key, v.alpha])).toEqual([[1, 0.5], [2, 1]])
    expect(visibleEntries(log, SHOW_MS + FADE_MS, false).map((v) => v.entry.key)).toEqual([2])
  })
})
