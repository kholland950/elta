export const TPS: number = 32

export interface PlayerDataMessage {
    id: string
    color: string
    name: string
}

export type NewPlayerMessage = PlayerDataMessage

export interface PlayerStateMessage {
    playerId: string,
    x: number,
    y: number,
    velocityX: number,
    velocityY: number
}

export interface GameStateMessage {
    players: Array<PlayerDataMessage>
}

export type ReceivableMessageData = GameStateMessage
export type SendableMessageData = NewPlayerMessage | PlayerStateMessage
export type MessageData = ReceivableMessageData | SendableMessageData

export enum MessageEventType {
    NEW_PLAYER = 'NEW_PLAYER',
    PLAYER_MOVE = 'PLAYER_STATE',
    GAME_STATE = 'GAME_STATE'
}

export interface WebSocketMessage {
    event: MessageEventType,
    data: MessageData
}
