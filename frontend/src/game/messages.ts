export const TPS: number = 32

export interface PlayerDataMessage {
  id: string
  color: string
  name: string
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export type NewPlayerMessage = PlayerDataMessage

export interface PlayerMoveMessage {
  playerId: string
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export interface GameStateMessage {
  players: Array<PlayerDataMessage>
}

export interface PlayerLeftMessage {
  playerId: string
}

export type ReceivableMessageData =
  | NewPlayerMessage
  | PlayerMoveMessage
  | GameStateMessage
  | PlayerLeftMessage
export type SendableMessageData = NewPlayerMessage | PlayerMoveMessage
export type MessageData = ReceivableMessageData | SendableMessageData

export enum MessageEventType {
  NEW_PLAYER = 'newPlayer',
  PLAYER_MOVE = 'playerMove',
  PLAYER_LEFT = 'playerLeft',
  GAME_STATE = 'gameState',
}

export interface WebSocketMessage {
  event: MessageEventType
  data: MessageData
}
