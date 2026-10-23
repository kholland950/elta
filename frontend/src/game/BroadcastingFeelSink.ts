import { shouldBroadcast, toActionMessage } from 'game/fx/actions'
import type { FeelEvent, FeelSink } from 'game/fx/feelEvents'
import { MessageEventType } from 'game/messages'
import type { MessageBroker } from 'game/MessageBroker'

/**
 * Shows every feel event locally and tells the other players about the local player's actions.
 * Actions go out at once rather than on the position schedule so remote effects line up.
 */
export class BroadcastingFeelSink implements FeelSink {
  constructor(
    private readonly effects: FeelSink,
    private readonly broker: Pick<MessageBroker, 'send'>,
    private readonly localId: string,
  ) {}

  public emit(e: FeelEvent) {
    this.effects.emit(e)
    if (shouldBroadcast(e, this.localId)) {
      this.broker.send(MessageEventType.PLAYER_ACTION, toActionMessage(e))
    }
  }
}
