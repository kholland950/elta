import type { Readable } from 'svelte/store'
import type { RoomConnection } from '../game/net/RoomConnection'
import type { ServerEvent, ServerMessages } from '../game/race/protocol'
import { initialSession, reduceSession, type ServerMessage, type SessionState } from '../game/race/session'

const EVENTS: ServerEvent[] = [
  'joined', 'joinRejected', 'roomState', 'playerLeft', 'roundStart', 'skipVotes', 'roundEnd', 'lobbyReturn',
]

/**
 * Session state for the Svelte overlays. Subscribes to the connection immediately (the
 * connection doesn't replay), so create it in the same tick as the connection.
 */
export const createRoomStore = (conn: RoomConnection): Readable<SessionState> => {
  let state = initialSession(conn.roomId)
  const subscribers = new Set<(s: SessionState) => void>()
  const apply = (msg: ServerMessage) => {
    state = reduceSession(state, msg)
    subscribers.forEach((fn) => fn(state))
  }
  // conn.close() clears listeners, so no explicit unsubscribe is needed
  EVENTS.forEach((event) =>
    conn.on(event, (data: ServerMessages[typeof event]) => apply({ event, data } as ServerMessage)),
  )
  return {
    subscribe(fn) {
      subscribers.add(fn)
      fn(state)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}
