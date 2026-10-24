import { describe, expect, it, vi } from 'vitest'
import { archetypeForSeed } from './archetype'
import {
  canVoteSkip,
  emptyMatch,
  exploreLeftMs,
  hiddenRemoteIds,
  iReturned,
  lobbySlotIndex,
  MatchEvent,
  MatchSource,
  MatchTracker,
  MatchView,
  reduceMatch,
  remotePlayers,
  returnedRemoteIds,
  shownVotes,
  stageFor,
  startSlotIndex,
} from './match'
import { lobbyRoom } from './lobbyRoom'
import type { RoundEndMessage, RoundStartMessage, ServerMessages } from './protocol'

/** A fake connection: `emit` delivers a server message to every subscriber. */
class FakeConnection implements MatchSource {
  playerId: string | null = null
  private listeners = new Map<string, Set<(data: unknown) => void>>()

  on<E extends MatchEvent>(event: E, cb: (data: ServerMessages[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as (data: unknown) => void)
    this.listeners.set(event, set)
    return () => set.delete(cb as (data: unknown) => void)
  }

  emit<E extends MatchEvent>(event: E, data: ServerMessages[E]) {
    if (event === 'joined') this.playerId = (data as ServerMessages['joined']).playerId
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }

  listenerCount() {
    let n = 0
    this.listeners.forEach((set) => (n += set.size))
    return n
  }
}

const settings = { winsToMatch: 3 as const, difficulty: 4 }
const player = (id: string, wins = 0) => ({ id, name: `p${id}`, color: 'Blue', wins })
const roomState = (phase: 'lobby' | 'match', ids: string[]): ServerMessages['roomState'] => ({
  roomId: 'abcd',
  hostId: ids[0],
  phase,
  settings,
  players: ids.map((id) => player(id)),
})
const roundStart = (round: number, seed = 42): RoundStartMessage => ({
  round,
  seed,
  difficulty: 4 + round - 1,
  archetype: 'tower',
  startOrder: ['b', 'a', 'c'],
  exploreAt: 1000,
  snapAt: 16000,
  goAt: 19500,
})
const roundEnd = (round: number, winnerId: string | null): RoundEndMessage => ({
  round,
  winnerId,
  reason: winnerId ? 'finish' : 'skipped',
  times: winnerId ? [{ playerId: winnerId, raceTimeMs: 51234.5 }] : [],
  wins: winnerId ? { [winnerId]: 1 } : {},
  nextRoundAt: 30000,
  matchWinnerId: null,
})

const joinedAs = (me: string): MatchView =>
  reduceMatch(emptyMatch(), { event: 'joined', data: { playerId: me, roomId: 'abcd', serverTime: 0, resumeToken: 't' } })

describe('reduceMatch', () => {
  it('shows the lobby room until the first roundStart, then that round', () => {
    let view = joinedAs('a')
    view = reduceMatch(view, { event: 'roomState', data: roomState('lobby', ['a', 'b']) })
    expect(stageFor(view)).toEqual({ key: 'lobby', kind: 'lobby' })
    view = reduceMatch(view, { event: 'roomState', data: roomState('match', ['a', 'b']) })
    expect(stageFor(view).key).toBe('lobby')
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(1) })
    expect(stageFor(view)).toEqual({ key: 'round 1', kind: 'race', seed: 42, difficulty: 4, bays: 3, archetype: 'tower' })
  })

  it('builds one start bay per player in startOrder, clamped to 1–8', () => {
    const base = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a']) })
    const bays = (order: Array<string>) => {
      const choice = stageFor(reduceMatch(base, { event: 'roundStart', data: { ...roundStart(1), startOrder: order } }))
      return choice.kind === 'race' ? choice.bays : undefined
    }
    expect(bays(['a'])).toBe(1)
    expect(bays(['c', 'a', 'b'])).toBe(3)
    expect(bays([])).toBe(1)
    expect(bays('abcdefghij'.split(''))).toBe(8)
  })

