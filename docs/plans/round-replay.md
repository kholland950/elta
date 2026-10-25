# Round replay: path overview and winner victory lap

## Context
Today a round ends like this: the winner gets a celebration burst, everyone else disintegrates, and a 5 s results countdown follows ([RoundEndFX.ts](frontend/src/game/render/RoundEndFX.ts), `Timings.resultsMs` in [Timings.kt](src/race/Timings.kt)). Players never see *how* the round was won.

The new sequence:
1. Losers disintegrate.
2. The camera zooms out to the whole stage while every player's route draws on as a thin glowing line.
3. The camera zooms in and follows the winner, who has a short free victory lap.
4. The results panel shows, then the next round starts.

The first build step copies this plan to `docs/plans/round-replay.md`, following the repo's convention.

**Status:** Gates 1–2 approved. Building.

## Settled decisions (Gate 1)
- **Tools:** the `game-design`, `camera-control` and `game-feel` skills for design. The `phaser4-gamedev` agent builds the Phaser camera and rendering work.
- **Audience:** every client plays one shared sequence, driven by the server clock. Only the winner has control, and only during the lap.
- **Finish round:** disintegrate/celebrate (existing), then a pause, then zoom out to fit the **whole stage**, then the trail replay draws on while the camera holds, then zoom in and follow the winner, then the victory lap, then the results panel, then the next round.
- **Victory lap:** full movement, starting from wherever the winner finished. Nothing counts.
- **Timeout:** disintegrate, then pause, zoom out, replay, then the results panel. No zoom-in and no lap.
- **Skip vote:** no sequence. The results panel shows, then the next round.
- **Last round of a match:** the full sequence plays, then the match-over panel.
- **Path:** runs from race start ("go") to that player's finish, or to round end. The explore phase is excluded.
- **Lines:** a glow pass under a core pass in the orb's colour, with ADD blend so the existing bloom picks them up. All lines draw on together. The winner's line is on top and brighter.
- **Recording, slice 1:** each client records every player's path locally: its own orb from physics, others from incoming `playerMove`.
- **Recording, slice 2 (later):** each client broadcasts its own exact path at round end, replacing the locally recorded copy.
- **Reduced motion:** the sequence is unchanged.
- **Results panel:** hidden during the sequence and shown only after it.
- **Out of scope:** skipping the sequence, replays for players who reconnect, and hazards.

### Fact found during design
- **No hazards or respawns exist yet.** The energy sea only adds drag (`docs/plans/orb-racer.md`: "no pits and no respawns"). "Respawn at finish during the lap" therefore has nothing to trigger it today.
- **What's built:** `RaceDirector` keeps the finish position as `lapSpawn` for that future rule. No respawn code is written now.

## Timeline
All times are in ms after the new `endedAt`, on the server clock.

| Beat | finish | timeout | skipped |
|---|---|---|---|
| disintegrate / celebrate | 0–1200 | 0–1200 | — |
| pause | 1200–1700 | 1200–1700 | — |
| zoomOut | 1700–2500 | 1700–2500 | — |
| replay (paths draw on) | 2500–5000 | 2500–5000 | — |
| zoomIn | 5000–5800 | — | — |
| victoryLap | 5800–9800 | — | — |
| results panel | 9800–12800 | 5000–8000 | 0–3000 |
| **`nextRoundAt − endedAt`** | **12 800** | **8 000** | **3 000** |

- **Last round of a match:** the sequence fits inside the existing `matchOverMs = 30 000`, and the match-over panel shows at 9.8 s.
- **Replay speed:** progress maps linearly onto race time. The whole race plays in 2.5 s, so the winner's line completes first.

## Layers

### Entities and pure use cases (no Phaser, vitest next to source, relative imports)
- **`frontend/src/game/race/replayTimeline.ts`**
  - `BEAT_MS`, `BeatKind`, `Beat {kind, p, leftMs}`.
  - `replayTimeline(reason, endedAt)`, `beatAt(tl, now)`.
  - `resultsShownAt(end, fallbackEndedAt)`, used by Svelte.
  - `ReplayCursor.advance(now)`: returns `{beat, entered[]}`, so a tab that slept through a beat still runs its enter hooks.
