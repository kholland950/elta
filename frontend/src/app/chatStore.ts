import type { Readable } from 'svelte/store'
import { appendEntry, type ChatEntry } from '../game/chat/chatLog'
import { isQuickLineId, QUICK_TEXT } from '../game/chat/quickChat'
import type { RoomConnection } from '../game/net/RoomConnection'
import { colorCss } from '../game/profile/palette'

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
  const add = (entry: Omit<ChatEntry, 'key' | 'at'>) => {
    log = appendEntry(log, { ...entry, key: nextKey++, at: now() })
    subscribers.forEach((fn) => fn(log))
  }

  // conn.close() clears listeners, so no explicit unsubscribe is needed
  conn.on('roomState', (s) => {
    for (const p of s.players) roster.set(p.id, { name: p.name, color: colorCss(p.color) })
  })
  conn.on('chatMessage', (m) => {
    if (m.quick && !isQuickLineId(m.text)) return
    const who = roster.get(m.playerId) ?? { name: '?', color: '#ffffff' }
    const text = m.quick && isQuickLineId(m.text) ? QUICK_TEXT[m.text] : m.text
    add({ playerId: m.playerId, ...who, text, quick: m.quick, system: false })
  })
  conn.on('chatMuted', ({ ms }) => {
    const seconds = Math.ceil(ms / 1000)
    add({ playerId: '', name: '', color: '', text: `Chat disabled for ${seconds} second${seconds === 1 ? '' : 's'}`, quick: false, system: true })
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
