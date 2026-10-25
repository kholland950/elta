// Relative imports: vitest has no path aliases, and this file is unit tested
import {
  controlsLocked,
  FinishGate,
  finishCrossing,
  gateOpen,
  localPlan,
  RoundPhase,
  RoundPlan,
  roundPhaseAt,
} from './race/round'
import { exploreLeftMs } from './race/match'
import type { Point } from './race/stage'
import { STEP_MS } from './race/tuning'
import type { PhysicsSprite } from './render/PlayerVisuals'

/**
 * What the director is running:
 * - `solo`: a local round on the step clock (no connection; `?seed=`, R restarts)
 * - `free`: free roam with no clock (the lobby sandbox)
 * - `round`: a server round, phases from the server clock
 * - `ended`: the round is over; the orb is held where it was
 * - `victory`: the winner's lap after the round: free to fly, and nothing is timed or counted
 */
export type DirectorMode = 'solo' | 'free' | 'round' | 'ended' | 'victory'

/** What the HUD shows about the round. */
export interface RaceView {
  mode: DirectorMode
  phase: RoundPhase
  /** Race time so far, frozen at the finish time once finished. */
  raceMs: number
  finishedMs?: number
  /** Ms since GO, for the brief GO flash. */
  sinceGoMs?: number
  /** Ms of explore left, during a server round's explore (and the wait before it). */
  exploreLeftMs?: number
  /** Whether the start-bay gates are open (they keep their last state once the round ended). */
  gatesOpen: boolean
}

interface RoundCallbacks {
  /** The orb crossed the finish line; called once per round with the race time. */
  onFinish(raceMs: number): void
  /** Explore began: every orb starts it in its own bay. */
  onExplore(): void
  /** The snap began: orbs go to their start slots. */
  onSnap(): void
}

const FREE: RoundPhase = { kind: 'waiting' }

/**
 * Runs the round on the physics step: holds the orb at its start slot through the snap and the
 * 3-2-1, counts race steps from GO and detects the finish crossing. Race time is the step clock
 * (steps × step length), so the result does not depend on frame rate or tab hitches. In a server
 * round only the phase boundaries come from the server clock.
 */
export class RaceDirector {
  private steps = 0
  private mode: DirectorMode = 'free'
  private plan?: RoundPlan
  private clock: () => number = () => this.steps * STEP_MS
  private phase: RoundPhase = FREE
  private goStep?: number
  private finishedMs?: number
  private prev?: Point
  private gate?: FinishGate
  private slot: Point = { x: 0, y: 0 }
  private snapped = false
  private explored = false
  private gates = true
  /** A placement waiting for the next physics step (see `place`). */
  private pending?: Point
  /** Where the orb is held after the round ended. */
  private holdAt?: Point
  /**
   * Where the victory lap started (the winner's finish position); kept for the respawn rule
   * hazards will need, which nothing triggers yet.
   */
  private lapSpawn?: Point
  private callbacks?: RoundCallbacks

  constructor(
    private readonly localSprite: () => PhysicsSprite | undefined,
    /** Called while the orb is held at its slot, to refill the pilot and drop pending presses. */
    private readonly onHold: () => void,
  ) {}

  /** A solo round on a stage: straight to the slot and the countdown, timed by the step clock. */
  public startSolo(gate: FinishGate, slot: Point) {
    this.reset('solo', gate, slot)
    this.clock = () => this.steps * STEP_MS
    this.plan = localPlan(this.clock())
  }

  /** Free roam (the lobby sandbox): the orb is placed at `slot` once and nothing is timed. */
  public startFree(slot: Point) {
    this.reset('free', undefined, slot)
    this.place(slot)
  }

  /**
   * A server round. The orb waits in its bay (held, gate shut) until explore, starts explore
   * there with the gate open, phases follow `serverNow`, and the finish is reported through
   * `callbacks.onFinish`.
   */
  public startRound(
    gate: FinishGate,
    slot: Point,
    plan: RoundPlan,
    serverNow: () => number,
    callbacks: RoundCallbacks,
  ) {
    this.reset('round', gate, slot)
    this.plan = plan
    this.clock = serverNow
    this.callbacks = callbacks
    this.place(slot)
  }

  /** The round is over: hold the orb where it is and stop timing. */
  public end() {
    if (this.mode === 'ended') return
    this.mode = 'ended'
    // A round skipped before GO drops its countdown; one ended in the race keeps its clock frozen
    if (this.phase.kind !== 'race') this.phase = FREE
    this.holdHere()
  }

  /**
   * The winner's victory lap: the orb flies free from where it is held, with no clock and no
   * finish. Only from `ended`; presses latched while held are dropped first.
   */
  public startVictoryLap() {
    if (this.mode !== 'ended') return
    this.mode = 'victory'
    this.lapSpawn = this.holdAt
    this.onHold()
  }

  /** The lap is over: back to `ended`, holding the orb wherever the lap left it. */
  public endVictoryLap() {
    if (this.mode !== 'victory') return
    this.mode = 'ended'
    this.holdHere()
  }

  private holdHere() {
    const sprite = this.localSprite()
    this.holdAt = sprite ? { x: sprite.body.center.x, y: sprite.body.center.y } : undefined
  }

