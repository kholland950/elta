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
  send(d: string) { this.sent.push(JSON.parse(d)) }
  close() { this.closed = true; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.() }
  push(event: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ event, data }) }) }
}

let sock: FakeSocket
let urlSeen = ''
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
    sock.push('roundStart', { round: 1, seed: 1, difficulty: 1, startOrder: [], exploreAt: 1, snapAt: 2, goAt: 3 })
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
})
