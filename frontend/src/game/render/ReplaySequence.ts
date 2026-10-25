// Relative imports: vitest has no path aliases, and this file is unit tested (it has no Phaser)
import { clampCenter, dampPose, easeInOutCubic, fitBox, keepInView, Pose, posePlan } from '../fx/replayCamera'
import { headAt, PathHead, replaySpanMs } from '../fx/replayPath'
import type { PathSample } from '../race/pathRecorder'
import type { RoundEndMessage } from '../race/protocol'
import { BeatKind, REPLAY_SPEED, ReplayCursor, replayTimeline } from '../race/replayTimeline'
import type { Rect } from '../race/stage'

/** The camera, as ReplayCamera. */
export interface ReplayCameraPort {
  readonly width: number
  readonly height: number
  current(out: Pose): Pose
  begin(): void
  apply(pose: Pose): void
  follow(target: { x: number; y: number }): void
  reset(): void
}

/** The route lines, as PathRenderer. */
export interface ReplayPathsPort {
  setPaths(
    paths: ReadonlyMap<string, ReadonlyArray<PathSample>>,
    winnerId: string | null,
    tintOf: (id: string) => number | undefined,
  ): void
  update(raceMs: number, zoom: number): void
  setAlpha(alpha: number): void
  clear(): void
}

export interface ReplayPlayersPort {
  /** The camera target of a player in the game, if they still are. */
  spriteFor(id: string): { x: number; y: number } | undefined
  tintOf(id: string): number | undefined
  freezeRemote(id: string, frozen: boolean): void
}

export interface ReplayDirectorPort {
  startVictoryLap(): void
  endVictoryLap(): void
}

export interface ReplayPorts {
  camera: ReplayCameraPort
  paths: ReplayPathsPort
  players: ReplayPlayersPort
  director: ReplayDirectorPort
}

/** The lines' strength under the victory lap, so they don't compete with the winner's orb. */
const LAP_LINE_ALPHA = 0.4
/**
 * The group follow cam's halflives (starting values, tune in the feel pass). Heads move at twice
 * race speed, so the centre is kept tight; the zoom is slower, as zoom changes disorient most.
 */
const GROUP_POS_HALFLIFE_MS = 150
const GROUP_ZOOM_HALFLIFE_MS = 400
/** Longest frame step fed to the damping, so a tab coming back doesn't fling the camera. */
const MAX_DT_MS = 100

interface Run {
  reason: RoundEndMessage['reason']
  cursor: ReplayCursor
  bounds: Rect
  paths: ReadonlyMap<string, ReadonlyArray<PathSample>>
  /** The same paths, for a per-frame loop that allocates nothing. */
  pathList: ReadonlyArray<ReadonlyArray<PathSample>>
  spanMs: number
  /** Index in `pathList` of the route the follow cam never loses: the winner's, else the one ending nearest the finish. */
  leader: number
  /** The trail-replay beat from the server; undefined from an older one. */
  replayBeatMs?: number
  winnerId: string | null
  winnerIsLocal: boolean
  /** Whether the zoom-in and lap run (a finish, with the winner still here). */
  lap: boolean
  lapStarted: boolean
  cameraTaken: boolean
  lastNow: number
}

/**
 * Plays the round-end sequence from the replay timeline: zoom out to frame every player, replay
 * every route at twice race speed under a follow cam that keeps the whole field in view, zoom in
 * on the winner and hand them a victory lap. Beats and replay progress read only the server
 * clock, so every client is on the same beat, and a tab that slept through beats still runs their
 * enter hooks in order (ReplayCursor). Only the follow cam's smoothing depends on frame timing.
 */
export class ReplaySequence {
  private run?: Run
  // Reused every frame
  private readonly from: Pose = { cx: 0, cy: 0, zoom: 1 }
  /** The follow cam: eased toward `goal`, the pose that frames every trail head. */
  private readonly group: Pose = { cx: 0, cy: 0, zoom: 1 }
  private readonly goal: Pose = { cx: 0, cy: 0, zoom: 1 }
  /** Where the follow cam was when the zoom-in began. */
  private readonly zoomInFrom: Pose = { cx: 0, cy: 0, zoom: 1 }
  private readonly target: Pose = { cx: 0, cy: 0, zoom: 1 }
  private readonly pose: Pose = { cx: 0, cy: 0, zoom: 1 }
  private readonly head: PathHead = { x: 0, y: 0, index: -1 }

  constructor(private readonly ports: ReplayPorts) {}

  public get active(): boolean {
    return this.run !== undefined
  }

  /**
   * Starts the sequence for a round that ended at `startAt` (its `endedAt`, or the arrival time
   * from an older server). A skipped round has none. Paths of players no longer here are dropped.
   */
  public start(
    end: Pick<RoundEndMessage, 'reason' | 'winnerId' | 'replayMs'>,
    startAt: number,
    bounds: Rect,
    paths: ReadonlyMap<string, ReadonlyArray<PathSample>>,
    localId: string,
    finish?: { x: number; y: number },
  ) {
    this.cancel()
    if (end.reason === 'skipped') return
    const shown = new Map<string, ReadonlyArray<PathSample>>()
    paths.forEach((path, id) => {
      if (path.length > 0 && this.ports.players.tintOf(id) !== undefined) shown.set(id, path)
    })
    const winnerId = end.winnerId
    const ids = [...shown.keys()]
    const pathList = [...shown.values()]
    let leader = winnerId === null ? -1 : ids.indexOf(winnerId)
    if (leader < 0 && finish) {
      let best = Infinity
      pathList.forEach((path, i) => {
        const last = path[path.length - 1]
        const d = Math.hypot(last.x - finish.x, last.y - finish.y)
        if (d < best) {
          best = d
          leader = i
        }
      })
    }
    this.run = {
      reason: end.reason,
      cursor: new ReplayCursor(replayTimeline(end.reason, startAt, end.replayMs)),
      bounds,
      paths: shown,
      pathList,
      leader,
      spanMs: replaySpanMs(shown.values()),
      replayBeatMs: end.replayMs,
      winnerId,
      winnerIsLocal: winnerId === localId,
      lap: end.reason === 'finish' && winnerId !== null,
      lapStarted: false,
      cameraTaken: false,
      lastNow: startAt,
    }
  }