  it("builds the server's archetype, falling back to the seed's when it is missing or unknown", () => {
    const base = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a']) })
    const archetypeOf = (extra: Record<string, unknown>, seed = 42) => {
      // A server from before the field (or a stale message) sends none
      const { archetype: _sent, ...withoutArchetype } = roundStart(1, seed)
      const data = { ...withoutArchetype, ...extra } as RoundStartMessage
      const choice = stageFor(reduceMatch(base, { event: 'roundStart', data }))
      return choice.kind === 'race' ? choice.archetype : undefined
    }
    expect(archetypeOf({ archetype: 'canyon' })).toBe('canyon')
    expect(archetypeOf({ archetype: 'tower' }, 7)).toBe('tower')
    // 42 % 5 = 2 and 7 % 5 = 2: labyrinth; 43 % 5 = 3: speedway
    expect(archetypeOf({})).toBe('labyrinth')
    expect(archetypeOf({ archetype: 'volcano' }, 43)).toBe('speedway')
    expect(archetypeOf({ archetype: 3 })).toBe(archetypeForSeed(42))
  })

  it('keeps the round stage through its end and changes it on the next roundStart', () => {
    let view = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a']) })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(1) })
    view = reduceMatch(view, { event: 'roundEnd', data: roundEnd(1, 'a') })
    expect(view.ended?.winnerId).toBe('a')
    expect(stageFor(view).key).toBe('round 1')
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(2, 7) })
    expect(view.ended).toBeNull()
    expect(stageFor(view)).toMatchObject({ key: 'round 2', seed: 7, difficulty: 5 })
  })

  it('returns to the lobby room when the room goes back to the lobby', () => {
    let view = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a']) })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(3) })
    view = reduceMatch(view, { event: 'roundEnd', data: roundEnd(3, 'a') })
    view = reduceMatch(view, { event: 'roomState', data: roomState('lobby', ['a']) })
    expect(view.round).toBeNull()
    expect(view.ended).toBeNull()
    expect(stageFor(view).key).toBe('lobby')
  })

  it('ignores a roundEnd or skipVotes for another round', () => {
    let view = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a']) })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(2) })
    view = reduceMatch(view, { event: 'roundEnd', data: roundEnd(1, 'a') })
    view = reduceMatch(view, { event: 'skipVotes', data: { round: 1, votes: 1, needed: 1 } })
    expect(view.ended).toBeNull()
    expect(view.votes).toBeNull()
  })

  it('tracks skip votes for the running round and stops offering the vote once it ends', () => {
    let view = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a', 'b', 'c']) })
    expect(canVoteSkip(view)).toBe(false)
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(1) })
    expect(canVoteSkip(view)).toBe(true)
    expect(shownVotes(view)).toEqual({ votes: 0, needed: 3 })
    view = reduceMatch(view, { event: 'skipVotes', data: { round: 1, votes: 1, needed: 3 } })
    expect(shownVotes(view)).toEqual({ votes: 1, needed: 3 })
    view = reduceMatch(view, { event: 'playerLeft', data: { playerId: 'c' } })
    view = reduceMatch(view, { event: 'skipVotes', data: { round: 1, votes: 1, needed: 2 } })
    expect(shownVotes(view)).toEqual({ votes: 1, needed: 2 })
    view = reduceMatch(view, { event: 'roundEnd', data: roundEnd(1, null) })
    expect(canVoteSkip(view)).toBe(false)
    expect(shownVotes(view)).toBeNull()
  })

  it('a new round starts with no votes', () => {
    let view = reduceMatch(joinedAs('a'), { event: 'roomState', data: roomState('match', ['a', 'b']) })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(1) })
    view = reduceMatch(view, { event: 'skipVotes', data: { round: 1, votes: 1, needed: 2 } })
    view = reduceMatch(view, { event: 'roundEnd', data: roundEnd(1, 'b') })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(2) })
    expect(shownVotes(view)).toEqual({ votes: 0, needed: 2 })
  })

  it('lists the other players in join order and drops one who left', () => {
    let view = reduceMatch(joinedAs('b'), { event: 'roomState', data: roomState('lobby', ['a', 'b', 'c']) })
    expect(remotePlayers(view).map((p) => p.id)).toEqual(['a', 'c'])
    view = reduceMatch(view, { event: 'playerLeft', data: { playerId: 'a' } })
    expect(remotePlayers(view).map((p) => p.id)).toEqual(['c'])
  })
})

