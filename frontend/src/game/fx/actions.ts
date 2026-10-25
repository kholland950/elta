import type { FeelEvent, FeelEventKind } from './feelEvents'

/** Wire form of a feel event, relayed as-is by the server to the other players. */
export interface PlayerActionMessage {
  playerId: string
  kind: FeelEventKind
  x: number
  y: number
  /** Dash direction; only on `dash`. */
  dir?: 1 | -1
  /** The other participant; only on `collision`. */
  otherId?: string
}

const KINDS: ReadonlyArray<FeelEventKind> = [
  'dash',
  'stall',
  'flap',
  'recharge',
  'bounce',
  'collision',
]

export const toActionMessage = (e: FeelEvent): PlayerActionMessage => {
  const { playerId, kind, x, y } = e
  switch (e.kind) {
    case 'dash':
      return { playerId, kind, x, y, dir: e.dir }
    case 'collision':
      return { playerId, kind, x, y, otherId: e.otherId }
    default:
      return { playerId, kind, x, y }
  }
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isKind = (value: unknown): value is FeelEventKind => KINDS.includes(value as FeelEventKind)

/**
 * Parses a relayed message back into a feel event. The server does not validate, so anything
 * malformed (unknown kind, bad dash direction, missing ids or coordinates) is dropped.
 */
export const fromActionMessage = (m: unknown): FeelEvent | undefined => {
  if (typeof m !== 'object' || m === null) return undefined
  const { playerId, kind, x, y, dir, otherId } = m as Record<string, unknown>
  if (!isId(playerId) || !isKind(kind) || !isCoordinate(x) || !isCoordinate(y)) return undefined
  switch (kind) {
    case 'dash':
      return dir === 1 || dir === -1 ? { kind, playerId, x, y, dir } : undefined
    case 'collision':
      return isId(otherId) && otherId !== playerId ? { kind, playerId, x, y, otherId } : undefined
    default:
      return { kind, playerId, x, y }
  }
}

/**
 * True when this client should tell the others about `e`: its own actions always, and a
 * collision only from the participant with the smaller id, so bystanders see it once.
 */
export const shouldBroadcast = (e: FeelEvent, localId: string): boolean => {
  if (e.playerId !== localId) return false
  return e.kind !== 'collision' || localId < e.otherId
}

/**
 * True when a relayed event should be shown here. Own echoes and collisions this player took
 * part in were already shown locally.
 */
export const shouldShowRemote = (e: FeelEvent, localId: string): boolean => {
  if (e.playerId === localId) return false
  return e.kind !== 'collision' || e.otherId !== localId
}