  /** Where the last victory lap started, if one has. */
  public get victorySpawn(): Point | undefined {
    return this.lapSpawn
  }

  private reset(mode: DirectorMode, gate: FinishGate | undefined, slot: Point) {
    this.mode = mode
    this.gate = gate
    this.slot = slot
    this.plan = undefined
    this.phase = FREE
    this.goStep = undefined
    this.finishedMs = undefined
    this.prev = undefined
    this.snapped = false
    this.explored = false
    this.gates = mode === 'free'
    this.pending = undefined
    this.holdAt = undefined
    this.lapSpawn = undefined
    this.callbacks = undefined
  }

  /**
   * True while inputs are ignored: the wait before a server round's explore, the snap, the
   * countdown, and after the round ended (except for the winner's victory lap).
   */
  public get locked(): boolean {
    if (this.mode === 'victory') return false
    return this.mode === 'ended' || controlsLocked(this.phase) || this.waitingInBay()
  }

  private waitingInBay(): boolean {
    return this.mode === 'round' && this.phase.kind === 'waiting'
  }

  /** True while a server round holds every orb in its bay (before explore, snap, countdown). */
  public get heldInBays(): boolean {
    return this.mode === 'round' && (this.waitingInBay() || controlsLocked(this.phase))
  }

  /** Whether the start-bay gates are open (see `gateOpen`); unchanged once the round ended. */
  public get gatesOpen(): boolean {
    return this.gates
  }

  public get currentMode(): DirectorMode {
    return this.mode
  }

  /** Runs once per physics step, after the step moved bodies and before player input applies. */
  public step() {
    const sprite = this.localSprite()
    // The lap neither counts steps (the shown time stays frozen) nor looks for the finish
    if (this.mode === 'victory') return
    if (this.mode === 'ended') {
      // The step count stops too, so the shown race time freezes
      if (sprite && this.holdAt) this.hold(sprite, this.holdAt)
      return
    }
    this.steps++
    if (sprite && this.pending) {
      this.hold(sprite, this.pending)
      this.pending = undefined
    }
    if (!this.plan || !this.gate) return
    this.phase = roundPhaseAt(this.plan, this.clock())
    this.gates = gateOpen(this.phase)
    if (!sprite) return

    if (this.waitingInBay()) {
      this.hold(sprite, this.slot)
      return
    }
    if (this.phase.kind === 'explore' && !this.explored) {
      // The orb has been held in its bay since the round started; explore begins from there
      this.explored = true
      this.hold(sprite, this.slot)
      this.callbacks?.onExplore()
    }
    if (controlsLocked(this.phase)) {
      if (!this.snapped) {
        this.snapped = true
        this.callbacks?.onSnap()
      }
      this.hold(sprite, this.slot)
      return
    }
    if (this.phase.kind !== 'race') return

    if (this.goStep === undefined) {
      // A round joined late (e.g. the tab was asleep through the snap) still starts at the slot
      if (!this.snapped) {
        this.snapped = true
        this.callbacks?.onSnap()
        this.hold(sprite, this.slot)
      }
      this.goStep = this.steps
    }
    const cur = { x: sprite.body.center.x, y: sprite.body.center.y }
    const raceStep = this.steps - this.goStep
    if (this.finishedMs === undefined && this.prev && raceStep > 0) {
      this.finishedMs = finishCrossing(this.prev, cur, this.gate, raceStep, STEP_MS)
      if (this.finishedMs !== undefined) this.callbacks?.onFinish(this.finishedMs)
    }
    this.prev = cur
  }

  /**
   * Puts the orb at `point` once, at rest. Called outside a physics step (from a server message
   * or a stage load), where moving only the body is lost: Arcade's per-frame preUpdate copies the
   * sprite's position back onto the body. So the body is moved now (for anything that reads it
   * before then) and again on the next step, whose post-update carries it over to the sprite.
   */
  private place(point: Point) {
    this.pending = point
    const sprite = this.localSprite()
    if (sprite) this.hold(sprite, point)
  }

  /**
   * Holds the body centre at `point`. Only the body is moved: within a frame of several steps the
   * sprite is stale, and Arcade carries the body's move over to it after.
   */
  private hold(sprite: PhysicsSprite, point: Point) {
    const body = sprite.body
    body.stop()
    body.position.x += point.x - body.center.x
    body.position.y += point.y - body.center.y
    body.updateCenter()
    this.onHold()
  }

  public view(): RaceView {
    const sinceGoMs = this.goStep === undefined ? undefined : (this.steps - this.goStep) * STEP_MS
    const exploring = this.phase.kind === 'explore' || this.phase.kind === 'waiting'
    const exploreLeft =
      this.mode === 'round' && this.plan && exploring ? exploreLeftMs(this.plan, this.clock()) : undefined
    return {
      mode: this.mode,
      phase: this.phase,
      raceMs: this.finishedMs ?? sinceGoMs ?? 0,
      finishedMs: this.finishedMs,
      sinceGoMs,
      exploreLeftMs: exploreLeft,
      gatesOpen: this.gates,
    }
  }
}
