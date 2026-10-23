import type { RoomPlayer, RoundEndMessage, RoundStartMessage, ServerMessages } from './protocol'
import type { RoundPlan } from './round'
import { clampBays } from './segments'

/**
 * What the game scene needs to know about the room: who is in it, the current round and how it
 * ended, and the skip vote. Built from server messages by `reduceMatch`. Svelte keeps its own,
 * richer view (app/roomStore); this one only drives the world and the in-game HUD.
 */
export interface MatchView {
  me: string | null
  phase: 'lobby' | 'match'
  players: ReadonlyArray<RoomPlayer>
  /** The round being played or just finished; null in the lobby and before the first round. */
  round: RoundStartMessage | null
  /** How `round` ended, once it has. */
  ended: RoundEndMessage | null
  /** Skip votes for `round`. */
  votes: { votes: number; needed: number } | null
  /**
   * Players who have gone back to the lobby room while the match-over wait runs (the latest
   * `lobbyReturn`); null outside that wait.
   */
  returned: ReadonlyArray<string> | null
}

export const emptyMatch = (me: string | null = null): MatchView => ({
  me,
  phase: 'lobby',
  players: [],
  round: null,
  ended: null,
  votes: null,
  returned: null,
})

/** The server messages the scene tracks. */
export const MATCH_EVENTS = [
  'joined',
  'roomState',
  'playerLeft',
  'roundStart',
  'skipVotes',
  'roundEnd',
  'lobbyReturn',
] as const
export type MatchEvent = (typeof MATCH_EVENTS)[number]
export type MatchMessage = { [E in MatchEvent]: { event: E; data: ServerMessages[E] } }[MatchEvent]

export const reduceMatch = (view: MatchView, msg: MatchMessage): MatchView => {
  switch (msg.event) {
    case 'joined':
      return { ...view, me: msg.data.playerId }
    case 'roomState': {
      const { phase, players } = msg.data
      // Back in the lobby the match is over: forget its last round
      if (phase === 'lobby') {
        return { ...view, phase, players, round: null, ended: null, votes: null, returned: null }
      }
      return { ...view, phase, players }
    }
    case 'playerLeft': {
      const gone = msg.data.playerId
      return {
        ...view,
        players: view.players.filter((p) => p.id !== gone),
        returned: view.returned && view.returned.filter((id) => id !== gone),
      }
    }
    case 'roundStart':
      return { ...view, round: msg.data, ended: null, votes: null, returned: null }
    case 'lobbyReturn':
      // Only meaningful during the match-over wait; a late one after the lobby is ignored
      if (view.phase === 'lobby') return view
      return { ...view, returned: [...msg.data.returned] }
    case 'skipVotes': {
      if (msg.data.round !== view.round?.round || view.ended) return view
      return { ...view, votes: { votes: msg.data.votes, needed: msg.data.needed } }
    }
    case 'roundEnd':
      if (msg.data.round !== view.round?.round) return view
      return { ...view, ended: msg.data }
  }
}

/**
 * The stage to build. `key` changes whenever a different stage must be built. A round's stage has
 * one start bay per player in its `startOrder` (clamped to 1–8), so every client builds the same.
 */
export type StageChoice =
  | { key: 'lobby'; kind: 'lobby' }
  | { key: string; kind: 'race'; seed: number; difficulty: number; bays: number }

/**
 * Whether I am back in the lobby: the room's phase is lobby, or I am in the latest
 * `lobbyReturn.returned` during the match-over wait. Comes from the server, never a local flag.
 */
export const iReturned = (view: MatchView): boolean =>
  view.phase === 'lobby' || (view.me !== null && (view.returned?.includes(view.me) ?? false))

/** The other players who have returned to the lobby room during the match-over wait. */
export const returnedRemoteIds = (view: MatchView): ReadonlySet<string> =>
  new Set(view.phase === 'lobby' ? [] : (view.returned ?? []).filter((id) => id !== view.me))

/**
 * Remote players in the other world than mine during the match-over wait, whose orbs must be
 * hidden and whose moves and actions ignored: once I have returned, everyone who has not; while
 * I am still on the match-end view, everyone who has (their moves are in lobby coordinates).
 * Empty outside the wait.
 */
