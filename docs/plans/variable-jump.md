# Variable-height first jump

## Context
Today every flap instantly sets an upward speed from `FLAP_SEQUENCE` × `JUMP_VELOCITY`. The first flap always rises the full ~227 px, so a player can't make a small hop. Goal: the first flap launches immediately, as today. Letting go of jump early gives a lower jump. Holding gives exactly today's full height. Flaps 2–5 are unchanged.

## Settled decisions (grill)
1. **First flap anywhere.** The variable flap is `flapIndex === 0`: from the ground, the sea, or mid-air after walking off a ledge.
2. **Cut on release.** Launch at full speed. Releasing jump while still rising multiplies upward speed by `JUMP_CUT`.
3. **`JUMP_CUT = 0.5`.** The quickest tap rises about 1/4 of full height (≈57 px). The value lives in `tuning.ts` and is meant to be tuned in playtest.
4. **Window closes when anything else pushes the orb.** A second flap, a stall, a bounce pad or a bump ends the cut window.
5. **Release only matters while rising.** Once vy ≥ 0 the window is closed.
6. **Every jump binding counts.** Jump counts as released only when no bound jump code is held.
7. **No toggle.** Dash, stall, flaps 2–5, the generator budgets and the network protocol stay as they are. Remote orbs already get the velocity change through the position/velocity sync in `PlayerManager`.
8. **The `phaser4-gamedev` agent builds it** (the user asked for it by name).

## Design
Layering follows the existing split: `race/` holds pure rules with no Phaser imports, `input/` turns input into frames, and `PlayerManager` is the adapter. No new files or interfaces.

**Entities / rules: [movement.ts](frontend/src/game/race/movement.ts)**
- `InputFrame` gains `flapHeld: boolean`. `NO_INPUT.flapHeld = false`.
- `PilotState` gains:
  - `jumpCut: boolean`: the cut window is open.
  - `lastVy: number`: the vy this step set, used to spot outside upward pushes.
  - `freshPilot` sets these to `false` and `0`.
- `stepPilot` order is stall → flap → **cut** → dash:
  - At the start of the step, close the window if `vel.y >= 0` (top of the arc, a ceiling, or a downward bump). Also close it if `vel.y < state.lastVy - ε`: gravity and drag only ever make vy larger, so a more-upward vy means a pad or bump pushed the orb.
  - A stall closes the window.
  - A flap closes the window, then a flap with `flapIndex === 0` reopens it.
  - Cut: if the window is open, `!input.flapHeld` and `velocity.y < 0`, set `velocity.y *= JUMP_CUT` and close the window. A press and release inside one step therefore fires the flap and cuts it in the same step, which gives the minimum tap.
  - Set `next.lastVy = velocity.y` before returning.
- `recharge` leaves `jumpCut` alone, so brushing a wall mid-rise doesn't take away control of the tap.
- Add a pure `endJumpCut(state)` helper that returns `{ ...state, jumpCut: false }`. `bumped()` calls it explicitly, because a bump weaker than the current rise isn't caught by the vy check.

**Tuning: [tuning.ts](frontend/src/game/race/tuning.ts)**
- Add `JUMP_CUT = 0.5` with a doc comment, matching the style of the file's other starting values.
- `launchApex`, `maxFlapClimb` and `CLIMB_BUDGET` are unchanged, because holding reproduces today's arc.

**Input adapter: [controls.ts](frontend/src/game/input/controls.ts)**
- `frame()` sets `flapHeld: this.keyHeld('jump')`. Widen the `keyHeld` parameter type to include `'jump'`.
- Pad A already arrives as a `Pad0` code through `keyDown`/`keyUp` (via [gamepadHub.ts](frontend/src/game/input/gamepadHub.ts)), so keyboard, mouse and pad all work the same way.
- Update the class doc comment to mention that jump is now also read as held.

**Phaser adapter: [PlayerManager.ts](frontend/src/game/PlayerManager.ts)**
- `bumped()` does `this.pilot = endJumpCut(this.pilot)`.
- No other changes. `step()` already passes the body velocity into `stepPilot` and writes the result back. Pads (set in [StageWorld.ts:58](frontend/src/game/stage/StageWorld.ts#L58)) are caught by the `lastVy` check.

## Build order (one slice)
1. [x] Add `JUMP_CUT` to `tuning.ts`. Add the `movement.ts` state, cut logic and `endJumpCut`, with unit tests.
2. [x] Add `flapHeld` in `controls.ts`, with unit tests.
3. [x] Add the `endJumpCut` call in `PlayerManager.bumped`.
4. [x] Fix existing tests and sims that model flaps. Sims that mean "full flap" must pass `flapHeld: true`; otherwise the first flap gets cut and `maxFlapClimb` / sea-reach checks fail. Known sites:
   - `movement.test.ts` around line 245–270 (the flap-at-apex sim).
   - Any sea-climb sim that calls `stepPilot`.

   Grep for `stepPilot(` and `flapPressed: true` to find the rest.

### Build notes
- No other `stepPilot` callers outside `movement.test.ts` and `PlayerManager`. The shared `flap` fixture in `movement.test.ts` now holds jump (a full flap), and `flapAtApex` holds jump between flaps; that covers the flap-sequence tests and both reach-budget sims (open air and sea).
- The push tolerance is `PUSH_EPSILON = 1` px/s, a private constant in `movement.ts` (not a tuning value).
- Not yet done: the browser playtest under Verification.

## Tests
**movement.test.ts** (pure, no I/O):
- Held first flap: vy stays `-JUMP_VELOCITY` and isn't cut.
- Released mid-rise: vy is halved once, and releasing again does nothing.
- Press and release in the same frame: vy is `-JUMP_VELOCITY * JUMP_CUT` on the same step.
- Release after the apex (vel.y ≥ 0): no change.
- Flap 2 released early: not cut.
- A stall during the rise closes the window.
- Incoming vy more upward than `lastVy` (a pad) closes the window.
- `endJumpCut` closes the window.
- Simulated tap apex ≈ 1/4 of the held apex (within tolerance). Held apex equals `launchApex(JUMP_VELOCITY)`.

**controls.test.ts**:
- `flapHeld` is true while any bound jump code is held, including `Pad0`.
- `flapHeld` stays true until all of them are released.
- `releaseAll` clears it.
- Rebinding still works.

**Existing suites**: `maxFlapClimb`, the stage sweeps and the generator tests must still pass unchanged.

## Verification
- From `frontend/`, run the vitest suite **on its own**: no full Gradle+Rollup build, because of WSL low memory. Run any build in separate, capped steps.
- Playtest in the browser with keyboard and pad:
  - A quick tap gives a small hop; holding gives the full jump.
  - Flaps 2–5 feel the same as before.
  - A bounce pad launch isn't cut by letting go.
  - A remote client sees the short hop.

## Open risks
- Opening the menu mid-rise calls `releaseAll`, which reads as a release and cuts the jump. That's harmless, but worth noting.
- The `lastVy` check uses an ε tolerance. Pick it well above floating-point noise and well below any pad or bump speed (e.g. 1 px/s).