- **`frontend/src/game/race/pathRecorder.ts`**
  - `PathSample {t,x,y}`, where `t` is ms since `goAt`.
  - `PathRecorder`: `begin(goAt)`, `record(id, serverNow, x, y)`, `finalize(endedAt, times)`, `replace(id, samples)` (slice 2).
  - **Downsampling:** keep a sample once it is `PATH_MIN_DIST` (24) from the last kept one. After a `PATH_MAX_GAP_MS` (250) gap, keep the last raw sample first, so waits keep their timing.
  - **Cap:** `PATH_CAP` is 1024. At the cap, drop every other sample and double the minimum distance.
  - **`finalize`:** clips finishers at `raceTimeMs` and everyone else at `endedAt − goAt`.
- **`frontend/src/game/fx/replayPath.ts`**
  - `replaySpanMs(paths)`.
  - `headAt(path, raceMs, out)`: binary search plus lerp, writing into a reused output object.
  - `lineStyle(isWinner, zoom)`: widths in screen px divided by zoom. Core is 2.5 px (winner 3.5), glow is 10 px (winner 14).
- **`frontend/src/game/fx/replayCamera.ts`**
  - `Pose {cx,cy,zoom}`.
  - `fitPose(bounds, vw, vh, margin=0.06)`: capped at zoom 1.
  - `posePlan(beat, from, fit, target)`: easeInOutCubic.
  - `parallaxCover(bounds, s, maxView, minZoom)`.
- **[RaceDirector.ts](frontend/src/game/RaceDirector.ts)** (existing pure core)
  - `DirectorMode` gains `'victory'`.
  - `startVictoryLap()`: works only from `ended`. Clears latched presses with `onHold()` and records `lapSpawn`.
  - In `victory`, `step()` does no step counting and no finish detection, and `locked` is false.
  - `endVictoryLap()` returns to `ended` and holds the orb where it is.
  - Also skip `victory` in the [Countdown.ts](frontend/src/game/Countdown.ts) L38 guard. Grep for other exhaustive checks on the mode.

### Interface adapters (Phaser, `frontend/src/game/render/`)
- **`ReplaySequence.ts`** is the orchestrator. It takes small ports: camera, paths, background, stage culling, players, director. It exposes `start(end, stage, paths, localId)`, `update(serverNow)` and an idempotent `cancel()`. Enter hooks:

  | Beat entered | What happens |
  |---|---|
  | zoomOut | camera `begin`; culling off; background overview fade |
  | replay | `setPaths` |
  | zoomIn | lines fade to 40% |
  | victoryLap | follow the winner; unfreeze the remote winner, or call `director.startVictoryLap()` if the winner is local |
  | results | `endVictoryLap`, or refreeze the remote winner |

- **`ReplayCamera.ts`**
  - `begin(bounds)`: stops follow and calls `removeBounds()`. Phaser's `clampX` pins the view to the left and top edges once the view is wider than the bounds.
  - `apply(pose)`: called every frame, driven by the timeline rather than tweens, so it stays in sync across clients.
  - `follow(sprite)`: zoom back to 1, restore the bounds, `startFollow`.
  - `reset()`.
- **`PathRenderer.ts`**
  - Two ADD-blend Graphics per player (glow, core). Depth sits above the stage and below the orbs; all glows go under all cores, with the winner's pair highest.
  - Each frame it appends only newly completed segments. One shared `heads` Graphics redraws the partial last segment and the head dots.
  - The winner's colour is `lighten()` of its orb colour (from [fx/color.ts](frontend/src/game/fx/color.ts)). Losers are at alpha 0.65.
- **[PlayerManager.ts](frontend/src/game/PlayerManager.ts)**
  - `freezeRemote(id, frozen)`, with `freezeRemotes` reusing it.
  - `followLocal()` takes over the follow-lerp constants from L145.
  - `setBumpsEnabled(on)` is off from round end until the next round, so the lapping winner doesn't bump frozen losers.
- **[StageRenderer.ts](frontend/src/game/render/StageRenderer.ts):** `setCulling(enabled)`. Culling runs on `PRE_RENDER`, before `worldView` updates, so it lags a frame while zoom is changing.
- **BackgroundRenderer**
  - Size the star tileSprites with `parallaxCover(...)` at the stage's fit zoom.
  - `setOverview(t)`: fades the nebula to 0 and the stars to about 0.5, which hides the tile repeat.
