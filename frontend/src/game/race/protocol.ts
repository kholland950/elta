import type { PlayerActionMessage } from '../fx/actions'

/**
 * Wire types for the room websocket. Mirrors src/ws/Protocol.kt; see
 * docs/plans/orb-racer-slice2-contract.md §1. Times are server epoch ms.
 */

import type { Archetype } from './archetype'

export type { PlayerActionMessage }

export interface PlayerMoveMessage {
  playerId: string
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export interface RoomSettings {
  winsToMatch: 1 | 3 | 5 | 7
  difficulty: number
}

export interface RoomPlayer {
  id: string
  name: string
  color: string
  wins: number
}

/** `expired`: a resume whose seat the server no longer holds. */
export type JoinRejectedReason = 'inProgress' | 'full' | 'badName' | 'staleBuild' | 'expired'
export type RoundEndReason = 'finish' | 'timeout' | 'skipped'

export interface ClientMessages {
  /** `resumeToken` from an earlier `joined` reattaches to that seat. */
  joinRoom: { roomId: string; name: string; color: string; build: string; resumeToken?: string }
  clockPing: { t0: number }
  updateSettings: RoomSettings
  startMatch: Record<string, never>
  voteSkip: { round: number }
  returnToLobby: Record<string, never>
  finishReport: { round: number; raceTimeMs: number }
  playerMove: PlayerMoveMessage
  playerAction: PlayerActionMessage
  chat: { text: string }
  quickChat: { id: string }
}

export interface RoundStartMessage {
  round: number
  seed: number
  difficulty: number
  archetype: Archetype
  startOrder: string[]
  exploreAt: number
  snapAt: number
  goAt: number
}

export interface RoundEndMessage {
  round: number
  winnerId: string | null
  reason: RoundEndReason
  times: { playerId: string; raceTimeMs: number }[]
  wins: Record<string, number>
  /** Server time the round ended; the replay sequence runs from it. Absent from older servers. */
  endedAt?: number
  /**
   * Length of the trail-replay beat: the race (GO to `endedAt`) at 2×, 0 when skipped. Absent from
   * older servers.
   */
  replayMs?: number
  nextRoundAt: number | null
  matchWinnerId: string | null
}

export interface ServerMessages {
  joined: { playerId: string; roomId: string; serverTime: number; resumeToken: string }
  joinRejected: { reason: JoinRejectedReason }
  clockPong: { t0: number; serverTime: number }
  roomState: {
    roomId: string
    hostId: string
    phase: 'lobby' | 'match'
    settings: RoomSettings
    players: RoomPlayer[]
  }
  playerLeft: { playerId: string }
  roundStart: RoundStartMessage
  skipVotes: { round: number; votes: number; needed: number }
  lobbyReturn: { returned: string[]; lobbyAt: number }
  roundEnd: RoundEndMessage
  playerMove: PlayerMoveMessage
  playerAction: PlayerActionMessage
  /** Sent to everyone, the sender included. For a quick chat `text` is the line id. */
  chatMessage: { playerId: string; text: string; quick: boolean }
  /** To the sender only: over the chat limit, so muted for `ms`. */
  chatMuted: { ms: number }
}

export type ClientEvent = keyof ClientMessages
export type ServerEvent = keyof ServerMessages

export interface Envelope<E extends string = string, D = unknown> {
  event: E
  data: D
}
