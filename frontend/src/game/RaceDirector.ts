import {
  controlsLocked,
  FinishGate,
  finishCrossing,
  localPlan,
  RoundPhase,
  RoundPlan,
  roundPhaseAt,
} from 'game/race/round'
import type { Point } from 'game/race/stage'
import { STEP_MS } from 'game/race/tuning'
import type { PhysicsSprite } from 'game/render/PlayerVisuals'

/** What the HUD shows about the round. */
export interface RaceView {
  phase: RoundPhase
  /** Race time so far, frozen at the finish time once finished. */
  raceMs: number
  finishedMs?: number
  /** Ms since GO, for the brief GO flash. */
  sinceGoMs?: number
}

/**
 * Runs a solo round on the physics step: snap to the start slot and hold through the 3-2-1
 * countdown, then count race steps from GO and detect the finish crossing. Time is the step clock
 * (steps × step length), so the result does not depend on frame rate or tab hitches.
 */
export class RaceDirector {
  private steps = 0
  private plan: RoundPlan
  private phase: RoundPhase = { kind: 'waiting' }
  private goStep?: number
  private finishedMs?: number
  private prev?: Point
  private gate: FinishGate
  private slot: Point

  constructor(
    private readonly localSprite: () => PhysicsSprite | undefined,
    /** Called when the orb is snapped to its slot, to refill the pilot and drop pending presses. */
    private readonly onSnap: () => void,
  ) {}

  /** Starts a new solo round on a stage. */
  public start(gate: FinishGate, slot: Point) {
    this.gate = gate
    this.slot = slot
    this.plan = localPlan(this.steps * STEP_MS)
    this.goStep = undefined
    this.finishedMs = undefined
    this.prev = undefined
  }

  /** True while inputs are ignored (snap and countdown). */
  public get locked(): boolean {
    return controlsLocked(this.phase)
  }

  /** Runs once per physics step, after the step moved bodies and before player input applies. */
  public step() {
    if (!this.plan) return
    this.steps++
    this.phase = roundPhaseAt(this.plan, this.steps * STEP_MS)
    const sprite = this.localSprite()
    if (!sprite) return

    if (controlsLocked(this.phase)) {
      // Hold the body centre at the start slot. Only the body is moved: within a frame of
      // several steps the sprite is stale, and Arcade carries the body's move over to it after
      const body = sprite.body
      body.stop()
      body.position.x += this.slot.x - body.center.x
      body.position.y += this.slot.y - body.center.y
      body.updateCenter()
      this.onSnap()
      return
    }
    if (this.phase.kind !== 'race') return

    if (this.goStep === undefined) this.goStep = this.steps
    const cur = { x: sprite.body.center.x, y: sprite.body.center.y }
    const raceStep = this.steps - this.goStep
    if (this.finishedMs === undefined && this.prev && raceStep > 0) {
      this.finishedMs = finishCrossing(this.prev, cur, this.gate, raceStep, STEP_MS)
    }
    this.prev = cur
  }

  public view(): RaceView {
    const sinceGoMs = this.goStep === undefined ? undefined : (this.steps - this.goStep) * STEP_MS
    return {
      phase: this.phase,
      raceMs: this.finishedMs ?? sinceGoMs ?? 0,
      finishedMs: this.finishedMs,
      sinceGoMs,
    }
  }
}
