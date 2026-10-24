import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomConnection, type SocketLike } from './RoomConnection'

class FakeSocket implements SocketLike {
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  sent: { event: string; data: any }[] = []
  closed = false
  closeCode: number | undefined
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close(code?: number) { this.closed = true; this.closeCode = code; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.() }
  push(event: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ event, data }) }) }
}

let sock: FakeSocket
let urlSeen = ''
/** The 5 clock pings `joined` starts. */
const PINGS_AFTER_JOIN = 5
const make = () =>
  new RoomConnection({
    roomId: 'abc123', name: 'Ann', color: 'Red', url: 'ws://h/ws/game',
    socketFactory: (u) => { urlSeen = u; return (sock = new FakeSocket()) },
  })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('RoomConnection', () => {
  it('sends joinRoom first with a build id once open', () => {
    make()
    expect(urlSeen).toBe('ws://h/ws/game')
    expect(sock.sent).toEqual([])
    sock.open()
    expect(sock.sent).toHaveLength(1)
    expect(sock.sent[0]).toEqual({
      event: 'joinRoom',
      data: { roomId: 'abc123', name: 'Ann', color: 'Red', build: 'dev' },
    })
  })

  it('records playerId from joined and runs 5 pings 100ms apart', () => {
    const c = make()
    sock.open()
    sock.push('joined', { playerId: 'p1', roomId: 'abc123', serverTime: 1_000_000 })
    expect(c.playerId).toBe('p1')
    const pings = () => sock.sent.filter((m) => m.event === 'clockPing').length
    vi.advanceTimersByTime(0)
    expect(pings()).toBe(1)
    vi.advanceTimersByTime(450)
    expect(pings()).toBe(5)
    vi.advanceTimersByTime(1000)
    expect(pings()).toBe(5)
  })

  it('derives serverNow from pongs', () => {
    const c = make()
    sock.open()
    sock.push('joined', { playerId: 'p1', roomId: 'abc123', serverTime: 5_000 })
    vi.advanceTimersByTime(0)
    const t0 = sock.sent.find((m) => m.event === 'clockPing')!.data.t0
    vi.advanceTimersByTime(20)
    // server clock is 10_000 ahead of local: at local (t0+10) server reads t0+10+10_000
    sock.push('clockPong', { t0, serverTime: t0 + 10 + 10_000 })
    expect(c.serverNow()).toBeCloseTo(performance.now() + 10_000, 5)
  })

  it('pings again on roundStart', () => {
    make()
    sock.open()
    sock.push('joined', { playerId: 'p1', roomId: 'abc123', serverTime: 1 })
    vi.advanceTimersByTime(1000)
    const before = sock.sent.length
    sock.push('roundStart', { round: 1, seed: 1, difficulty: 1, archetype: 'tower', startOrder: [], exploreAt: 1, snapAt: 2, goAt: 3 })
    expect(sock.sent.length - before).toBe(1)
    expect(sock.sent[sock.sent.length - 1]!.event).toBe('clockPing')
  })

  it('supports multiple listeners and unsubscribe', () => {
    const c = make()
    sock.open()
    const a = vi.fn(), b = vi.fn()
    const offA = c.on('playerLeft', a)
    c.on('playerLeft', b)
    sock.push('playerLeft', { playerId: 'x' })
    offA()
    sock.push('playerLeft', { playerId: 'y' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenLastCalledWith({ playerId: 'y' })
  })

  it('a throwing listener does not stop others', () => {
    const c = make()
    sock.open()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const b = vi.fn()
    c.on('playerLeft', () => { throw new Error('x') })
    c.on('playerLeft', b)
    sock.push('playerLeft', { playerId: 'x' })
    expect(b).toHaveBeenCalled()
    err.mockRestore()
  })

  it('wraps outgoing messages in the envelope', () => {
    const c = make()
    sock.open()
    sock.push('joined', { playerId: 'p1', roomId: 'abc123', serverTime: 1 })
    sock.sent.length = 0
    c.sendMove({ x: 1, y: 2, velocityX: 3, velocityY: 4 })
    c.sendAction({ kind: 'flap', x: 1, y: 2 } as any)
    c.reportFinish(2, 1234.5)
    c.voteSkip(2)
    c.updateSettings({ winsToMatch: 5, difficulty: 7 })
    c.startMatch()
    expect(sock.sent.map((m) => m.event)).toEqual([
      'playerMove', 'playerAction', 'finishReport', 'voteSkip', 'updateSettings', 'startMatch',
    ])
    expect(sock.sent[0]!.data).toEqual({ playerId: 'p1', x: 1, y: 2, velocityX: 3, velocityY: 4 })
    expect(sock.sent[2]!.data).toEqual({ round: 2, raceTimeMs: 1234.5 })
    expect(sock.sent[5]!.data).toEqual({})
  })

  it('drops sends while not open and ignores malformed frames', () => {
    const c = make()
    c.voteSkip(1)
    expect(sock.sent).toEqual([])
    sock.open()
    sock.onmessage?.({ data: 'not json' })
    sock.onmessage?.({ data: '{"event":5}' })
  })

  it('close closes the socket, stops pings and listeners', () => {
    const c = make()
    sock.open()
    const cb = vi.fn()
    c.on('playerLeft', cb)
    sock.push('joined', { playerId: 'p1', roomId: 'abc123', serverTime: 1 })
    c.close()
    expect(sock.closed).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(sock.sent.filter((m) => m.event === 'clockPing')).toHaveLength(0)
  })

  describe('reconnecting', () => {
    const joined = { playerId: 'p1', roomId: 'abc123', serverTime: 1, resumeToken: 'tok' }
    let made = 0
    const track = () =>
      new RoomConnection({
        roomId: 'abc123', name: 'Ann', color: 'Red', url: 'ws://h/ws/game',
        socketFactory: () => { made++; return (sock = new FakeSocket()) },
      })
    const joinedConn = () => {
      made = 0
      const c = track()
      sock.open()
      sock.push('joined', joined)
      return c
    }

    it('resumes the same seat with the token after a drop', () => {
      const c = joinedConn()
      const statuses: string[] = []
      c.onStatus((s) => statuses.push(s))
      const first = sock
      first.onclose?.()
      expect(c.status).toBe('reconnecting')
      expect(first.onmessage).toBeNull()

      vi.advanceTimersByTime(250)
      expect(made).toBe(2)
      sock.open()
      expect(sock.sent[0]).toEqual({
        event: 'joinRoom',
        data: { roomId: 'abc123', name: 'Ann', color: 'Red', build: 'dev', resumeToken: 'tok' },
      })
      sock.push('joined', joined)
      expect(c.playerId).toBe('p1')
      expect(statuses).toEqual(['connected', 'reconnecting', 'connected'])
    })

    it('keeps listeners across a reconnect', () => {
      const c = joinedConn()
      const cb = vi.fn()
      c.on('playerLeft', cb)
      sock.onclose?.()
      vi.advanceTimersByTime(250)
      sock.open()
      sock.push('joined', joined)
      sock.push('playerLeft', { playerId: 'x' })
      expect(cb).toHaveBeenCalledWith({ playerId: 'x' })
    })

    it('holds control messages until the seat is back and drops moves', () => {
      const c = joinedConn()
      sock.onclose?.()
      c.reportFinish(1, 100)
      c.sendMove({ x: 1, y: 2, velocityX: 0, velocityY: 0 })
      vi.advanceTimersByTime(250)
      sock.open()
      expect(sock.sent.map((m) => m.event)).toEqual(['joinRoom'])
      sock.push('joined', joined)
      expect(sock.sent.map((m) => m.event)).toEqual(['joinRoom', 'finishReport'])
    })

    it('backs off between attempts and gives up once the seat hold is over', () => {
      const c = joinedConn()
      sock.onclose?.()
      const gaps: number[] = []
      let elapsed = 0
      while (c.status === 'reconnecting') {
        const before = made
        let waited = 0
        while (made === before && waited < 10_000) {
          vi.advanceTimersByTime(50)
          waited += 50
        }
        if (made === before) break
        gaps.push(waited)
        elapsed += waited
        sock.onclose?.()
      }
      expect(gaps.slice(0, 5)).toEqual([250, 500, 1000, 2000, 4000])
      expect(c.status).toBe('lost')
      expect(elapsed).toBeGreaterThanOrEqual(25_000)
      expect(elapsed).toBeLessThanOrEqual(35_000)
      const count = made
      vi.advanceTimersByTime(60_000)
      expect(made).toBe(count)
    })

    it('treats an unanswered heartbeat as a dead link', () => {
      const c = joinedConn()
      const first = sock
      vi.advanceTimersByTime(4_000)
      expect(first.sent.filter((m) => m.event === 'clockPing').length).toBe(PINGS_AFTER_JOIN + 1)
      vi.advanceTimersByTime(8_000)
      expect(first.closed).toBe(true)
      // Not a normal close, so the server holds the seat
      expect(first.closeCode).toBe(4000)
      expect(c.status).toBe('reconnecting')
    })

    it('a heartbeat answered by any message keeps the link', () => {
      const c = joinedConn()
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(4_000)
        sock.push('playerMove', { playerId: 'q', x: 0, y: 0, velocityX: 0, velocityY: 0 })
      }
      expect(c.status).toBe('connected')
      expect(made).toBe(1)
    })

    it('stops for good when the resume is rejected', () => {
      const c = joinedConn()
      sock.onclose?.()
      vi.advanceTimersByTime(250)
      sock.open()
      sock.push('joinRejected', { reason: 'expired' })
      expect(c.status).toBe('lost')
      sock.onclose?.()
      vi.advanceTimersByTime(60_000)
      expect(made).toBe(2)
    })

    it('close() is a normal close and never reconnects', () => {
      const c = joinedConn()
      const first = sock
      c.close()
      expect(first.closeCode).toBe(1000)
      vi.advanceTimersByTime(60_000)
      expect(made).toBe(1)
    })
  })
})