  /** Once per frame with the server clock. */
  public update(serverNow: number) {
    const run = this.run
    if (!run) return
    const { beat, entered } = run.cursor.advance(serverNow)
    for (const kind of entered) this.enter(run, kind)
    const dt = Math.min(MAX_DT_MS, Math.max(0, serverNow - run.lastNow))
    run.lastNow = serverNow
    if (!run.cameraTaken) return

    const { camera, paths } = this.ports
    // The winner, at the zoom-1 framing the follow will settle on, so the hand-over doesn't jump
    let target: Pose | undefined
    const winner = run.lap && run.winnerId !== null ? this.ports.players.spriteFor(run.winnerId) : undefined
    if (winner) target = clampCenter(run.bounds, camera.width, camera.height, 1, winner.x, winner.y, this.target)

    let raceMs = run.spanMs
    if (beat.kind === 'zoomOut') raceMs = 0
    else if (beat.kind === 'replay') {
      // Real race time at REPLAY_SPEED; an older server's fixed beat fits the whole race instead
      raceMs =
        run.replayBeatMs === undefined
          ? beat.p * run.spanMs
          : Math.min(run.spanMs, beat.p * run.replayBeatMs * REPLAY_SPEED)
    }

    // From the lap on Phaser's follow moves the camera
    const following = run.lapStarted
    if (!following) {
      if (beat.kind === 'zoomOut') {
        this.frameHeads(run, 0, this.group)
      } else if (beat.kind === 'replay' || !target) {
        // The follow cam; with no one to zoom in on (a timeout) it stays on the field to the end
        this.frameHeads(run, raceMs, this.goal)
        dampPose(this.group, this.goal, dt, GROUP_POS_HALFLIFE_MS, GROUP_ZOOM_HALFLIFE_MS)
        // The damping lags a fast head: never so far that the leader leaves the frame
        this.keepLeader(run, raceMs, this.group)
      }
      const group = beat.kind === 'zoomIn' ? this.zoomInFrom : this.group
      camera.apply(posePlan(beat, this.from, group, target, this.pose))
    }

    let alpha = 1
    if (beat.kind === 'zoomIn' && target) alpha = 1 - (1 - LAP_LINE_ALPHA) * easeInOutCubic(beat.p)
    else if (following) alpha = LAP_LINE_ALPHA
    paths.setAlpha(alpha)
    paths.update(raceMs, following ? 1 : this.pose.zoom)
  }

  /** The pose framing every trail head at `raceMs` (finished ones parked at their end). */
  private frameHeads(run: Run, raceMs: number, out: Pose) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < run.pathList.length; i++) {
      const { x, y } = headAt(run.pathList[i], raceMs, this.head)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (minX === Infinity) {
      // No routes to show (e.g. rejoined mid-round): stay where the camera was
      out.cx = this.from.cx
      out.cy = this.from.cy
      out.zoom = this.from.zoom
      return
    }
    fitBox(minX, minY, maxX, maxY, this.ports.camera.width, this.ports.camera.height, out)
    // Too spread to fit at the zoom floor: keep the leader in, not the middle of the field
    this.keepLeader(run, raceMs, out)
  }

  private keepLeader(run: Run, raceMs: number, pose: Pose) {
    if (run.leader < 0) return
    const { x, y } = headAt(run.pathList[run.leader], raceMs, this.head)
    keepInView(pose, x, y, this.ports.camera.width, this.ports.camera.height)
  }

  private enter(run: Run, kind: BeatKind) {
    const { camera, paths, players, director } = this.ports
    switch (kind) {
      case 'zoomOut':
        camera.current(this.from)
        camera.begin()
        this.frameHeads(run, 0, this.group)
        run.cameraTaken = true
        break
      case 'replay':
        paths.setPaths(run.paths, run.winnerId, (id) => players.tintOf(id))
        break
      case 'zoomIn':
        this.zoomInFrom.cx = this.group.cx
        this.zoomInFrom.cy = this.group.cy
        this.zoomInFrom.zoom = this.group.zoom
        break
      case 'victoryLap': {
        if (!run.lap || run.winnerId === null) break
        const winner = players.spriteFor(run.winnerId)
        // The winner left during the replay: the follow cam stays on the field
        if (!winner) break
        camera.follow(winner)
        run.lapStarted = true
        if (run.winnerIsLocal) director.startVictoryLap()
        else players.freezeRemote(run.winnerId, false)
        break
      }
      case 'results':
        if (!run.lapStarted || run.winnerId === null) break
        if (run.winnerIsLocal) director.endVictoryLap()
        else players.freezeRemote(run.winnerId, true)
        break
    }
  }

  /** Stops the sequence and puts the camera back; safe to call at any time, repeatedly. */
  public cancel() {
    const run = this.run
    if (!run) return
    this.run = undefined
    const { camera, paths, players, director } = this.ports
    if (run.lapStarted && run.winnerId !== null) {
      if (run.winnerIsLocal) director.endVictoryLap()
      else players.freezeRemote(run.winnerId, true)
    }
    paths.clear()
    if (run.cameraTaken) camera.reset()
  }
}
