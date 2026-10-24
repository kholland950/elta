import { describe, expect, it } from 'vitest'
import type { RoundEndMessage, RoundStartMessage } from './protocol'
import { initialSession, meReturned, reduceSession, type ServerMessage, type SessionState } from './session'

const players = [
  { id: 'a', name: 'Ann', color: 'Red', wins: 0 },
  { id: 'b', name: 'Bob', color: 'Blue', wins: 0 },
]
const settings = { winsToMatch: 5 as const, difficulty: 6 }
const roomState = (over: Partial<Extract<ServerMessage, { event: 'roomState' }>['data']> = {}): ServerMessage => ({
  event: 'roomState',
  data: { roomId: 'abc123', hostId: 'a', phase: 'lobby', settings, players, ...over },
})
const round: RoundStartMessage = {
  round: 1, seed: 7, difficulty: 4, archetype: 'tower', startOrder: ['a', 'b'], exploreAt: 1, snapAt: 2, goAt: 3,
}
const end: RoundEndMessage = {
  round: 1, winnerId: 'b', reason: 'finish', times: [{ playerId: 'b', raceTimeMs: 1234 }],
  wins: { a: 0, b: 1 }, nextRoundAt: 99, matchWinnerId: null,
}
const run = (msgs: ServerMessage[], from: SessionState = initialSession('abc123')) =>
  msgs.reduce(reduceSession, from)

describe('reduceSession', () => {
  it('starts in the lobby with defaults', () => {
    const s = initialSession('x')
    expect(s).toMatchObject({ roomId: 'x', me: null, phase: 'lobby', rejected: null, players: [] })
    expect(s.settings).toEqual({ winsToMatch: 3, difficulty: 4 })
  })

  it('joined sets me', () => {
    const s = run([{ event: 'joined', data: { playerId: 'a', roomId: 'abc123', serverTime: 1, resumeToken: 't' } }])
    expect(s.me).toBe('a')
  })

  it('joinRejected sets the reason', () => {
    const s = run([{ event: 'joinRejected', data: { reason: 'full' } }])
    expect(s.rejected).toBe('full')
  })

  it('roomState replaces host, settings, players, phase', () => {
    const s = run([roomState({ phase: 'match' })])
    expect(s).toMatchObject({ hostId: 'a', phase: 'match', settings, players })
  })

  it('host change comes through roomState', () => {
    const s = run([roomState(), roomState({ hostId: 'b', players: [players[1]!] })])
    expect(s.hostId).toBe('b')
    expect(s.players.map((p) => p.id)).toEqual(['b'])
  })

  it('playerLeft removes the player', () => {
    const s = run([roomState(), { event: 'playerLeft', data: { playerId: 'a' } }])
    expect(s.players.map((p) => p.id)).toEqual(['b'])
  })

  it('roundStart sets currentRound and clears prior results and votes', () => {
    const s = run([
      roomState({ phase: 'match' }),
      { event: 'roundStart', data: round },
      { event: 'skipVotes', data: { round: 1, votes: 1, needed: 2 } },
      { event: 'roundEnd', data: end },
      { event: 'roundStart', data: { ...round, round: 2 } },
    ])
    expect(s.currentRound?.round).toBe(2)
    expect(s.lastRoundEnd).toBeNull()
    expect(s.skipVotes).toBeNull()
  })

  it('skipVotes records votes', () => {
    const s = run([{ event: 'roundStart', data: round }, { event: 'skipVotes', data: { round: 1, votes: 1, needed: 2 } }])
    expect(s.skipVotes).toEqual({ round: 1, votes: 1, needed: 2 })
    const s2 = reduceSession(s, { event: 'skipVotes', data: { round: 1, votes: 2, needed: 3 } })
    expect(s2.skipVotes).toEqual({ round: 1, votes: 2, needed: 3 })
  })

  it('roundEnd stores the result and updates win tallies, keeping currentRound', () => {
    const s = run([roomState({ phase: 'match' }), { event: 'roundStart', data: round }, { event: 'roundEnd', data: end }])
    expect(s.lastRoundEnd).toEqual(end)
    expect(s.currentRound).toEqual(round)
    expect(s.players.find((p) => p.id === 'b')?.wins).toBe(1)
  })

  it('returning to the lobby clears currentRound, lastRoundEnd and votes', () => {
    const s = run([
      roomState({ phase: 'match' }),
      { event: 'roundStart', data: round },
      { event: 'skipVotes', data: { round: 1, votes: 1, needed: 2 } },
      { event: 'roundEnd', data: { ...end, nextRoundAt: null, matchWinnerId: 'b' } },
      roomState({ phase: 'lobby' }),
    ])
    expect(s.phase).toBe('lobby')
    expect(s.currentRound).toBeNull()
    expect(s.lastRoundEnd).toBeNull()
    expect(s.skipVotes).toBeNull()
  })

  it('ignores clockPong and relayed gameplay messages', () => {
    const before = run([roomState()])
    expect(reduceSession(before, { event: 'clockPong', data: { t0: 1, serverTime: 2 } })).toBe(before)
  })

  it('does not mutate the previous state', () => {
    const before = run([roomState()])
    const snapshot = JSON.stringify(before)
    run([{ event: 'roundEnd', data: end }], before)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  describe('lobbyReturn', () => {
    const joined: ServerMessage = { event: 'joined', data: { playerId: 'a', roomId: 'abc123', serverTime: 1, resumeToken: 't' } }
    const lr = (returned: string[]): ServerMessage => ({ event: 'lobbyReturn', data: { returned, lobbyAt: 500 } })

    it('stores the latest list and derives meReturned', () => {
      let s = run([joined, roomState({ phase: 'match' }), { event: 'roundEnd', data: { ...end, nextRoundAt: null, matchWinnerId: 'b' } }, lr([])])
      expect(s.lobbyReturn).toEqual({ returned: [], lobbyAt: 500 })
      expect(meReturned(s)).toBe(false)
      s = reduceSession(s, lr(['b']))
      expect(meReturned(s)).toBe(false)
      s = reduceSession(s, lr(['a', 'b']))
      expect(meReturned(s)).toBe(true)
    })

    it('counts as returned in the lobby phase and clears the list', () => {
      const s = run([joined, roomState({ phase: 'match' }), lr(['b']), roomState({ phase: 'lobby' })])
      expect(s.lobbyReturn).toBeNull()
      expect(meReturned(s)).toBe(true)
    })

    it('clears on roundStart', () => {
      const s = run([joined, roomState({ phase: 'match' }), lr(['a']), { event: 'roundStart', data: round }])
      expect(s.lobbyReturn).toBeNull()
      expect(meReturned(s)).toBe(false)
    })
  })
})
