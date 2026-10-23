import { estimateOffset, type ClockSample } from '../race/clockSync'
import type {
  ClientEvent,
  ClientMessages,
  PlayerActionMessage,
  PlayerMoveMessage,
  RoomSettings,
  ServerEvent,
  ServerMessages,
} from '../race/protocol'

/** Minimal slice of WebSocket used here, so tests can inject a fake. */
export interface SocketLike {
  readyState: number
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
  send(data: string): void
  close(): void
}

const OPEN = 1
const PING_COUNT = 5
const PING_SPACING_MS = 100
const MAX_SAMPLES = 32

const buildId = (): string => (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev')

const defaultUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/game`
}

type Listener = (data: never) => void

/**
 * The room websocket. Signatures are the contract between the Svelte and Phaser sides
 * (docs/plans/orb-racer-slice2-contract.md §4).
 */
export class RoomConnection {
  readonly roomId: string
  private id: string | null = null
  private offset = 0
  private samples: ClockSample[] = []
  private listeners = new Map<string, Set<Listener>>()
  private socket: SocketLike
  private pingTimers: ReturnType<typeof setTimeout>[] = []
  private closed = false

  constructor(opts: {
    roomId: string
    name: string
    color: string
    url?: string
    /** Test seam: replaces `new WebSocket(url)`. */
    socketFactory?: (url: string) => SocketLike
  }) {
    this.roomId = opts.roomId
    const url = opts.url ?? defaultUrl()
    this.socket = opts.socketFactory
      ? opts.socketFactory(url)
      : (new WebSocket(url) as unknown as SocketLike)
    this.socket.onopen = () => {
      this.send('joinRoom', {
        roomId: opts.roomId,
        name: opts.name,
        color: opts.color,
        build: buildId(),
      })
    }
    this.socket.onmessage = (ev) => this.receive(ev.data)
    if (this.socket.readyState === OPEN) this.socket.onopen()
  }

  get playerId(): string | null {
    return this.id
  }

  serverNow(): number {
    return performance.now() + this.offset
  }

  on<E extends ServerEvent>(event: E, cb: (data: ServerMessages[E]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    const listener = cb as Listener
    set.add(listener)
    return () => {
      this.listeners.get(event)?.delete(listener)
    }
  }

  sendMove(m: Omit<PlayerMoveMessage, 'playerId'>): void {
    // The server overwrites playerId with the sender's id
    this.send('playerMove', { ...m, playerId: this.id ?? '' })
  }

  sendAction(m: Omit<PlayerActionMessage, 'playerId'>): void {
    this.send('playerAction', { ...m, playerId: this.id ?? '' } as PlayerActionMessage)
  }

  reportFinish(round: number, raceTimeMs: number): void {
    this.send('finishReport', { round, raceTimeMs })
  }

  voteSkip(round: number): void {
    this.send('voteSkip', { round })
  }

  updateSettings(s: RoomSettings): void {
    this.send('updateSettings', s)
  }

  startMatch(): void {
    this.send('startMatch', {})
  }

  returnToLobby(): void {
    this.send('returnToLobby', {})
  }

  close(): void {
    this.closed = true
    this.pingTimers.forEach(clearTimeout)
    this.pingTimers = []
    this.listeners.clear()
    this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null
    this.socket.close()
  }

  private send<E extends ClientEvent>(event: E, data: ClientMessages[E]): void {
    if (this.closed || this.socket.readyState !== OPEN) return
    this.socket.send(JSON.stringify({ event, data }))
  }

  private receive(raw: unknown): void {
    if (this.closed || typeof raw !== 'string') return
    let msg: { event?: unknown; data?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof msg.event !== 'string' || msg.data == null) return
    const event = msg.event as ServerEvent

    // Internal bookkeeping first so listeners see an up-to-date clock/playerId
    if (event === 'joined') {
      const d = msg.data as ServerMessages['joined']
      this.id = d.playerId
      this.offset = d.serverTime - performance.now()
      for (let i = 0; i < PING_COUNT; i++) {
        this.pingTimers.push(setTimeout(() => this.ping(), i * PING_SPACING_MS))
      }
    } else if (event === 'clockPong') {
      const d = msg.data as ServerMessages['clockPong']
      this.samples.push({ t0: d.t0, t1: performance.now(), serverTime: d.serverTime })
      if (this.samples.length > MAX_SAMPLES) this.samples.shift()
      const est = estimateOffset(this.samples)
      if (est !== null) this.offset = est
    }

    this.listeners.get(event)?.forEach((cb) => {
      try {
        ;(cb as (d: unknown) => void)(msg.data)
      } catch (e) {
        console.error(`RoomConnection listener for ${event} threw`, e)
      }
    })

    if (event === 'roundStart') this.ping()
  }

  private ping(): void {
    this.send('clockPing', { t0: performance.now() })
  }
}
