import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { RoomConnection, type SocketLike } from '../game/net/RoomConnection'
import { createChatStore } from './chatStore'

describe('createChatStore', () => {
  const setup = () => {
    let sock!: SocketLike
    const conn = new RoomConnection({
      roomId: 'abc123', name: 'Ann', color: 'Red', url: 'ws://x',
      socketFactory: () => (sock = { readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} }),
    })
    const store = createChatStore(conn, () => 42)
    const push = (event: string, data: unknown) => sock.onmessage!({ data: JSON.stringify({ event, data }) })
    push('roomState', {
      roomId: 'abc123', hostId: 'a', phase: 'lobby', settings: { winsToMatch: 3, difficulty: 4 },
      players: [{ id: 'a', name: 'Ann', color: 'Red', wins: 0 }],
    })
    return { conn, store, push }
  }

  it('names lines from the roster and spells out quick chats', () => {
    const { conn, store, push } = setup()
    push('chatMessage', { playerId: 'a', text: 'hi', quick: false })
    push('chatMessage', { playerId: 'a', text: 'ez', quick: true })
    expect(get(store).map((e) => [e.name, e.color, e.text, e.quick, e.at])).toEqual([
      ['Ann', '#ff4d4d', 'hi', false, 42],
      ['Ann', '#ff4d4d', 'ez', true, 42],
    ])
    conn.close()
  })

  it('tells me I was muted, with no sender', () => {
    const { conn, store, push } = setup()
    push('chatMuted', { ms: 3000 })
    expect(get(store).map((e) => [e.name, e.text, e.system])).toEqual([['', 'Chat disabled for 3 seconds', true]])
    conn.close()
  })

  it('drops quick chats it has no line for', () => {
    const { conn, store, push } = setup()
    push('chatMessage', { playerId: 'a', text: 'newLine', quick: true })
    expect(get(store)).toEqual([])
    conn.close()
  })
})