export const hiddenRemoteIds = (view: MatchView): ReadonlySet<string> => {
  if (view.phase === 'lobby' || view.returned === null) return new Set()
  const returned = returnedRemoteIds(view)
  const mine = iReturned(view)
  return new Set(remotePlayers(view).map((p) => p.id).filter((id) => returned.has(id) !== mine))
}

/**
 * The stage to show: the current round's; or the lobby room in the lobby, before round 1, and
 * as soon as I have returned while the others finish the match-over wait.
 */
export const stageFor = (view: MatchView): StageChoice =>
  view.round && !iReturned(view)
    ? {
        key: `round ${view.round.round}`,
        kind: 'race',
        seed: view.round.seed,
        difficulty: view.round.difficulty,
        bays: clampBays(view.round.startOrder.length),
      }
    : { key: 'lobby', kind: 'lobby' }

export const planOf = (round: RoundStartMessage): RoundPlan => ({
  exploreAt: round.exploreAt,
  snapAt: round.snapAt,
  goAt: round.goAt,
})

/** The other players, in join order. */
export const remotePlayers = (view: MatchView): ReadonlyArray<RoomPlayer> =>
  view.players.filter((p) => p.id !== view.me)

/**
 * Start bay for a player: their index in `startOrder`. A player missing from it (never expected)
 * goes after everyone listed; anything past the last bay shares the top one.
 */
export const startSlotIndex = (
  startOrder: ReadonlyArray<string>,
  playerId: string | null,
  slotCount: number,
): number => {
  const i = playerId === null ? -1 : startOrder.indexOf(playerId)
  const index = i >= 0 ? i : startOrder.length
  return Math.max(0, Math.min(index, slotCount - 1))
}

/** Lobby spawn: by join order, so players are spread around the room. */
export const lobbySlotIndex = (view: MatchView, slotCount: number): number => {
  const i = view.players.findIndex((p) => p.id === view.me)
  return Math.max(0, Math.min(i, slotCount - 1))
}

/** Ms of explore left at `now` (0 outside explore). */
export const exploreLeftMs = (plan: RoundPlan, now: number): number =>
  now < plan.exploreAt ? plan.snapAt - plan.exploreAt : Math.max(0, plan.snapAt - now)

/** A skip vote counts while the current round runs: from its roundStart until its roundEnd. */
export const canVoteSkip = (view: MatchView): boolean =>
  view.phase === 'match' && view.round !== null && view.ended === null

/** Votes to show: the server's count, or none of everyone before the first skipVotes. */
export const shownVotes = (view: MatchView): { votes: number; needed: number } | null => {
  if (!canVoteSkip(view)) return null
  return view.votes ?? { votes: 0, needed: Math.max(1, view.players.length) }
}

/** Minimal slice of RoomConnection the tracker needs; a fake implements it in tests. */
export interface MatchSource {
  readonly playerId: string | null
  on<E extends MatchEvent>(event: E, cb: (data: ServerMessages[E]) => void): () => void
}

/**
 * Subscribes to the match messages at once and keeps the latest view, so nothing is missed
 * between creating the game and its scene finishing `create` (the connection does not replay).
 * `onChange` is called after every message with the new view and the message.
 */
export class MatchTracker {
  private current: MatchView
  private offs: Array<() => void>
  private listener?: (view: MatchView, msg: MatchMessage) => void

  constructor(source: MatchSource) {
    this.current = emptyMatch(source.playerId)
    this.offs = MATCH_EVENTS.map((event) =>
      source.on(event, (data: ServerMessages[typeof event]) =>
        this.apply({ event, data } as MatchMessage),
      ),
    )
  }

  public get view(): MatchView {
    return this.current
  }

  public onChange(listener: (view: MatchView, msg: MatchMessage) => void) {
    this.listener = listener
  }

  private apply(msg: MatchMessage) {
    this.current = reduceMatch(this.current, msg)
    this.listener?.(this.current, msg)
  }

  public dispose() {
    this.offs.forEach((off) => off())
    this.offs = []
    this.listener = undefined
  }
}