describe('start slots', () => {
  it('uses the index in startOrder', () => {
    expect(startSlotIndex(['b', 'a', 'c'], 'b', 8)).toBe(0)
    expect(startSlotIndex(['b', 'a', 'c'], 'c', 8)).toBe(2)
  })

  it('puts a missing or unknown player after everyone, within the slots', () => {
    expect(startSlotIndex(['b', 'a'], 'z', 8)).toBe(2)
    expect(startSlotIndex(['b', 'a'], null, 8)).toBe(2)
    expect(startSlotIndex(['a', 'b', 'c'], 'c', 2)).toBe(1)
  })

  it('spreads the lobby by join order', () => {
    const view = reduceMatch(joinedAs('c'), { event: 'roomState', data: roomState('lobby', ['a', 'b', 'c']) })
    expect(lobbySlotIndex(view, 8)).toBe(2)
    expect(lobbySlotIndex(emptyMatch('x'), 8)).toBe(0)
  })
})

describe('exploreLeftMs', () => {
  const plan = { exploreAt: 1000, snapAt: 16000, goAt: 19500 }
  it('is the full explore before it starts, counts down, and stops at 0', () => {
    expect(exploreLeftMs(plan, 0)).toBe(15000)
    expect(exploreLeftMs(plan, 1000)).toBe(15000)
    expect(exploreLeftMs(plan, 15500)).toBe(500)
    expect(exploreLeftMs(plan, 17000)).toBe(0)
  })
})

describe('MatchTracker', () => {
  it('collects messages that arrive before anyone listens and reports later ones', () => {
    const conn = new FakeConnection()
    const tracker = new MatchTracker(conn)
    conn.emit('joined', { playerId: 'a', roomId: 'abcd', serverTime: 0, resumeToken: 't' })
    conn.emit('roomState', roomState('match', ['a', 'b']))
    conn.emit('roundStart', roundStart(1))
    expect(tracker.view.me).toBe('a')
    expect(stageFor(tracker.view).key).toBe('round 1')

    const listener = vi.fn()
    tracker.onChange(listener)
    conn.emit('roundEnd', roundEnd(1, 'b'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].ended.winnerId).toBe('b')
    expect(listener.mock.calls[0][1].event).toBe('roundEnd')
  })

  it('starts from the connection id when joined already arrived', () => {
    const conn = new FakeConnection()
    conn.playerId = 'q'
    expect(new MatchTracker(conn).view.me).toBe('q')
  })

  it('unsubscribes on dispose', () => {
    const conn = new FakeConnection()
    const tracker = new MatchTracker(conn)
    expect(conn.listenerCount()).toBe(7)
    tracker.dispose()
    expect(conn.listenerCount()).toBe(0)
  })
})

describe('the lobby room', () => {
  it('has a spawn for every player in a full room', () => {
    expect(lobbyRoom().startSlots.length).toBeGreaterThanOrEqual(8)
  })
})

