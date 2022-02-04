import type { MainScene } from 'game/MainScene'
import {
  GameStateMessage,
  MessageEventType,
  NewPlayerMessage,
  PlayerLeftMessage,
  PlayerMoveMessage,
  ReceivableMessageData,
  SendableMessageData,
  TPS,
  WebSocketMessage,
} from 'game/messages'

const messageHandlers: Record<string, Function> = {
  [MessageEventType.NEW_PLAYER]: (data: NewPlayerMessage, scene: MainScene) => {
    scene.playerManager.playerJoined(data.color, data.name, data.x, data.y, data.id)
  },
  // [MessageEventType.PLAYER_MOVE]: (data: PlayerMoveMessage, scene: MainScene) => {
  //   scene.playerManager.playerMoved(data.playerId, data.x, data.y, data.velocityX, data.velocityY)
  // },
  [MessageEventType.PLAYER_LEFT]: (data: PlayerLeftMessage, scene: MainScene) => {
    scene.playerManager.playerLeft(data.playerId)
  },
  [MessageEventType.GAME_STATE]: (data: GameStateMessage, scene: MainScene) => {
    scene.playerManager.updateGameState(data.players)
  },
}

export class MessageBroker {
  private scene: MainScene
  private socket: WebSocket
  private messageQueue: Array<WebSocketMessage> = []

  constructor(scene: MainScene) {
    let socketScheme: String = 'ws'
    if (window.location.origin.startsWith('https')) {
      socketScheme = 'wss'
    }
    this.socket = new WebSocket(`${socketScheme}://${location.host}/ws/game`)
    this.scene = scene
    this.scene.events.on('destroy', () => this.socket.close())

    if (this.socket) {
      this.socket.onopen = () => {
        this.messageQueue.forEach((message) =>
          this.send(message.event, message.data as SendableMessageData),
        )
        this.messageQueue = []
        this.socket.onmessage = (event: MessageEvent) => {
          this.receiveMessage(event)
        }
      }
    } else {
      console.error('Websocket connection failed')
    }
  }

  receiveMessage(event: MessageEvent) {
    this.route(JSON.parse(event.data) as WebSocketMessage)
  }

  private route(message: WebSocketMessage) {
    let data: ReceivableMessageData

    switch (message.event) {
      case MessageEventType.NEW_PLAYER:
        data = message.data as NewPlayerMessage
        break
      case MessageEventType.PLAYER_MOVE:
        data = message.data as PlayerMoveMessage
        break
      case MessageEventType.PLAYER_LEFT:
        data = message.data as PlayerLeftMessage
        break
      case MessageEventType.GAME_STATE:
        data = message.data as GameStateMessage
        break
      default:
        console.log(message.event, message.data)
        data = message.data
    }

    messageHandlers[message.event]?.(data, this.scene)
  }

  send(event: MessageEventType, data: SendableMessageData) {
    const message: WebSocketMessage = { event, data }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    } else {
      this.messageQueue.push(message)
    }
  }

  schedule(
    event: MessageEventType,
    callback: (...args: any[]) => SendableMessageData | undefined,
    ...callbackArgs: any[]
  ) {
    const wrapAndSend = (...callbackArgs: any[]) => {
      const data: SendableMessageData | undefined = callback(...callbackArgs)
      data && this.send(event, data)
    }

    this.scene.time.addEvent({
      delay: 1000 / TPS,
      callback: wrapAndSend,
      args: callbackArgs,
      callbackScope: this,
      loop: true,
    })
  }
}
