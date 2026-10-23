# Orb Racer — plan

Status: approved at Gate 2 (2026-10-23). Slices are ticked off below and deviations go under "Implementation notes" at the end.

## Context
The tech demo is a Ktor relay plus a Phaser 4 client. Energy orbs move, flap, dash and stall, and each client is authoritative for its own movement. It becomes a **technical multiplayer racer in the spirit of Trackmania**: each round is a new procedurally generated, neon-space platform stage that runs left to right with verticality and branches. Friends race in private rooms, bump each other, and the first to N round wins takes the match.

## Summary
- **Users:** friends in private, link-shared rooms of 2–8 players (solo allowed).
- **Success:** a group can open a link and play a first-to-N match. Each round is a fresh ~1 min stage that can be completed. Movement feels the same at any frame rate. Skill (flap rhythm, stall→dash, wall bouncing, reading routes) decides who wins.
- **Out of scope:**
  - accounts, matchmaking and persistence
  - pickups, touch and gamepad controls
  - checkpoint splits, best times and ghosts
  - anti-cheat beyond a plausibility clamp
  - one-way platforms and a ghost-mode toggle

## Settled decisions (Gate 1, plus the follow-ups after Gate 1)

### Match flow
- First to N round wins; the host picks N from 1, 3, 5 or 7.
- Each round is a **new seed**.
- **Lobby:** while waiting, players free-roam a fixed sandbox stage (seed 0, difficulty 1). Players can only join in the lobby; a 9th player is rejected as "full".
- **Round:**
  1. 15 s explore. Players roam the whole stage with bumps on.
  2. Snap to stacked start slots (order randomised).
  3. 3-2-1 countdown, then the race.
- **Round end:** the round ends **instantly on the first finish**. The other orbs disintegrate, the winner celebrates, and the scoreboard shows.
- **Photo finish:** each client reports its own race time. The server collects reports for 150 ms and the lowest time wins (the window is a starting value).
- **Stuck rounds:**
  - A **120 s timeout** ends the round with no point.
  - A **unanimous vote-skip** ends it early with no point, for broken stages. Players vote with the V key, and the HUD shows the vote count.
- **Host:** if the host leaves, the next-oldest player becomes host. A disconnect just removes that orb.

### Movement
- **Flap** lift follows the sequence 100/80/60/40/20 % and then gives 0. The sequence resets on recharge.
- **Recharge** (flap sequence, 2 dashes, 1 stall) happens on contact with any surface, hazard or player.
- **Stall (E)** fires whatever direction keys are held. It is an instant stop to zero velocity.
- **Dash** is horizontal only.
- **Bump:**
  - Each orb's velocity is **set** to a constant push away from the other orb on both axes (starting values ±500 x, ±800 y).
  - It also recharges.
  - There is a 200 ms cooldown per pair of orbs.
  - Each client applies the bump to its own orb only.
- **Walls** only recharge; they have no special wall mechanic.

### Stage
- A left-to-right spine of branches that split and rejoin as risk/reward choices.
- **Shape (revised after the slice 1 play review, 2026-10-23):** stages are mostly **enclosed tunnels**. Each tunnel has a floor, a ceiling and walls, and twists up, down, left and right. Tunnels open into **small chambers** that hold the bounce, stall and other set pieces. There are lots of walls, little open space and few chances to fall. Branches are separate tunnels. Tunnel height **varies between 150 and 400 px** (a starting value; tighter at higher difficulty).
- The **energy sea** is still the global floor and still adds drag. The tunnels float above it. You can only fall into the sea through openings at the bottom of chambers, and every chamber that opens onto the sea must have a way back up. There are no pits and no respawns.
- **Start area (revised after the slice 2 review, 2026-10-23):** a stack of **gate bays**, one per player in the round, with one player per bay. The bay count comes from `roundStart.startOrder.length`, so the stage is a pure function of `(seed, difficulty, bays)`. **Explore:** each player spawns in their own bay with its gate open and can roam freely. **Snap:** each player returns to their bay and the gates shut (a glowing barrier). **GO:** all gates drop at once.
- **Lobby (revised the same day):** a **fixed, hand-built room** about 2 screens wide, with a floor, a few platforms, walls and a bounce pad. It replaces the seed 0 sandbox.
- **Recharge stays "any surface"**, walls included. This was confirmed with the corridor change in mind: in tunnels you'll nearly always be fully charged, so skill comes from routing and execution.
- **Elements:** solid platforms, bounce pads, boost pads, moving platforms (driven by race time), and knockback hazards (which also refill).
- **Stall slots** are optional shortcuts.
- The generator is a seeded **segment grammar**.
- **Difficulty:** a 1–10 scale. Host presets are Easy 2, Normal 4 and Hard 6. Difficulty rises +1 per round, capped at base + 3 (never above 10).
- **Visuals:** neon hard-light platforms (procedural Graphics plus bloom) and a rippling energy sea.

### HUD and camera
- Plain lerp follow camera, as today.
- Progress strip, edge arrows, race timer and countdown.

### Network and authority
- The server owns rooms, seed, the phase schedule, the winner and the vote.
- Each client owns its own movement.
- The room code is generated by the client and the room is created on first join.

### Constraints
- Keyboard only. Same Docker deploy, with rooms held in memory. No deadline.
- Build order is fun first.