- **[MainScene.ts](frontend/src/game/MainScene.ts)**
  - `startRound`: `recorder.begin(goAt)`.
  - `onStep`: record the local orb.
  - The `playerMove` handler (~L216): record the remote orb.
  - The end block (~L284): if the reason is not `skipped`, call `replay.start(...)` and turn bumps off.
  - The new-stage block (~L270): `replay.cancel()`.
  - `update()`: `replay.update(conn.serverNow())`.
- **[Room.svelte](frontend/src/app/Room.svelte) ~L111:** gate `RoundResults` with `now >= resultsShownAt(...)`, using a 250 ms ticker. This is the same pure function Phaser reads, so no event bus is needed.
- **[race/protocol.ts](frontend/src/game/race/protocol.ts):** `RoundEndMessage.endedAt?: number`. If it is missing, fall back to the time the message arrived.

### Server (Kotlin)
- **[Timings.kt](src/race/Timings.kt)**
  - Add `replayFinishMs = 9_800` and `replayTimeoutMs = 5_000`. `resultsMs` becomes 3_000.
  - Add `resultsWaitMs(reason)`.
  - Add `init { require(matchOverMs >= replayFinishMs) }`.
- **[Room.kt](src/race/Room.kt)**
  - `finishRound` (~L205) uses `resultsWaitMs(reason)`.
  - `RoundEnded` and `RoundEndDto` ([Protocol.kt](src/ws/Protocol.kt)) gain `endedAt`. Older clients ignore it, and reconnect snapshots carry it automatically.
- **`docs/plans/orb-racer-slice2-contract.md`:** document `endedAt` and the per-reason `nextRoundAt`.

## Dependency diagram
```
Room.svelte ─────────────┐
MainScene (composition) ─┼─► render/ReplaySequence ─► render/{ReplayCamera,PathRenderer}, PlayerManager, StageRenderer, BackgroundRenderer
                         │            │
                         ▼            ▼
              race/replayTimeline  race/pathRecorder  fx/replayPath  fx/replayCamera  RaceDirector   (pure, no Phaser)
                         ▲
              race/protocol.ts (DTO types only)
Server: ws/Protocol (DTO) ─► race/Room ─► race/Timings     (pure core, unchanged direction)
```
Pure cores import nothing from `render/` or Phaser. Only DTOs (`RoundEndMessage`, `PathSample[]`, `Rect`, `Pose`) cross the boundaries.

## Build order (thin vertical slices)
1. ✅ **Server timings and `endedAt`, with Kotlin tests.** Ships alone: the panel just waits longer.
2. ✅ **`replayTimeline` with tests, plus the Svelte results gating.**
3. ✅ **Overview camera:** `replayCamera` with tests, `ReplayCamera`, `ReplaySequence` driving zoomOut and zoomIn, and the bounds, culling and background fixes (phaser4-gamedev).
4. ✅ **Paths:** `pathRecorder` and `replayPath` with tests, `PathRenderer`, and recording in `MainScene` (phaser4-gamedev).
5. ✅ **Victory lap:** director victory mode with tests, `freezeRemote`, bump gating, and following a remote winner.
6. **Perf and feel pass:** 8 players, Low and High quality, a 120 s timeout round, frame time during the replay. Tune `BEAT_MS` with the game-feel and camera-control skills.
7. **(Later) Slice 2, path broadcast:**
   - Add a `roundPath {round, points:[t,x,y,…] ≤1800 ints}` client message in `decodeClient`. It is validated: only accepted during `Results`/`MatchOver` for the round that just ended, and size-checked.
   - The server relays it with `playerId`.
   - Mirror it in `protocol.ts` and the contract doc.
   - Receivers call `recorder.replace` if it arrives before the replay beat.

Following the WSL memory note, run the Gradle and frontend builds and tests as separate steps.

