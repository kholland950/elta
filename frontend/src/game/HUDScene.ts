import global from 'app/global'

type MessageObject = {
  id: string
  message: string
}

export class HUDScene extends Phaser.Scene {
  private messages: Array<MessageObject> = []

  constructor() {
    super({
      key: 'HUD',
      active: true,
    })

    this.messages = []
  }

  public create() {
    const gameScene = this.scene.get('Game')
    gameScene.events.on('message', (message: string, timeout: number) =>
      this.addMessage(message, timeout),
    )
    gameScene.events.on('openScoreboard', () => {
      global.showScoreboard(true)
    })
    gameScene.events.on('closeScoreboard', () => {
      global.showScoreboard(false)
    })
  }

  private addMessage(message: string, timeout: number = 5000) {
    const newY = this.messages.length * 25 + 10

    const text = this.add.text(10, newY, message, { font: '20px Comfortaa' })

    const messageId: string = '_' + Math.random().toString(36).substr(2, 9)
    this.messages.push({ message, id: messageId })

    setTimeout(() => {
      text.destroy()
      this.messages = this.messages.filter((message) => messageId !== message.id)
    }, timeout)
  }
}