## Glossary
| Term | Meaning |
|---|---|
| **Match** | First to N round wins |
| **Round** | One stage: explore → snap → countdown → race → end |
| **Stage** | A generated level for one round |
| **Segment** | A typed piece of a stage |
| **Spine** | The route polyline used to measure progress |
| **Explore** | The 15 s free roam before the countdown |
| **Energy sea** | The floor everywhere, with drag |
| **Stall slot** | A bounce → stall → dash shortcut |
| **Flap sequence** | 100/80/60/40/20 % lift |
| **Recharge** | Refill of flap sequence, dashes and stall |
| **Race time** | Physics steps since GO × step length, plus the finish-line crossing fraction |

## Key findings from the code
- **Phaser physics stepping (Phaser 4.2.1):** Arcade already integrates at a fixed 60 Hz step (`fixedStep` defaults to true, verified in `node_modules/phaser/src/physics/arcade/World.js`). However, input handling, `setVelocity` and the manual `physics.collide` in `PlayerManager.update()` run **per display frame**, so the game behaves differently at 30, 60 or 144 Hz.
  - **Fix:** set `physics.arcade.fps: 120` in `Game.ts`. All per-tick logic runs on the `worldstep` event, and collision uses `physics.add.collider/overlap`.
- **Existing bugs fixed along the way:**
  - The stall is unreachable while a direction key is held (it sits behind an `else if`).
  - A bump pushes the remote orb's body as well as your own (`PlayerManager.ts:279-285`).
  - `lastX`/`lastY` are module globals.
  - `src/MessageBroker.kt` uses an unsynchronised global `HashMap`/`MutableList`.
- **Reach budget:** jump 1000 and gravity 2000 give flap apex heights of 250, 160, 90, 40 and 10 px, about 550 px of maximum open-air climb (computed; starting value).

## Layers

The core is pure (entities and use-case logic together) and adapters sit around it. There is no ceremonial use-case layer. The pure TS code follows the existing `fx/` precedent.

### Client (TypeScript): `frontend/src/game/race/` (pure; no Phaser, DOM or Svelte)

Entities:

| File | Contents |
|---|---|
| `rng.ts` | mulberry32 PRNG, integer ops only |
| `tuning.ts` | Physics constants moved out of `playerConfig`, `FLAP_SEQUENCE`, `BUMP`, pad and sea values, `STEP_HZ = 120`, `maxFlapClimb()` |
| `stage.ts` | Model types: `Rect`, `Solid`/`Bounce`/`Boost`/`Hazard`/`Mover`, `Port`, `Segment {type, bounds, entry, exit, elements, spine, nodes, edges, parMs}`, `Stage {seed, difficulty, bounds, seaY, segments, spine, startSlots, finishX}` |
| `segments.ts` | Segment types: `run`, `climbShaft`, `drop`, `stallSlot`, `fork`, `boostRun`, `movingCrossing`, `hazardGauntlet`, `switchback`, with parameters bounded by the reach budget |
| `generateStage.ts` | `generateStage(seed, difficulty)`: start pad → weighted segments joined at exit ports until Σ`parMs` ≥ 55 s → finish gate |
| `reach.ts` | Reach graph check: start → finish, **and every sea node → finish** (no softlocks). A failing segment is re-rolled on the same PRNG stream (up to 8 tries), then falls back to `run` |
| `motion.ts` | `platformAt(def, tMs)`: a triangle-wave mover (no trig), returning position and velocity |
| `progress.ts` | Progress along the spine, aware of segments that double back |
| `difficulty.ts` | Difficulty → generator knobs |

Use-case logic:

| File | Contents |
|---|---|
| `movement.ts` | `stepPilot(moveState, inputFrame, vel)` → velocity sets and feel events; `recharge`; `bumpVelocity(self, other)` (set, both axes); pair cooldown |
| `round.ts` | `roundPhaseAt(plan, now)` (explore, snap, countdown digit, race), `controlsLocked`, and `finishCrossing` for the interpolated finish time |
| `clockSync.ts` | Offset from the ping sample with the lowest round-trip time |
| `session.ts` | Slice 2. `reduceSession(state, serverMsg)` for the room view: players, host, settings, plan, results, votes |
| `protocol.ts` | Slice 2. Wire DTOs, following the `fx/actions.ts` precedent |

Also `fx/edgeArrow.ts` and `fx/stagePalette.ts` (pure).

Adapters (Phaser and Svelte):

| File | Role |
|---|---|
| `game/PlayerManager.ts` (slimmed) | Latches keys into an `InputFrame` and applies `stepPilot` output to the local body on `worldstep`. Contacts from the colliders go to `recharge` and the bump, applied to the local orb only |
| `game/stage/StageWorld.ts` | Arcade bodies built from `Stage`: static solids; immovable movers whose velocity comes from `platformAt`; overlap zones for pads, hazards, sea drag and the finish gate |
| `game/render/StageRenderer.ts`, `render/EnergySea.ts` | Neon graphics, culled per segment |
| `game/RaceDirector.ts` | Runs each step: phase changes, snap to slots, input lock, step counter from GO, finish detection and report, disintegrate and celebrate |
| `game/render/hud/{RaceTimer,Countdown,ProgressStrip,EdgeArrows,VoteSkip}.ts` | HUD readouts, drawn in `HUDScene` |
| `game/net/RoomConnection.ts` | Replaces `MessageBroker.ts` (slice 2). Owns the socket and fans messages out to the scene and `app/roomStore.ts` |
| `app/Lobby.svelte`, `app/RoundResults.svelte`, `app/roomStore.ts` | Lobby and results UI; `Main.svelte` creates a random 6-character room code |

