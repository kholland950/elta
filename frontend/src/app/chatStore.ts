import type { Readable } from 'svelte/store'
import { appendEntry, type ChatEntry } from '../game/chat/chatLog'
import { isQuickLineId, QUICK_TEXT } from '../game/chat/quickChat'
import type { RoomConnection } from '../game/net/RoomConnection'
import { cssColor } from './playerColors'

/**
 * The room's chat lines. Like the room store, it subscribes at once (the connection doesn't
 * replay), so create it in the same tick as the connection.
 */
export const createChatStore = (conn: RoomConnection, now: () => number = () => performance.now()): Readable<ChatEntry[]> => {
  let log: ChatEntry[] = []
  let nextKey = 0
  // Kept after a player leaves, so their last lines keep their name
  const roster = new Map<string, { name: string; color: string }>()
  const subscribers = new Set<(log: ChatEntry[]) => void>()

  // conn.close() clears listeners, so no explicit unsubscribe is needed
  conn.on('roomState', (s) => {
    for (const p of s.players) roster.set(p.id, { name: p.name, color: cssColor(p.color) })
  })
  conn.on('chatMessage', (m) => {
    if (m.quick && !isQuickLineId(m.text)) return
    const who = roster.get(m.playerId) ?? { name: '?', color: '#ffffff' }
    const text = m.quick && isQuickLineId(m.text) ? QUICK_TEXT[m.text] : m.text
    log = appendEntry(log, { key: nextKey++, playerId: m.playerId, ...who, text, quick: m.quick, at: now() })
    subscribers.forEach((fn) => fn(log))
  })

  return {
    subscribe(fn) {
      subscribers.add(fn)
      fn(log)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}