## Test strategy
- **Kotlin, `test/race/RoomTest.kt`:** update the `nextRoundAt` expectations per reason (≈L233, L267, L307) and assert `endedAt`.
- **Kotlin, `test/ws/RoomFlowTest.kt`:** short timings set `replayFinishMs = 0, replayTimeoutMs = 0`.
- **`replayTimeline.test.ts`:** every beat edge ±1 per reason; the cursor's `entered` list when beats are skipped; a drift guard on the sums (9 800 and 5 000), matched by the Kotlin assertion.
- **`pathRecorder.test.ts`:** samples before GO are ignored; downsampling; the gap anchor; decimation at the cap; `finalize` clipping.
- **`replayPath.test.ts`:** `headAt` at the ends and in between, and it is monotonic; widths scale with 1/zoom.
- **`replayCamera.test.ts`:** fit maths for wide and tall stages; the zoom-1 cap; the pose is continuous across beats.
- **`RaceDirector.test.ts`:** victory is unlocked; no `onFinish` during the lap; `startVictoryLap` is ignored unless the mode is `ended`; `endVictoryLap` holds the orb.
- **Adapters:** checked by hand in two browser tabs with the `run` skill, using `?debugGame`. Win one tab, let the other lose, and check sync, framing, glow, lap control, and that the panel appears at 9.8 s. Repeat for a timeout and a skip vote.

## Open risks
- **Remote samples are stamped on arrival**, which shifts lines slightly (≈ latency/span). Negligible.
- **A remote orb whose tab was hidden** leaves straight-line jumps in its path. Slice 2 fixes this.
- **Graphics cost** with 8×1024 samples. Mitigated by appending only new segments.
- **Star tile repetition at very low zoom.** Mitigated by the overview fade.
- **Orbs are tiny at whole-stage zoom.** Accepted, because the lines carry the overview.
- **Hazards and the lap-respawn rule** are deferred until hazards exist.