Composition roots:
- `Game.ts` sets physics fps.
- `Room.svelte` creates `RoomConnection(roomId)` and calls `startGame(connection)`.
- `MainScene.create()` wires the scene objects.

Ports: the existing `FeelSink` and `KeyValueStore` stay and no new ones are added. In slice 1 a solo round passes a locally built plan into the same `round.ts`.

### Server (Kotlin `com.kholland`): a pure core with a thin shell around it

Pure core (`src/race/`; stdlib only, no Ktor or serialization). It takes `now: Long` as an argument and returns `Step(room, events, wakeAt)`:

| File | Contents |
|---|---|
| `Room.kt` | `join`, `leave` (host migration), `updateSettings` (host, lobby only), `startMatch`, `reportFinish`, `voteSkip`, `tick(now)` |
| `Phase.kt` | `Lobby`, `Round(plan, reports, windowEndsAt?, skipVotes)`, `Results(nextAt)`, `MatchOver(lobbyAt)` |
| `Match.kt` | Wins, round index, target, `difficultyFor(round)`, `isOver` |
| `PhotoFinish.kt` | Lowest time wins; ties go to the earlier arrival |
| `RoomEvent.kt` | Domain events |
| `Timings.kt` | explore 15 s, snap 0.5 s, countdown 3 s, finish window 150 ms, results 5 s, round timeout 120 s; injectable for tests |

Shell (`src/ws/`):

| File | Contents |
|---|---|
| `Protocol.kt` | `@Serializable` DTOs, `Envelope`, mapping from `RoomEvent` to DTO |
| `RoomActor.kt` | One coroutine and `Channel<Command>` per room. Serialises all access, keeps a single wake-up `delay` timer, and relays `playerMove`/`playerAction` within the room only |
| `RoomRegistry.kt` | `ConcurrentHashMap`; a room is created on first join and removed when empty |
| `GameSocket.kt` | Per-connection handler: waits for `joinRoom`, then forwards; sends `Leave` in `finally` |

- The composition root is `Application.kt`. It passes `clock` and `nextSeed` in as functions rather than interfaces.
- `src/MessageBroker.kt` is deleted.

## Protocol (`{event, data}` envelope unchanged)

Client → server:

| Event | Data |
|---|---|
| `joinRoom` | `{roomId, name, color, build}` |
| `clockPing` | `{t0}` |
| `updateSettings` | `{winsToMatch, difficulty}` |
| `startMatch` | `{}` |
| `voteSkip` | `{round}` |
| `finishReport` | `{round, raceTimeMs}` |
| `playerMove`, `playerAction` | Unchanged |

Server → client:

| Event | Data |
|---|---|
| `joined` | `{playerId, roomId, serverTime}` |
| `joinRejected` | `{reason: inProgress \| full \| badName \| staleBuild}` |
| `clockPong` | `{t0, serverTime}` |
| `roomState` | Full snapshot: `{hostId, phase, settings, players[{id, name, color, wins}]}` |
| `playerLeft` | `{playerId}` |
| `roundStart` | `{round, seed, difficulty, startOrder, exploreAt, snapAt, goAt}` |
| `skipVotes` | `{round, votes, needed}` |
| `roundEnd` | `{round, winnerId \| null, reason: finish \| timeout \| skipped, times, wins, nextRoundAt \| null, matchWinnerId \| null}` |

How timing works:
- **Clock sync:** 5 pings on join, keeping the one with the lowest round-trip time, plus 1 ping per `roundStart`.
- **Phases:** clients compute the phase locally from `roundStart` timestamps. There are no per-phase messages.
- **Race time** is measured from each client's own GO step. A clock-offset error only shifts *when* a client starts, not the time it reports.
- **Plausibility clamp:** a reported time must satisfy `raceTimeMs ≤ (now − goAt) + 500`.

## Dependency diagram
```
CLIENT
 Room.svelte (root) ─> net/RoomConnection, startGame
 Lobby/RoundResults.svelte ─> app/roomStore ─> race/session
 MainScene (root) ─> PlayerManager, StageWorld, StageRenderer, RaceDirector, HUD, render/*
   PlayerManager ─> race/movement, race/tuning, fx/feelEvents
   StageWorld, StageRenderer ─> race/stage, race/motion, fx/stagePalette
   RaceDirector ─> race/round, race/progress, race/generateStage, net/RoomConnection
   HUD ─> race/progress, fx/edgeArrow
   net/RoomConnection ─> race/protocol, race/clockSync
 race/* ─> nothing outward (movement → fx/feelEvents types only)
 fx/*   ─> nothing outward
SERVER
 Application.kt (root) ─> ws/RoomRegistry ─> ws/RoomActor ─> race/Room ─> race/*
 ws/GameSocket ─> ws/RoomRegistry, ws/Protocol ─> race/RoomEvent
 race/* ─> Kotlin stdlib only
Across the wire: only DTOs (race/protocol.ts <-> ws/Protocol.kt)
```

## Determinism rules (generator)
- Use one PRNG stream. No `Math.random` and no `Date`.
- Allow only `+ − × ÷` followed by `Math.round` or `|0`. Never use `sin`, `cos`, `pow` or `sqrt`, since engines don't guarantee identical results for these.
- Use arrays only, with template order fixed.
- All coordinates are integer pixels.
- Movers are a pure function of race time. During explore that is `serverNow − exploreAt`; during the race it is the step-derived race time.
- A build hash in `joinRoom` rejects stale tabs, because an old tab would generate a different stage.

