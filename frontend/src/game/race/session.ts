import type {
  JoinRejectedReason,
  RoomPlayer,
  RoomSettings,
  RoundEndMessage,
  RoundStartMessage,
  ServerEvent,
  ServerMessages,
} from './protocol'

/** Room/match state as seen by the Svelte UI (pure; see app/roomStore.ts). */
export interface SessionState {
  me: string | null
  roomId: string
  hostId: string | null
  phase: 'lobby' | 'match'
  settings: RoomSettings
  players: RoomPlayer[]
  currentRound: RoundStartMessage | null
  lastRoundEnd: RoundEndMessage | null
  skipVotes: { round: number; votes: number; needed: number } | null
  /** Latest match-over return list; cleared on lobby and on roundStart. */
  lobbyReturn: { returned: string[]; lobbyAt: number } | null
  rejected: JoinRejectedReason | null
}

/** I count as returned when the server lists me, or the phase is already the lobby. */
export const meReturned = (s: SessionState): boolean =>
  s.phase === 'lobby' || (s.me !== null && (s.lobbyReturn?.returned.includes(s.me) ?? false))

export type ServerMessage = {
  [E in ServerEvent]: { event: E; data: ServerMessages[E] }
}[ServerEvent]

export const initialSession = (roomId: string): SessionState => ({
  me: null,
  roomId,
  hostId: null,
  phase: 'lobby',
  settings: { winsToMatch: 3, difficulty: 4 },
  players: [],
  currentRound: null,
  lastRoundEnd: null,
  skipVotes: null,
  lobbyReturn: null,
  rejected: null,
})

export const reduceSession = (state: SessionState, msg: ServerMessage): SessionState => {
  switch (msg.event) {
    case 'joined':
      return { ...state, me: msg.data.playerId, roomId: msg.data.roomId }
    case 'joinRejected':
      return { ...state, rejected: msg.data.reason }
    case 'roomState': {
      const d = msg.data
      const next: SessionState = {
        ...state,
        roomId: d.roomId,
        hostId: d.hostId,
        phase: d.phase,
        settings: d.settings,
        players: d.players,
      }
      if (d.phase === 'lobby') {
        next.currentRound = null
        next.lastRoundEnd = null
        next.skipVotes = null
        next.lobbyReturn = null
      }
      return next
    }
    case 'playerLeft':
      // A roomState follows; drop the player eagerly so the UI doesn't show a ghost meanwhile
      return { ...state, players: state.players.filter((p) => p.id !== msg.data.playerId) }
    case 'roundStart':
      return { ...state, currentRound: msg.data, lastRoundEnd: null, skipVotes: null, lobbyReturn: null }
    case 'lobbyReturn':
      return { ...state, lobbyReturn: msg.data }
    case 'skipVotes':
      return { ...state, skipVotes: msg.data }
    case 'roundEnd': {
      const wins = msg.data.wins
      return {
        ...state,
        lastRoundEnd: msg.data,
        players: state.players.map((p) => (p.id in wins ? { ...p, wins: wins[p.id]! } : p)),
      }
    }
    default:
      // clockPong, playerMove, playerAction don't affect session state
      return state
  }
}