## Build notes
- **Slice 1:** `Timings.resultsWaitMs(reason)`; `RoundEnded`/`RoundEndDto` carry `endedAt`. Kotlin tests pass.
- **Slice 2:** [replayTimeline.ts](../../frontend/src/game/race/replayTimeline.ts) exports `BEAT_MS`, `replayTimeline`, `beatAt`, `replayMs`, `resultsShownAt` and `ReplayCursor`. [Room.svelte](../../frontend/src/app/Room.svelte) gates `RoundResults` with `replayDone`, falling back to the arrival time when `endedAt` is missing.
- **Slice 3 (overview camera):**
  - [fx/replayCamera.ts](../../frontend/src/game/fx/replayCamera.ts): `fitPose`, `posePlan`, `parallaxCover` as planned, plus `lerpPose` (centre linear, zoom **geometric**, so a ~14× zoom-out doesn't rush its last half; camera-control: zoom is the most disorienting motion) and `clampCenter`, which mirrors Phaser's `clampX/Y`. The zoom-in aims at the winner's *clamped* zoom-1 centre, so restoring the bounds when the follow takes over moves nothing.
  - [render/ReplayCamera.ts](../../frontend/src/game/render/ReplayCamera.ts): `begin()` takes no bounds (deviation): it stores the camera's own bounds before `removeBounds()` and restores them in `follow`/`reset`. The stage rect for the fit goes to `ReplaySequence.start` instead.
  - [render/ReplaySequence.ts](../../frontend/src/game/render/ReplaySequence.ts) has no Phaser dependency, so it uses relative imports and has its own test (deviation: an addition). It drives the camera from `posePlan(beatAt(...))` every frame. The background fade, the line fade under the lap and the draw-on progress are also per-frame functions of `beat.p` rather than one-off enter-hook steps, so a late tab lands on the right values. The background and culling ports are merged into one `stage` port because both are rebuilt with every stage.
  - `StageRenderer.setCulling`, `PlayerManager.followLocal()` (with an exported `FOLLOW_LERP`, also used by `ReplayCamera.follow`), `BackgroundRenderer.setOverview(t)` (stars to 0.5, nebula to 0).
  - The star tileSprites are sized with `parallaxCover(bounds, s, max(4096, window), fitZoom)` and re-sized on resize, since the fit zoom depends on the window; `tilePosition` compensates so the stars don't shift. At a whole-stage zoom of ~0.07 a layer is ~60 000 px wide; a TileSprite is one quad, so this costs no fill rate, but check it in slice 6.
- **Slice 4 (paths):**
  - [race/pathRecorder.ts](../../frontend/src/game/race/pathRecorder.ts) as planned. The gap anchor keeps the previous raw sample either when the gap *between moves* exceeds 250 ms (a remote orb sitting still sends nothing) or, on leaving, when the stay near the last kept sample lasted over 250 ms. A stationary orb therefore adds no samples. `finalize` flushes the last unkept raw sample and cuts the crossing segment exactly at the clip.
  - [fx/replayPath.ts](../../frontend/src/game/fx/replayPath.ts): `headAt` returns `{x, y, index}`; `index` drives the incremental append.
  - [render/PathRenderer.ts](../../frontend/src/game/render/PathRenderer.ts): a glow and a core Graphics per player (ADD, depth −0.9…−0.4, winner's pair on top), one shared `heads` layer for the partial segment and head dot. Winner: core `lighten(tint, 0.45)` at alpha 1, glow 0.32; others: tint at 0.65, glow 0.22. **Addition:** widths are screen px ÷ zoom, so when the zoom changes by more than 1.2× (only during the zoom-in, ~12 times) the lines are redrawn in full at the new width. Otherwise lines drawn at the overview zoom would be ~35 px (core) and ~140 px (glow) wide by the lap.
  - MainScene records only with a connection (solo has no replay): the local orb from `body.center` on every physics step, remote orbs on `playerMove` (not while hidden). `startRound` begins the recorder at `goAt`; the end block finalizes at `endedAt ?? serverNow()` with `ended.times`.
- **Slice 5 (victory lap):**
  - `RaceDirector`: `'victory'` mode, `startVictoryLap()`/`endVictoryLap()` as planned; `locked` is false in it, and `step()` returns before counting steps or detecting the finish. `lapSpawn` is readable as `victorySpawn` (nothing uses it until hazards exist). Countdown's GO guard skips `victory`; no other exhaustive mode checks exist (grepped `DirectorMode`, `.mode ===/!==`, `currentMode`).
  - `PlayerManager.freezeRemote(id, frozen)` (`freezeRemotes` reuses it), `spriteFor(id)` (addition, for the camera target), `setBumpsEnabled`. Bumps go off at **every** round end, skipped included (harmless, since nobody moves after a skip), and back on with the next stage.
  - A remote winner's orb already follows its moves while frozen (`playerMoved` sets the position); unfreezing adds dead reckoning between moves.
  - If the winner has left by the lap, the camera stays on the whole stage, like a timeout. `cancel()` is idempotent and runs on every stage change before the stage is rebuilt. It ends a running lap, clears the lines, resets the background and culling, and returns the camera to the local orb.
  - **Not verified at runtime:** everything Phaser-side (framing, glow look, bloom pickup, lap control, two-tab sync, tileSprite coverage at the fit zoom, frame time). The pure cores and ReplaySequence are unit-tested; `tsc --noEmit` is clean.
  - **For slice 6:** `ReplayCursor.advance`/`beatAt` allocate a small object and array per frame (slice 2 API, left as is). BEAT_MS is unchanged. 800 ms for a 10–15× zoom-out may feel quick even with geometric zoom; try 1000–1200 ms (taken from `pause` or `replay`) in the feel pass.

## Feedback round 1
The user played it and said: "The zoom is so far away it's hard to tell what's going on. The trail rendering is weird. Use a thin bright line with bloom. Follow all of the players with a dynamic follow cam that fits all players to the screen. The paths should replay at 2x speed; it plays way too fast at the moment."

Settled with the user: the replay always runs at 2× with no cap (skipping comes later), and the zoom floor is 0.5×. Below 0.5× the camera never zooms further out, even if a far player goes off screen. This replaces the whole-stage overview and the 2.5 s replay beat from the timeline table and slices 3–4 above.

- **Timing (server already changed):**
  - `roundEnd` carries `replayMs`, the trail-replay beat, equal to `(endedAt − goAt) / 2` (0 when skipped). The fixed beats are 7 300 ms for a finish and 2 500 ms for a timeout, then 3 000 ms of results.
  - Client:
    - `RoundEndMessage.replayMs?` is added.
    - `replayTimeline(reason, endedAt, replayMs?)` sizes the replay beat from the message. `BEAT_MS.replay` is now only the fallback for older servers.
    - `replayMs(reason, replayBeatMs?)` and `resultsShownAt` (still what Room.svelte uses) include it.
    - New: `fixedReplayMs(reason)`, the drift guard against Timings.kt, and `REPLAY_SPEED = 2`.
  - Replay progress is `min(span, p × replayMs × 2)`, which is real race time at 2×, clamped at the last path end. Older servers still get `p × span`.
- **Camera: a group follow cam instead of the whole-stage overview.**
  - `fitBox` frames the trail heads' bounding box with 140 screen px of padding a side, zoom clamped to [0.5, 1], centred on the box. Every player with a path counts, and finished heads stay parked at their end.
  - `zoomOut` eases from the local follow pose to the fit of the heads at race time 0.
  - Through `replay`, `dampPose` eases toward the fit every frame:
    - The damping is exponential and frame-rate independent, tuned in halflife (camera-control skill).
    - The centre has a 150 ms halflife, kept tight because the heads move at 2×.
    - The zoom is damped in log space with a 400 ms halflife, since zoom changes are the most disorienting motion.
    - Both are starting values for the feel pass. The frame step is clamped to 100 ms.
  - `zoomIn` eases geometrically, from where the follow cam was when the beat began to the winner's clamped zoom-1 centre, as before.
  - On a timeout, or when the winner has left, the follow cam keeps framing the parked heads until results and the next round.
  - Only the smoothing depends on frame timing. Beats and replay progress are still pure functions of the server clock.
  - `fitPose` is removed.
- **Removed, no longer earning their place at a 0.5 floor:**
  - **Culling toggle (`StageRenderer.setCulling`):** CULL_MARGIN is 300 world px. That covers the one-frame `worldView` lag at the eased pan and zoom speeds, roughly 100–200 px per frame at the zoom-out's peak for a pan of a few thousand px.
  - **`BackgroundRenderer.setOverview` (star dim and nebula fade):** a 512 px star tile at 0.5× is a 256 px repeat, not visibly tiled. The nebula's blobs are soft, so past them is plain black, as it already is on a wide window at zoom 1.
  - **The resize-dependent star sizing.** The star tileSprites are now sized once with `parallaxCover(bounds, s, 4096, REPLAY_MIN_ZOOM)`. That covers any camera centred inside the stage, which the follow cam always is, because the head box is inside the stage.
  - The ReplaySequence `stage` port is gone with them.
- **Lines:**
  - One thin stroke per player, ADD-blended, with no glow pass; the camera bloom makes the glow.
  - Colour is `lighten(tint, 0.35)` at alpha 0.9, and the winner's is `lighten(tint, 0.6)` at alpha 1 on the top depth. Checked per channel against the bloom threshold (0.55 per channel in Phaser's threshold filter): every orb colour keeps at least one channel above it, around 0.67–0.9 after alpha, so each glows in its own hue.
  - Width is 2.25 screen px (winner 3) ÷ zoom, via `lineWidth` (replaces `lineStyle`).
  - Redraws on a zoom change of more than 1.1×, at most about 7 steps across 0.5–1.
  - Head dots (`lighten(tint, 0.75)`, radius 1.8 × width) show on every head while any line is still drawing, and clear once all are complete.
  - On Low quality there is no bloom, so the lines are just thin and bright.
- **ReplaySequence** also drops the paths of players who have left (no tint) before the replay, so neither the lines nor the follow cam use them.
- **Not verified at runtime:**
  - How the follow cam feels: lag behind fast heads at a 150 ms halflife, and whether the zoom "breathes".
  - Bloom strength on the lines, and how visible a line-width step is at each redraw.
  - Two-tab sync of the 2× replay.


### Feedback round 2 — leader off screen
- **What happened:** playtest showed the front player off the right edge. When the field is wider than the view at the 0.5× floor, `fitBox` centred on the middle of the field, so both ends fell off, the leader included.
- **Fix:** `keepInView` (fx/replayCamera.ts) slides the frame the least distance needed to keep the **leader** inside the padded view. It runs on the goal pose and again after damping, so lag can't drop the leader either. Stragglers are the ones that go off screen.
- **Who the leader is:** the winner. On a timeout, it's the route that ends nearest the finish (MainScene passes the finish centre to `ReplaySequence.start`).