## Build order (thin vertical slices)

### [x] Slice 1: solo fun (no server changes; the global relay stays)
- **Pure code:**
  - `race/` modules: `rng`, `tuning`, `stage`, `segments` (`run`, `climbShaft`, `drop`, `stallSlot`), `generateStage`, `reach`, `motion`, `progress`.
  - `movement` and `round` (local plan with no explore phase), all with tests.
- **Adapters:**
  - `Game.ts` gets fps 120. `PlayerManager` moves to `worldstep` with input latching and colliders.
  - `StageWorld` (solids, bounce pads, sea drag zone, finish gate), plus a basic `StageRenderer` and `EnergySea`.
  - `BackgroundRenderer` and the camera bounds come from `stage.bounds`.
  - `RaceDirector` runs the solo countdown → race → finish time. The HUD gets `RaceTimer` and `Countdown`.
  - URL parameters `?seed=` and `?diff=`. **R** restarts on a new seed.
- **Verify:**
  - vitest passes.
  - Same seed gives the same stage.
  - Jump height is the same at 30, 60 and 144 Hz.
  - Stall works while holding a direction.
  - 10 seeds can each be finished in about a minute.
  - **Play-feel review with the user before slice 2.**

### [x] Slice 2: rooms and match loop
- **Server:**
  - Kotlin `race/*` with unit tests first.
  - Then `ws/*` and the `Application.kt` root. Delete the old broker.
- **Client:**
  - `protocol`, `clockSync` and `session` with tests.
  - `RoomConnection`, `roomStore`, `Lobby.svelte` (settings, Start, sandbox behind it), `RoundResults.svelte`.
  - `RaceDirector` driven by the server plan: explore, snap, countdown, race, `finishReport`, `roundEnd` FX, vote-skip key and HUD, 120 s timeout.
- **Verify:**
  - Kotlin unit and integration tests pass.
  - With 3 tabs: identical stage, host migration, a mid-match join rejected, a photo finish, a unanimous skip, a timeout, and the match ending at N then returning to the lobby.

### [ ] Slice 3: content and HUD
- The remaining segment types (`fork`, `boostRun`, `movingCrossing`, `hazardGauntlet`, `switchback`) with boost, hazard and mover elements.
- Difficulty knobs and the per-round ramp.
- `ProgressStrip` and `EdgeArrows`.
- **Verify:** generator property tests cover every segment type, and a manual pass over switchbacks and edge arrows at the screen corners.

### [ ] Slice 4: polish
- Neon hard-light look and a rippling energy sea.
- Disintegrate and celebrate effects.
- Render interpolation if judder shows at 144 Hz.
- `?perf` check on an integrated GPU.

### Every slice
```
cd frontend && npx vitest run && npx tsc --noEmit   # only the existing TS6133 'up' error is expected
NODE_OPTIONS=--max-old-space-size=2048 npm run build
./gradlew compileKotlin test -x npm_run_build -x npmInstall -Pkotlin.compiler.execution.strategy=in-process --max-workers=1
```
Run the frontend and backend builds one after the other, never in parallel: the WSL VM has about 6 GB of memory.

Agent routing:
- Phaser canvas work goes to phaser4-gamedev.
- Svelte lobby and results work goes to frontend-developer.
- Kotlin server work is done directly or with kotlin-expert.

## Test strategy
- **Vitest, pure code:**
  - `rng`: known sequence for a fixed seed.
  - **Generator sweep:** 500 seeds × difficulties 1–10. Each stage must:
    - come out identical when generated twice
    - match hash snapshots for 3 seeds
    - have integer, in-bounds coordinates
    - have no overlapping solids
    - have a par time between 50 and 65 s
    - pass the traversal check from start → finish and from every sea node → finish
    - place each stall-slot apex within tolerance
    - keep every climb ≤ the reach budget
  - `movement`: flap sequence and its reset, stall while a direction is held, dash keeps vertical velocity, bump sign matrix (set velocity) and cooldown.
  - `motion`: periodic, continuous, and velocity matches the change in position.
  - `progress`: monotonic, including switchbacks.
  - `round`: phase boundaries and crossing interpolation.
  - `clockSync`, `session` (including votes and host change), `edgeArrow`.
- **Kotlin unit tests (`test/race/`)** are pure, with an explicit `now`:
  - **Room:** join, host, leave, migration, rejections, start and timestamps, 120 s timeout, unanimous skip (a player leaving changes the number of votes needed).
  - **PhotoFinish:** a later report with a lower time wins inside the window, a report after the window is ignored, a wrong round is ignored, ties go to the earlier arrival.
  - **Match:** ramp cap, ends at N, returns to lobby.
- **Kotlin integration test (`test/ws/RoomFlowTest.kt`):**
  - Uses `testApplication` with short timings and 2 websocket clients.
  - Covers join → start → same seed → reports → `roundEnd` winner.
  - Relays stay within a room (a client in another room receives nothing).
  - Adds `testImplementation` ktor-client-websockets.
- The existing smoke test stays green.

