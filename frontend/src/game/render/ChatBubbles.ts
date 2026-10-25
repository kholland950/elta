import Phaser from 'phaser'

/** Above the name label (32px up, 16px tall). */
const OFFSET_Y = 56
const SHOW_MS = 2500
const FADE_MS = 300

interface Bubble {
  text: Phaser.GameObjects.Text
  until: number
}

/**
 * Quick-chat speech bubbles over the orbs, one per player: a new line replaces the old one. They
 * follow the orb's drawn position, so call `update` after the visuals have moved.
 */
export class ChatBubbles {
  private bubbles = new Map<string, Bubble>()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly anchorOf: (playerId: string) => { x: number; y: number } | undefined,
  ) {}

  public show(playerId: string, line: string, now: number) {
    const anchor = this.anchorOf(playerId)
    if (!anchor) return
    this.bubbles.get(playerId)?.text.destroy()
    const text = this.scene.add
      .text(anchor.x, anchor.y - OFFSET_Y, line, {
        fontFamily: 'Comfortaa, sans-serif',
        fontSize: '18px',
        color: '#f4ff6b',
        backgroundColor: 'rgba(6, 10, 24, 0.75)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setDepth(20)
    this.bubbles.set(playerId, { text, until: now + SHOW_MS })
  }

  public update(now: number) {
    for (const [id, bubble] of this.bubbles) {
      const anchor = this.anchorOf(id)
      const left = bubble.until - now
      if (!anchor || left <= 0) {
        bubble.text.destroy()
        this.bubbles.delete(id)
        continue
      }
      bubble.text.setPosition(anchor.x, anchor.y - OFFSET_Y).setAlpha(Math.min(1, left / FADE_MS))
    }
  }

  public clear() {
    for (const bubble of this.bubbles.values()) bubble.text.destroy()
    this.bubbles.clear()
  }
}
