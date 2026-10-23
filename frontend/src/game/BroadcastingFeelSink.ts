import { shouldBroadcast, toActionMessage } from 'game/fx/actions'
import type { FeelEvent, FeelSink } from 'game/fx/feelEvents'
import type { PlayerActionMessage } from 'game/race/protocol'

/** Where the local player's actions go (the room connection). */
export interface ActionSink {
  sendAction(m: Omit<PlayerActionMessage, 'playerId'>): void
}

/**
 * Shows every feel event locally and tells the other players about the local player's actions.
 * Actions go out at once rather than on the position schedule so remote effects line up. Nothing
 * is sent until the server has given this player an id.
 */
export class BroadcastingFeelSink implements FeelSink {
  constructor(
    private readonly effects: FeelSink,
    private readonly actions: ActionSink,
    private readonly localId: () => string | null,
  ) {}

  public emit(e: FeelEvent) {
    this.effects.emit(e)
    const localId = this.localId()
    if (localId !== null && shouldBroadcast(e, localId)) {
      // The server stamps the sender's id on relay
      const { playerId: _sender, ...message } = toActionMessage(e)
      this.actions.sendAction(message)
    }
  }
}