## Open risks
- **Graphics cost on 20–30k px stages:** cull per segment and measure in slice 1.
- **Moving platforms:** riders on movers need velocity-driven immovable bodies, with only small snap corrections.
- **Remote orbs** are still not interpolated at 32 TPS, so bumps against them may feel inconsistent. Add interpolation later if needed.
- **Reach graph limits:** the graph check can pass stages that real physics can't complete. A headless autopilot sweep is a later option, and vote-skip is the safety valve.
- **Slow clients:** one slow socket can slow its room's relay. This is fine for 8 friends; use a bounded outbound channel if it isn't.
- **`events.ts` bus:** it supports only one listener per event, so room messages go through `roomStore` instead.
- **Starting values to tune in playtest:** physics at 120 Hz, the flap sequence, bump 500/800, sea drag, the 150 ms finish window, 15 s explore, and the 120 s timeout.

## Implementation notes

### Slice 1 (client only; no server changes)
Deviations and choices made while building:
- **Sea drag** is applied per step in `PlayerManager` from `stage.seaY` (centre below the surface: horizontal speed capped at `SEA_MAX_VX` 250, vertical speed damped by `SEA_DAMP_Y` 0.985 per step) rather than through an overlap zone the width of the stage. The sea floor is the world bottom, so touching it recharges; the sea surface itself does not. The finish "gate" is a region (x ≥ `finishX`, above the sea) checked by `RaceDirector` with `finishCrossing`, not a physics body, so climbing out of the sea past the line also finishes.
- **Reach budgets** (in `tuning.ts`): `maxFlapClimb()` integrates the flap sequence exactly as Arcade does at 120 Hz with drag 200 (487 px, not the 550 px closed form without drag). The generator uses `CLIMB_BUDGET` = 75 % of that (365 px), `GAP_BUDGET` 520 px and `SEA_CLIMB_BUDGET` 240 px; tests simulate the motion and check each budget is achievable. The bounce pad sets vy 1700 (apex 650 px, beyond any flap climb).
- **Graph limits:** the reach check models flap climbs, drops, the sea strip and the stall-slot special edge. It does not model wall climbing (recharge on every wall touch makes walls climbable) or ceilings, so it is stricter than the game on walls and blind to head bumps; templates keep routes clear of overhangs.
- **Stall slot** layout: launch floor with a flush magenta pad, a barrier with the slot cut at the pad apex (apex in the slot's upper half), a landing level with the slot floor. The optional long way is a two-column stair up and over the barrier.
- **Model additions:** `SurfaceNode`/`SpecialEdge` types for the reach graph, `Segment.slot` (slot geometry for the apex test), `Stage.parMs`; each segment's last node is its exit node. Start slots stack upward 64 px apart above the left end of the start pad; solo uses slot 0.
- **Altitude band:** surfaces stay between 160 and 2400 px above the sea, so the strip over the sea is never blocked and every sea node can swim back to the start pad (200 px, within the sea climb budget). Stages come out 23–34 k px wide with ~17 segments; par 56–64 s.
- `motion.ts` (triangle-wave mover) is implemented and tested, but no slice 1 segment places movers.
- New pure helpers: `race/stageParams.ts` (`?seed=`/`?diff=` parsing; default difficulty 4; the URL is rewritten with `replaceState` on every stage load so it can be shared) and `fx/stagePalette.ts`.
- **Remote orbs** now live in an Arcade physics group so a single registered `overlap` covers players who join later. Bumps set only the local orb's velocity and are gated by the 200 ms per-pair cooldown, so the collision effect now fires once per bump instead of every frame of contact.
- **Input:** flap/dash/stall presses are latched from `keydown` events (repeats ignored) and consumed by the next physics step. Stall is a fresh press of E (the old 500 ms `DownDuration` hold is gone). A dash with no direction held goes the last facing way. A flap after the sequence is used up does nothing and emits nothing.
- Recharge now also triggers on the world's top bound. This uses the `up` parameter, so the old TS6133 error is gone and `tsc --noEmit` is clean.
- During the snap and countdown, `RaceDirector` holds the orb by shifting its **body**, not the sprite. With several steps in one frame the sprite is stale until Arcade's post-update, and `body.reset()` mis-places an offset circle hitbox for one step.
- Test hook: `?debugGame` exposes the game as `window.__PHASER_GAME__` for headless checks.
- **Verified headless** (Chromium with a driven clock): jump apex 222.9–224.0 px at 30, 37, 60 and 144 fps (the differences come from where the resting orb was in its micro-bounce); 120 steps per second at every rate; stall zeroes velocity while → is held; a dash sets vx 1500 and keeps vy; the flap sequence gives 1000/800/600/400/200 and then nothing; the finish is detected with an interpolated time; R loads a new seed and snaps back to the slot. **Not verified:** finishing 10 seeds by actual play, and the relay with remote orbs (no backend was run).

### Slice 1 rework: tunnels (after the play review)
The stage generator was rebuilt for the enclosed-tunnel design. These notes replace the slice 1 notes above on stage layout, budgets and the reach check where they conflict.
- **Grid:** stages are built on 50 px cells (`race/grid.ts`). Segments carve open space out of rock; every other cell above the tunnels is rock. Below the lowest open cell of each column there is a one-cell rock shell, then open air down to the sea. The rock is merged into rectangles that become the static bodies: row runs first, then identical runs are joined down, so flat floors and ceilings never have seams. The glowing edges are the merged rock/open boundary lines.
- **Segment types** (`segments.ts`): `run` (2–4 tunnel sections with floor steps and the odd lower ceiling), `shaftUp`, `shaftDown` (a lead-in, then a 100–200 px wide shaft, sometimes jogging left or right halfway, then an exit tunnel), and `stallChamber`. The stall chamber has a landing, a 2-cell pit in its floor onto the sea, a bounce pad, and a far wall with a tunnel mouth at the pad apex. The mouth narrows to a 100 px slot, then opens into a tunnel. The slow way into the mouth is climbing the far wall. Start and finish are chambers; the finish line only counts inside the finish chamber's rows (`FinishGate {x, top, bottom}`). Each segment's exit mouth shares at least 2 rows with the next piece.
- **Tunnel height:** 200–400 px at difficulty 1, down to 150–250 px at 10. A lower ceiling stretch never goes below 150 px. Shafts, chambers and the slot are not counted as tunnels.
- **Curtains:** every segment start gets a one-cell pillar from the tunnel shell down to the sea surface. This splits the air under the tunnels so you can't ceiling-skate from one pit to a later one; you have to swim under (sea drag). A mutation check showed curtains are **not** what prevents softlocks: the end-cap walls and shell undersides already give a way back up. They are there for routing.
- **Reach check** (`reach.ts`), on the cell grid: touching any rock, pad or the sea floor refills "flight energy". A full charge buys `CLIMB_BUDGET` of climb or `GAP_BUDGET` of sideways flight; going up and sideways at once is charged in full for each, so the check is stricter than the real arc. Falling is free, climbing inside the sea costs double, and a pad launches straight up to its apex. Wall-bounce climbing of shafts comes out of this naturally. Checks: start → finish; if the sea can be reached (a stall-chamber pit), sea floor → finish (the sea floor is one strip, so one run stands for every sea node). Stages without a stall chamber have no route into the sea at all. Each segment is also checked on its own (entry mouth → exit mouth); failures re-roll up to 8 times, then fall back to a run.
- **Sweep** is split into five parallel test files (`race/stageSweep.d01-02.test.ts` … `d09-10`, helper `race/stageSweep.ts`) so 500 seeds × 10 difficulties runs in about 16 s. It adds checks for tunnel height and for the stage being enclosed (rock in every column, nothing open on the top row). Mutation-checked: walls not recharging, tunnels too tall, and overlapping merges each fail the sweep.
- Stages come out about 25–28 k px wide with ~23 segments, around 110 solids and 300 edge lines. The renderer draws in 1600 px vertical strips, culled by x.
- **Verified headless** (driven clock): the pad launch peaks at y −912.7 against a predicted −913, inside its 150 px mouth; bounce → stall (E) → dash (→ + Shift) lands in the exit tunnel; a bot bouncing between the walls of a shaft (flapping while switching the held direction) climbs it and leaves through the exit tunnel. Overlapping interior rectangles stack their tint, so lowered ceilings and shaft joins show slightly brighter patches (cosmetic; slice 4).


### Slice 2: Phaser side (rooms and match loop)
Deviations and choices made while building:
- **`startGame(conn?)`**: with a `RoomConnection` the server drives the scene; without one the slice 1 solo round still runs (`?seed=`, `?diff=`, R), for development and headless checks. The connection is handed to the `MainScene` constructor (`scene: [new MainScene(conn), HUDScene]`).
- **Subscribing early:** the contract asks Phaser to subscribe in `MainScene.create`, but `create` runs after asset loading, so `joined`, the first `roomState` or a `roundStart` could arrive first and are never replayed. The scene therefore subscribes to `joined`, `roomState`, `playerLeft`, `roundStart`, `skipVotes` and `roundEnd` in its constructor (which `startGame` calls synchronously) through `race/match.ts` `MatchTracker`, and only `playerMove`/`playerAction` in `create` (losing a few position updates is harmless). This is stricter than the contract, not a change to it.
- **`race/match.ts`** (pure, tested with a fake connection): `reduceMatch` keeps the scene's view of the room (me, phase, players, current round, its end, votes). It overlaps with the frontend's `race/session.ts`, which was being written in parallel with no agreed signature; the two could be merged later. Also `stageFor` (sandbox seed 0 difficulty 1 in the lobby and before round 1, else the round's stage; a key per round triggers a rebuild), `startSlotIndex` (index in `startOrder`; a missing id goes after everyone, clamped to the 8 slots), `lobbySlotIndex` (join order, so the sandbox doesn't stack everyone on slot 0), `exploreLeftMs`, `canVoteSkip`, `shownVotes`.
- **Phases** come from `roundPhaseAt(plan, conn.serverNow())` each physics step; race time still counts steps from the client's own GO step. `waiting` (before `exploreAt`) is free roam like explore. A client whose first race-phase step comes without a snap (tab asleep) is snapped to its slot at GO. The finish is reported once per round with the interpolated float time; the orb keeps its controls until `roundEnd`.
- **Snap:** each client moves only its own orb, but at the snap the scene also places every remote orb at its slot locally so the stack looks right before their own updates arrive. The camera cuts to the slot instead of panning back.
- **Round end:** controls lock and the local orb is **held where it was** (not just input-locked, so a disintegrated orb doesn't fall); remote bodies stop integrating their last velocity (`body.moves = false`). The winner celebrates (rings and a halo pulse, plus spark fountains unless reduced motion) and every other orb disintegrates (flash, rising shards in its colour, swell and fade). With no winner (timeout or skip) every orb disintegrates. Orbs reform on the next stage. New `render/RoundEndFX.ts`; `PlayerVisuals` gained a presence fade. Particle counts follow the quality level; with `prefers-reduced-motion` the celebration is a single ring and pulse and the shard burst is small.
- **Remote orbs** come from `roomState.players` minus me, hidden and with their body disabled until their first `playerMove` places them, removed on `playerLeft` or when absent from `roomState`. "Joined"/"left" messages show in the HUD after the first roster. `MessageBroker.ts` and `messages.ts` are deleted; moves go out through `conn.sendMove` at 32 TPS (only once `joined` has arrived), actions through `conn.sendAction` (the id is stripped; the server stamps it).
- **V** sends `voteSkip(round)` from `roundStart` until `roundEnd`. The HUD shows `V: vote skip votes/needed` bottom right (`voted` after pressing); before the first `skipVotes` it shows `0/players`.
- **HUD:** `EXPLORE n` top centre during explore, then the existing 3-2-1 and race timer, `FINISH m:ss.mmm` for the own time, and a bottom-left line (`lobby sandbox | free roam`, or `round n | seed | difficulty`). A round skipped before GO drops its countdown; one ended mid-race freezes its clock.
- `RaceDirector.ts` uses relative imports so vitest (which has no path aliases) can load it; `RaceDirector.test.ts` covers explore, snap, countdown hold, finish report once, the late snap, the end hold and the sandbox.
- **Not verified at runtime** yet: no browser or server was run for this slice.

### Slice 2 integration (2026-10-23)
- Built by three agents in parallel against `orb-racer-slice2-contract.md`: kotlin-expert (server), frontend-developer (RoomConnection, clockSync, session, Svelte), phaser4-gamedev (round flow).
- **Verified:**
  - vitest: 204 tests, all passing. `tsc` reports 0 errors. The capped build succeeds.
  - Kotlin: 50 tests, all passing.
  - A two-browser end-to-end run against a real server (port 8081) took two players through the lobby, host Start, an identical seeded stage, explore, countdown and race, then one finish, `roundEnd`, and results on the other client. No page errors.
- **Fixes during integration:**
  - The `RoomFlowTest` relay test raced on a second `roomState`. It now waits for both players.
  - "GO!" froze on screen when a round ended within 700 ms of GO. `Countdown` now hides it once the round has ended.
- **Duplication (open):** `race/session.ts` (Svelte store) and `race/match.ts` (Phaser `MatchTracker`) both fold the same server messages into room state. The Phaser agent wrote its own reducer because `session.ts` had no agreed signature yet. Merge them into one reducer in a later slice.
- **Not verified in a browser:** host migration, a mid-match join being rejected, the skip vote, the timeout, and the match ending and returning to the lobby. These are covered by Kotlin unit and integration tests only.

### Slice 2 review: lobby room and start-bay gates (2026-10-23)
Client only; the wire protocol is unchanged (the bay count comes from `roundStart.startOrder`).
- **Lobby room** (`race/lobbyRoom.ts`): an ASCII map (`#` rock, `.` open, `^` pad, `1`–`8` spawns in join order), 72 × 20 cells = 3600 × 1000 px with a 3500 × 850 interior. It has a 150 px chimney on the left, floating platforms, a pillar hanging from the ceiling, a bounce pad beside a high ledge, and a 100 px chimney on the right. It goes through `mergeCells`/`boundaryEdges` into an ordinary `Stage` with `kind: 'lobby'`, no `finish` (now optional; `generateStage` returns `RaceStage`, which always has one), no bays and an empty spine. It sits directly on the sea surface, sealed. Spawns alternate out from the middle by join order. `stageFor` returns `{ key: 'lobby', kind: 'lobby' }`; `SANDBOX_STAGE` is gone.
- **Bays** (`segments.ts` `planStart(bays)`, `clampBays`): `generateStage(seed, difficulty, bays)` with bays clamped to 1–8 (solo uses 1). Each bay is 4 × 2 cells (200 × 100 px), stacked upward from the start floor with one row of rock between bays (150 px pitch). All bays open right into a shared chamber (cols 4–14, at least 12 rows tall). **Deviation:** the chamber's exit mouth sits level with the middle of the stack, not on its floor (with 1–2 bays it stays on the floor). With the mouth on the floor, the top of 8 bays would be about 1 s of falling further from it than the bottom; centred, the worst case is about 450 px of climbing or falling. `Stage.bays[i] = { spawn, gate }`, `startSlots[i]` is bay i's spawn, and the gate is a 16 px barrier just inside the opening. 3+ bays change the whole stage, because the mouth moves.
- **Reach:** `ReachTargets.starts` has one cell per bay and `startToFinish` requires every bay (`stuckStarts` lists the failures). The sweep cycles the bay count by seed (`1 + seed % 8`, so ~62 seeds per count per difficulty) and adds checks for bay layout (closed box, gate across open cells, opening clear) and coverage of 1–8. `generateStage.test.ts` runs every count 1–8 on 25 seeds × difficulties 1/4/7/10. Mutation-checked: a rock column between bays and chamber fails both the layout and the reach check. **Hash snapshots updated on purpose** (start room, `kind`/`bays` fields; seeds now `(1,1,1)`, `(42,4,2)`, `(9001,10,8)`).
- **Gates:** `gateOpen(phase)` in `round.ts` is open in `explore` and `race`, shut in `waiting`, `snap` and `countdown` (tested: shut exactly when controls lock once explore has begun; solo countdown). `RaceDirector.gatesOpen` keeps its last value once a round ends, so a skipped round doesn't slam the gates. `StageWorld` adds the gates as a static group whose collider is active only while shut (contact recharges like any wall). `render/GateRenderer.ts` draws a hot orange-red barrier (`STAGE_PALETTE.gate`) between emitter caps: it shoots from both caps to the middle in 140 ms when shutting and drops back in 220 ms at GO, with a flare and sparks out of the bay. A shut barrier has drifting scan bands. Low quality drops the outer glow and uses fewer sparks; reduced motion swaps the sweep for a 120 ms fade, still bands, no sparks.
- **Round flow:** in a server round the orb is **held in its bay** (locked, gates shut) during the ~500 ms `waiting` before `exploreAt`, starts explore there with the gate open (`onExplore`), and is held there again from the snap. Remote orbs are placed in their bays at `roundStart`, at explore and at the snap, and **pinned to them every step while everyone is held** (`RaceDirector.heldInBays`), so a stale in-flight update can't pull them out.
- **Fixes found while verifying** (all client-side):
  - `RaceDirector.place` moved only the body outside a physics step, which Arcade's per-frame `preUpdate` overwrites from the sprite. That is why orbs "stayed where they were in the lobby", and why lobby spawns never applied. Placement is now re-applied on the next step.
  - Remote orbs no longer take gravity. They never collide with the stage, so they sank into the sea whenever their owner stopped sending (resting, or held in a bay). They now coast on the sent velocity, slowed by drag.
  - Moves are only sent on change, so a newcomer never saw a player sitting still. `syncRemotes` now forces a resend when someone joins, and `MainScene` buffers `playerMove`s from construction until `create` (the old "losing a few is harmless" assumption was wrong for still players).
  - `MainScene`'s destroy handler threw (`this.physics.world` is null when the whole game is destroyed, i.e. every room exit), skipping the rest of its cleanup. It is now guarded.
- **Verified:**
  - vitest 237 tests passing; `tsc` reports 0 errors; the capped build succeeds.
  - Two-player headless run on port 8081: 19/19 checks. Lobby room on both clients, spawns 0/1, each sees the other resting. Same stage with 2 bays; each orb starts explore in its own bay (`startOrder` index) with the gate open, and A sees B in B's bay. An orb fired at a shut gate stops at its face (right edge 174 against the gate at 184). Countdown: gates shut on both, collider live, both held in their bays, and A sees B there. GO: gates open, orb leaves. Finish → `roundEnd`. No page errors.
  - Solo (no connection; started in-page with the same config as `startGame()`, since no UI path starts solo since slice 2) with a driven clock: one bay, shut through the 3-2-1, the open animation level falls 0.70 → 0.47 → 0.09 → 0 over 4 frames, the orb leaves, and R gives a new seed with one shut bay and the URL rewritten. Normal and reduced motion both pass.
- **Not verified:** 3–8 players in a browser (bays 3–8 are covered only by the generator tests); low quality visually; how the gate feels on real hardware at speed (headless ran at about 5 fps); host migration, mid-match join and the other slice 2 gaps.

### Return to lobby: Phaser side (contract §5, 2026-10-23)
- **`race/match.ts`:** `MatchView.returned` is the latest `lobbyReturn.returned`, or null outside the match-over wait. It is cleared on `roomState` lobby and on `roundStart`, and a player who leaves is dropped from it. A `lobbyReturn` that arrives after the phase is already lobby is ignored. `lobbyReturn` joins `MATCH_EVENTS` (the tracker now has 7 subscriptions). Derived helpers:
  - `iReturned` (the same rule as `session.ts` `meReturned`: phase lobby, or me in `returned`)
  - `returnedRemoteIds`
  - `hiddenRemoteIds`: during the wait, once I have returned, everyone who has not; while I am on the match-end view, everyone who has. Empty outside the wait.
- **`stageFor`** returns the lobby room once `iReturned`, even while the phase is still match. `MainScene.sync` therefore rebuilds the lobby room and starts free roam at my join-order spawn: no timer or countdown, controls unlocked. The match-end effects (end hold, freeze, celebrate/disintegrate) now run only while the race stage is shown, so they don't replay after the rebuild. The HUD's bottom line shows the lobby once the lobby room is up.
- **Visibility:** `PlayerManager.setHiddenRemotes` hides a remote orb (unplaced, so it is out of bumps and end effects) and ignores its moves. `MainScene` also drops its relayed actions. A player who stops being hidden reappears at their next move, and revealing anyone forces a re-send of my own position (`resendPosition`, the same mechanism as when someone joins), so each side sees the other even when standing still. When the phase becomes lobby the hidden set empties, every client reveals everyone, and so everyone re-sends.
- **Choice:** before anyone returns (`returned: []`) nobody is hidden, since everyone is still on the match-end view.
- **Verified:** vitest (match 25 tests, full suite 249) and `tsc`. **Not run in a browser.** The build and the two-player run are left to integration.

### Return to lobby: integration (2026-10-23)
- **Built** by all three agents against contract §5. The Kotlin and Phaser agents were interrupted partway through and resumed from their partial edits on disk.
- **Verified:**
  - vitest: 249 tests, all passing. `tsc` reports 0 errors. The capped build succeeds.
  - Kotlin: 59 tests, all passing.
  - A two-player headless run (first to 1 win) passed 12/12 checks:
    - B sees the match results with a 30 s countdown.
    - After A presses Return, A is in the lobby room while the phase is still match, with "Waiting for 1 player…" showing and B hidden. B stays on the match-end view.
    - After B presses Return, both are in the lobby phase and room and see each other.
    - Start is enabled again and wins are reset. No page errors.
- **Not verified in a browser:** auto-return at the 30 s mark (covered by Kotlin tests only), and a leave completing the wait.