describe('return to lobby', () => {
  const lobbyReturn = (returned: string[]) => ({ event: 'lobbyReturn' as const, data: { returned, lobbyAt: 60000 } })
  /** A three-player match that just ended, seen by `me`. */
  const overFor = (me: string) => {
    let view = reduceMatch(joinedAs(me), { event: 'roomState', data: roomState('match', ['a', 'b', 'c']) })
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(3) })
    view = reduceMatch(view, { event: 'roundEnd', data: { ...roundEnd(3, 'a'), matchWinnerId: 'a' } })
    return reduceMatch(view, lobbyReturn([]))
  }
  const ids = (set: ReadonlySet<string>) => [...set].sort()

  it('keeps the latest returned list during the match-over wait', () => {
    let view = overFor('a')
    expect(view.returned).toEqual([])
    view = reduceMatch(view, lobbyReturn(['b']))
    view = reduceMatch(view, lobbyReturn(['b', 'c']))
    expect(view.returned).toEqual(['b', 'c'])
  })

  it('counts me as returned when I am in the list, or once the phase is lobby', () => {
    let view = overFor('a')
    expect(iReturned(view)).toBe(false)
    view = reduceMatch(view, lobbyReturn(['b']))
    expect(iReturned(view)).toBe(false)
    view = reduceMatch(view, lobbyReturn(['b', 'a']))
    expect(iReturned(view)).toBe(true)
    expect(iReturned(reduceMatch(overFor('a'), { event: 'roomState', data: roomState('lobby', ['a', 'b', 'c']) }))).toBe(true)
    expect(iReturned(emptyMatch('a'))).toBe(true)
  })

  it('lists the returned remote players, never me', () => {
    const view = reduceMatch(overFor('a'), lobbyReturn(['a', 'c']))
    expect(ids(returnedRemoteIds(view))).toEqual(['c'])
  })

  it('moves me to the lobby room as soon as I return, while the phase is still match', () => {
    let view = overFor('a')
    expect(stageFor(view).kind).toBe('race')
    view = reduceMatch(view, lobbyReturn(['b']))
    expect(stageFor(view).kind).toBe('race')
    view = reduceMatch(view, lobbyReturn(['b', 'a']))
    expect(view.phase).toBe('match')
    expect(stageFor(view)).toEqual({ key: 'lobby', kind: 'lobby' })
  })

  it('hides the players in the other world, in both directions', () => {
    const view = reduceMatch(overFor('a'), lobbyReturn(['a', 'c']))
    // a has returned: sees c (returned), not b (still on the match-end view)
    expect(ids(hiddenRemoteIds(view))).toEqual(['b'])
    // b has not: sees nobody who went back (a and c play in lobby coordinates)
    const asB = reduceMatch(overFor('b'), lobbyReturn(['a', 'c']))
    expect(ids(hiddenRemoteIds(asB))).toEqual(['a', 'c'])
  })

  it('hides nobody outside the wait or once everyone is back in the lobby', () => {
    expect(hiddenRemoteIds(overFor('a')).size).toBe(0) // nobody returned yet: all on the match-end view
    let view = reduceMatch(overFor('a'), lobbyReturn(['a']))
    expect(ids(hiddenRemoteIds(view))).toEqual(['b', 'c'])
    view = reduceMatch(view, { event: 'roomState', data: roomState('lobby', ['a', 'b', 'c']) })
    expect(view.returned).toBeNull()
    expect(hiddenRemoteIds(view).size).toBe(0)
    expect(stageFor(view).key).toBe('lobby')
  })

  it('clears the list on a new roundStart and drops a player who left', () => {
    let view = reduceMatch(overFor('a'), lobbyReturn(['b', 'c']))
    view = reduceMatch(view, { event: 'playerLeft', data: { playerId: 'c' } })
    expect(view.returned).toEqual(['b'])
    view = reduceMatch(view, { event: 'roundStart', data: roundStart(4) })
    expect(view.returned).toBeNull()
    expect(hiddenRemoteIds(view).size).toBe(0)
  })

  it('ignores a late lobbyReturn once the room is back in the lobby', () => {
    let view = reduceMatch(overFor('a'), { event: 'roomState', data: roomState('lobby', ['a', 'b', 'c']) })
    view = reduceMatch(view, lobbyReturn(['a']))
    expect(view.returned).toBeNull()
  })

  it('is tracked by MatchTracker', () => {
    const conn = new FakeConnection()
    const tracker = new MatchTracker(conn)
    conn.emit('joined', { playerId: 'a', roomId: 'abcd', serverTime: 0, resumeToken: 't' })
    conn.emit('roomState', roomState('match', ['a', 'b']))
    conn.emit('roundStart', roundStart(1))
    conn.emit('lobbyReturn', { returned: ['a'], lobbyAt: 60000 })
    expect(iReturned(tracker.view)).toBe(true)
    expect(stageFor(tracker.view).kind).toBe('lobby')
  })
})
