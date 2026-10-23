import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { RoomConnection, type SocketLike } from '../game/net/RoomConnection'
import { createRoomStore } from './roomStore'

describe('createRoomStore', () => {
  it('reflects server messages from the connection', () => {
    let sock!: SocketLike
    const conn = new RoomConnection({
      roomId: 'abc123', name: 'Ann', color: 'Red', url: 'ws://x',
      socketFactory: () => (sock = { readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} }),
    })
    const store = createRoomStore(conn)
    const seen: string[] = []
    const off = store.subscribe((s) => seen.push(s.phase + ':' + (s.me ?? '-')))
    sock.onmessage!({ data: JSON.stringify({ event: 'joined', data: { playerId: 'p', roomId: 'abc123', serverTime: 1 } }) })
    expect(get(store).me).toBe('p')
    sock.onmessage!({ data: JSON.stringify({ event: 'joinRejected', data: { reason: 'full' } }) })
    expect(get(store).rejected).toBe('full')
    expect(seen[0]).toBe('lobby:-')
    off()
    conn.close()
  })
})
