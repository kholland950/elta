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
  close(code?: number, reason?: string): void
}

/**
 * - `connecting`: before the first `joined`
 * - `connected`: joined, and the socket is up
 * - `reconnecting`: the socket dropped; retrying with the resume token while the server holds the seat
 * - `lost`: gave up, or the server no longer has the seat
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'lost'

const OPEN = 1
const PING_COUNT = 5
const PING_SPACING_MS = 100
const MAX_SAMPLES = 32
/** Delay before each reconnect attempt; the last one repeats. */
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 5000]
/** Matches the server's seat hold: past this, a resume can only be rejected. */
const GIVE_UP_MS = 30_000
/** Pings this often while connected; a ping unanswered (by anything) for SILENCE_MS means a dead link. */
const HEARTBEAT_MS = 4_000
const SILENCE_MS = 8_000
/** Close code for a link we gave up on ourselves; anything but 1000/1001 lets the server hold the seat. */
const CLOSE_DEAD_LINK = 4000
/** Control messages kept while reconnecting, sent once the seat is back. */
const MAX_PENDING = 20
const QUEUED: ReadonlySet<ClientEvent> = new Set<ClientEvent>([
  'finishReport', 'voteSkip', 'updateSettings', 'startMatch', 'returnToLobby',
])

const buildId = (): string => (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev')

const defaultUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/game`
}

type Listener = (data: never) => void

/**
 * The room websocket. Signatures are the contract between the Svelte and Phaser sides
 * (docs/plans/orb-racer-slice2-contract.md §4).
 *
 * Survives dropped connections: on a close it reconnects with backoff and resumes the same seat
 * with the token from `joined`, and the server replays what was missed. Listeners stay attached
 * across reconnects. Moves sent while down are dropped; control messages wait for the resume.
 */
export class RoomConnection {
  readonly roomId: string
  private id: string | null = null
  private resumeToken: string | null = null
  private offset = 0
  private samples: ClockSample[] = []
  private listeners = new Map<string, Set<Listener>>()
  private statusListeners = new Set<(s: ConnectionStatus) => void>()
  private currentStatus: ConnectionStatus = 'connecting'
  private socket!: SocketLike
  private pingTimers: ReturnType<typeof setTimeout>[] = []
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** When the last unanswered heartbeat ping went out; any message answers it. */
  private awaitingSince: number | null = null
  private lostAt: number | null = null
  private attempt = 0
  private pending: string[] = []
  private rejected = false
  private closed = false

  constructor(private readonly opts: {
    roomId: string
    name: string
    color: string
    url?: string
    /** Test seam: replaces `new WebSocket(url)`. */
    socketFactory?: (url: string) => SocketLike
  }) {
    this.roomId = opts.roomId
    this.open()
  }

  get playerId(): string | null {
    return this.id
  }

  get status(): ConnectionStatus {
    return this.currentStatus
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

  /** Called with the current status at once, then on every change. */
  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb)
    cb(this.currentStatus)
    return () => {
      this.statusListeners.delete(cb)
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
    this.stopTimers()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.pending = []
    this.listeners.clear()
    this.statusListeners.clear()
    this.detach()
    // A normal close tells the server this player left, rather than dropped
    this.socket.close(1000, 'leave')
  }

  private open(): void {
    const url = this.opts.url ?? defaultUrl()
    const socket = this.opts.socketFactory
      ? this.opts.socketFactory(url)
      : (new WebSocket(url) as unknown as SocketLike)
    this.socket = socket
    socket.onopen = () => {
      const join: ClientMessages['joinRoom'] = {
        roomId: this.opts.roomId,
        name: this.opts.name,
        color: this.opts.color,
        build: buildId(),
      }
      if (this.resumeToken) join.resumeToken = this.resumeToken
      this.write('joinRoom', join)
    }
    socket.onmessage = (ev) => this.receive(ev.data)
    // An error is always followed by a close
    socket.onclose = () => this.dropped()
    if (socket.readyState === OPEN) socket.onopen()
  }

  /** The socket is gone: retry until the seat's hold runs out. */
  private dropped(): void {
    if (this.closed || this.rejected) return
    this.stopTimers()
    this.detach()
    const now = Date.now()
    this.lostAt ??= now
    if (now - this.lostAt >= GIVE_UP_MS) {
      this.setStatus('lost')
      return
    }
    if (this.id !== null) this.setStatus('reconnecting')
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)] ?? 5000
    this.attempt++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.closed) this.open()
    }, delay)
  }

  /** Stops the old socket from reporting anything, so a late close can't start a second retry. */
  private detach(): void {
    this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null
  }

  private stopTimers(): void {
    this.pingTimers.forEach(clearTimeout)
    this.pingTimers = []
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.awaitingSince = null
  }

  private beat(): void {
    const now = Date.now()
    if (this.awaitingSince === null) {
      this.awaitingSince = now
      this.ping()
    } else if (now - this.awaitingSince >= SILENCE_MS) {
      // Browsers can take minutes to notice a half-open socket
      const dead = this.socket
      this.dropped()
      dead.close(CLOSE_DEAD_LINK, 'no reply')
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.currentStatus) return
    this.currentStatus = s
    for (const cb of this.statusListeners) cb(s)
  }

  private send<E extends ClientEvent>(event: E, data: ClientMessages[E]): void {
    if (this.closed || this.rejected) return
    if (this.currentStatus === 'connected' && this.socket.readyState === OPEN) {
      this.write(event, data)
    } else if (QUEUED.has(event) && this.pending.length < MAX_PENDING) {
      this.pending.push(JSON.stringify({ event, data }))
    }
  }

  private write<E extends ClientEvent>(event: E, data: ClientMessages[E]): void {
    if (this.socket.readyState === OPEN) this.socket.send(JSON.stringify({ event, data }))
  }

  private receive(raw: unknown): void {
    if (this.closed || typeof raw !== 'string') return
    this.awaitingSince = null
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
      const resumed = this.id !== null
      this.id = d.playerId
      this.resumeToken = d.resumeToken
      // A resume keeps the samples and offset it had: a rough reset would jerk a running race
      if (!resumed) this.offset = d.serverTime - performance.now()
      this.lostAt = null
      this.attempt = 0
      for (let i = 0; i < PING_COUNT; i++) {
        this.pingTimers.push(setTimeout(() => this.ping(), i * PING_SPACING_MS))
      }
      this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
      this.setStatus('connected')
      const pending = this.pending
      this.pending = []
      for (const text of pending) this.socket.send(text)
    } else if (event === 'joinRejected') {
      this.rejected = true
      this.pending = []
      // Rejecting a resume means the seat is gone
      if (this.id !== null) this.setStatus('lost')
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
    this.write('clockPing', { t0: performance.now() })
  }
}
