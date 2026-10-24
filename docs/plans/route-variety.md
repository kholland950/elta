# Orb racer: route variety and stage archetypes

## Context
Players say the levels are too similar. Counting what every stage shares (the saturation ledger from the `generated-content-quality` skill) shows why:
- Every stage is a single tunnel of about 20 segments.
- **Every segment enters on the left and exits on the right.** This is structural: `CellPort` is always a right-facing mouth, and overlap is avoided only because segments never share columns.
- About half the segments are flat runs, and only 4 types exist.
- Vertical travel happens only *inside* a segment, so the route never turns. There are no branches and no backtracking.
- Seeds vary only surface parameters.

The user wants routes that go "up, then left, then back right", and stages that differ from one another as a whole.

**Outcome:** turning routes that still make net progress rightward, five stage archetypes with built-in guarantees, branching forks, countable ceilings on repetition, and a dev gallery for judging the variety by eye.

## Settled decisions (grill, 2026-10-23)
- **Routing:** segments may exit up, down, left or right. The start stays on the left and the finish on the right, and overall progress is rightward.
- **Archetypes**, picked by the server so a match never repeats one in consecutive rounds. Players are **not** shown the archetype.

| Archetype | Shape | Guarantee |
|---|---|---|
| **Tower** | Mostly up | ≥2 switchbacks (up-left-up-right) |
| **Descent** | Starts high, mostly drops | **At most 2 climbs** (segments rising ≥3 rows); total drop ≥ 2× total climb |
| **Labyrinth** | Tight tunnels, many turns | ≥1 double-back, meaning a leftward segment that crosses columns the route already used |
| **Speedway** | Long runs, gentle height | No leftward travel; **fully exempt** from the run ceilings and the streak ceiling |
| **Canyon** | Big chambers | ≥2 chambers and ≥2 stall chambers |

- **Ceilings**, checked by the sweep:
  - runs are at most 40% of segments
  - at most 2 runs in a row
  - no segment type more than 2 times in a row
  - Speedway is exempt from all three
  - there are no other minimums
- **Forks:** two tunnels that rejoin. The high branch is shorter and technical (a squeeze, a wall-bounce step, a slot wall). The low branch is longer and easy. Counts: Labyrinth 2; Tower, Descent and Canyon 1; Speedway 0–1.
- **Out of scope:** boost pads, movers and hazards (slice 3), and a separate variety-ledger report test.
- **Unchanged:**
  - par 50–65 s
  - tunnels 150–400 px tall
  - the sea, with no softlocks
  - the start bays, the finish room and the lobby room
  - determinism rules: one PRNG stream; only + − × ÷ followed by round or |0; integer pixels

## Design

### Route model (`race/segments.ts`, `race/generateStage.ts`)
- **Ports gain a direction.**
  ```ts
  type Dir = 'E'|'W'|'N'|'S'
  type CellPort =
    | {dir:'E'|'W'; x; top; bottom}
    | {dir:'N'|'S'; y; left; right}
  ```
  A single helper, `portCells(port, 'in'|'out')`, owns all side-specific logic. `Port` in `stage.ts` gains the same `dir` field.
- **Generation state** in `generateStage` (a "turtle" walking the route): the current exit port, the furthest column reached (`frontier`), a count of consecutive leftward segments (`westStreak`), every carved rectangle placed so far tagged with its segment, and run and type counters.
- **Occupancy check (rectangle-based).** A new segment's carved areas must be at least `SEP=2` cells away from every earlier carve. The one exception is where it joins its predecessor. Carves must also stay inside the archetype's altitude band and to the right of the start room.
- **Net rightward progress, by construction:**
  - leftward travel only while `westStreak < profile.maxWest`
  - every carve at or right of `frontier − BACKTRACK_COLS` (60 cells)
  - generation stops only when par ≥ 55 s, the agenda is empty and the route is heading right
  - `planFinish` adds an approach tunnel, so the finish room sits strictly right of every other carve
- **Dead ends:**
  - reroll the segment
  - then try the other eligible types; this replaces "fall back to a run", which would break the run ceiling
  - then pop the last segment and ban that choice (up to 12 times)
  - then restart from the start room on the same random stream (up to 3 times)
  - `generateStagePlan()` returns these counts so the tests can watch them

### Segment catalogue
- **Mirroring:** templates are written facing right. Leftward versions are an integer mirror about the entry line. Upward and downward entries are written separately.

| Type | Entry → exit | Notes |
|---|---|---|
| `run` | right/left → same | A leftward run needs no new type. Archetypes can bias the steps to up-only or down-only. |
| `shaftUp` | right/left → same, or up | Can exit out the top of the shaft. |
| `shaftDown` | right/left → same, or down | Can exit out the bottom of the shaft. |
| `stallChamber` | right/left → same | Can be mirrored. Its pit becomes a carve (see Grid). |
| **`switchback`** (new) | right/left → reversed | Lead-in, then a shaft at the far end, then a return tunnel above or below the lead-in, with ≥2 rows of rock between them. |
| **`chimney`** (new) | up/down → right/left | The corner piece: a vertical shaft that turns into a horizontal tunnel. |
| **`chamber`** (new) | any → right/left | Canyon's big room: 10–18 × 9–14 cells, 1–2 bounce pads, optional ledge island and pit. Exempt from the tunnel height limit. `exitRiseMax` caps how high its exit can be (0 for Descent). |
| **`fork`** (new) | right/left → same | See Forks below. |

- Par is `par(|across|, up)`. `Knobs.weights` covers all 8 types, and archetypes scale them by integer percentages.

### Archetypes (new `race/archetype.ts`, pure)
- **Exports:** the `Archetype` union, `ARCHETYPES`, `archetypeForSeed`, `parseArchetype`, and `PROFILES`.
- **Each profile sets:** `ceilingRow`, `startFloor`, `weightPct`, `adjustKnobs` (clamped to the 150–400 px tunnel limits), `stepBias`, `maxWest`, `runCaps`, `forkCount`, and `agenda(rng)`.
- **The agenda** is a list of beats placed at fixed fractions of par (all at ≤700‰), so each guarantee is **built**, not just checked afterwards.

| Archetype | Agenda beats |
|---|---|
| Tower | 2× `switchbackPair` |
| Descent | up to 2 `climb` beats; the profile weights steer the drop |
| Labyrinth | 1× `doubleBack` (switchback, long leftward run, switchback), plus 2 `fork` beats |
| Speedway | none; no leftward exits |
| Canyon | 2× `chamber` + 2× `stallChamber` |

- **Picking the next segment between beats:** a weighted choice over the *eligible* types only. A type is eligible when all of these hold:
  - its archetype weight is above 0
  - it accepts the current entry direction
  - there is room in the altitude band
  - the run ceiling holds for every prefix: `(runs+1)·5 ≤ (n+1)·2`
  - it wouldn't make a third of the same type in a row
  - the leftward budget allows it

  Speedway skips the run and streak rules.

### Forks
- **Shape:** a split junction, then a low branch (taller tunnel with a dip, longer path) and a high branch above it with 2–3 rows of rock between (the "island"). The high branch has 2 of 3 features (squeeze, wall-bounce step, slot wall) and optionally a drop hole down into the low branch. They meet again at a merge junction.
- **Checks:** plans carry `branches {high, low}`. `planPassable` checks the whole fork, and each branch on its own with the other branch set to rock.
- **Par and spine** follow the low branch, using short spine legs so the ±4-leg progress search keeps tracking a player on the high branch.

### Grid, reach, finish
- **`buildGrid` fill rule is unchanged:** stacked tunnels already get rock between them.
- **Pits become carves** that reach the sea, so `pitCols` and the `isPit` branch go.
- **Curtains** go where ownership of a column's lowest carve changes. On a right-only stage that gives exactly today's curtain columns, which works as a regression check.
- **`planPassable`** handles any port direction using a padded mini-grid and `portCells`.
- **`reach.ts`** gains `solidify(grid, rects)` for the per-branch checks, and `reachTargets` covers only the finish room.
- **`FinishGate.right`:** `round.ts` `inGate` and `finishCrossing` require `x ≤ right`, so only actually entering the finish room counts.

### Server and protocol
- **Kotlin, new `src/race/Archetype.kt`:**
  - an `Archetype` enum (wire strings in lower case)
  - an `ArchetypeBag` shuffle-bag: refill with all 5 in random order, and if the first matches the previous archetype, swap it out
- **`Room`** keeps the bag across matches.
- **`RoundPlan.archetype`** is drawn *after* the seed and start order, so existing seeded tests keep their values.
- **Wire:** `RoundStartDto` and the TS `RoundStartMessage` gain `archetype`, recorded as contract §6.
- **`match.ts`** `stageFor` passes it through, falling back to `archetypeForSeed`.
- **`MainScene`** calls `generateStage(seed, diff, bays, archetype)`.
- **Solo** uses `?arch=` if given, otherwise the seed's archetype.
- **Nothing in the HUD or Svelte shows the archetype.**

### Gallery (dev only)
- **Entry point:** `main.ts` mounts `app/Gallery.svelte` when `?gallery` is set and `__BUILD_ID__ === 'dev'`, so production builds drop it.
- **Drawing:** a new pure `fx/stageThumb.ts` rasterises `stage.grid` to RGBA:
  - rock, open space, pads and the sea
  - the route line (spine) and the finish
  - fork branches in two colours, with leftward segments tinted

  The Svelte page puts that onto a canvas, with no Phaser involved.
- **Layout:** 12 stages, with archetypes cycling `i % 5` and seeds `base + i`. Params are `?gallery=<base>&diff=&bays=`.
- **Card label:** archetype, seed, difficulty, par, segment count, run %, number of leftward segments, number of forks, and whether the guarantees pass.
- **Shared checks:** the guarantee predicates live in a new pure `race/stageChecks.ts`, shared by the gallery and the sweep.

## Build order and owners
- **0. Contract §6** in `docs/plans/orb-racer-slice2-contract.md`:
  - `roundStart.archetype` and its 5 strings
  - the `archetype.ts` exports
  - `generateStage(seed, difficulty, bays, archetype)`, `stage.archetype`, port `dir`, `Segment.fork?`
  - `FinishGate.right`
  - the `stageThumb` signature
  - the `stageChecks` names
- [x] **1. Parallel work:** (phaser part done; see notes)
  - **kotlin-expert:** enum, bag, DTO and tests.
  - **frontend-developer:** the protocol field, plus `Gallery.svelte` and `stageThumb` against the *current* generator.
  - **phaser4-gamedev:** `archetype.ts` (with stub profiles), and threading the archetype through `generateStage`, `match.ts` and `MainScene`.
  - *Verify:* Kotlin tests, vitest, `tsc`, and the gallery renders.
- [x] **2. phaser, refactor with no behaviour change:**
  - `dir` on ports (right only for now), `portCells`, general `planPassable`
  - pits as carves, curtains by ownership, the occupancy check, `FinishGate.right`
  - *Verify:* the full sweep passes and the **hash snapshots don't change**. Explain any diff.
- [x] **3. phaser:** profiles, eligible-type picking, the fallback chain, backtracking and the ceiling checks. Snapshots are updated on purpose.
- [x] **4. phaser:** turns — mirroring, leftward runs, `switchback`, the agenda engine, the finish approach. Tower and Labyrinth beats.
- [x] **5. phaser:** vertical ports (`shaftUp` up, `shaftDown` down), `chimney`, `chamber`, Descent and Canyon.
- [x] **6. phaser:** forks, with the per-branch sweep check.
- **7. Integration:**
  - capped build, then a two-browser run: same archetype and stage on both clients, no back-to-back repeat over several rounds
  - solo `?arch=`
  - play review with the user, using the gallery and solo play
  - record deviations in `docs/plans/orb-racer.md`
- Build one at a time (WSL, about 6 GB of RAM). Test servers run on port 8081; port 8080 is the user's.

## Verification
- **Sweep** (`race/stageSweep.ts`): `sweepArchetype(seed) = ARCHETYPES[floor(seed/8) % 5]`, so every combination of bay count and archetype is covered. It keeps all existing checks and adds:
  - the ceilings (Speedway exempt)
  - each archetype's guarantee and its fork count
  - net rightward: the finish room `c0` is greater than every other carve's `c1`, the finish region contains only finish-room cells, and the backtrack limit holds
  - no overlap between segments beyond `SEP`
  - each fork branch reachable on its own
  - coverage: more than 100 leftward segments, and up and down ports appear
  - the updated type set
  - restarts equal 0 in at least 99.5% of stages
  - sweep time stays under about 40 s
- **`generateStage.test.ts`:**
  - one hash snapshot per archetype
  - template passability for every port direction
  - a mirrored leftward plan equals the rightward plan reflected
  - each fork branch passable on its own
- **Other tests:**
  - `grid.test`: pit reaches the sea; stacked tunnels get rock between them; curtains on a right-only stage equal today's
  - `round.test`: `right` bounds the finish
  - `progress.test`: stacked switchback and fork spines
  - Kotlin bag tests: no consecutive repeat over 1000 draws, and every window of 5 is a full set
  - `RoomFlowTest`: `archetype` is present in `roundStart`
- **Manual:** look over the `?gallery` page and play several solo `?arch=` stages for each archetype.

## Risks
- **The reach model ignores head bumps.** Stacked switchbacks, drops into chambers from above and fork slot walls are covered by the gallery and solo play, with vote-skip as the backstop.
- **The generator can box itself in.** Backtracking keeps it deterministic; the restart counts make problems visible.
- **Par spread.** Descent descends for free and Tower is heavy on climbing, so watch the 50–65 s window.
- **Taller stages** (Tower and Descent reach about 5000 px) affect render strips, the sea, the background and the camera. Measure with `?perf`.
- **Progress tracking.** The ±4-leg search could latch onto the wrong layer of a stacked route, so keep spine legs short.
- **Snapshot churn.** From slice 3 onward the hash snapshots change on purpose; record why each time.

Status: approved 2026-10-23. Slices are ticked off below; deviations go under "Implementation notes".

## Implementation notes

### Slice 1 (phaser part)
- `generateStage(seed, difficulty, bays, archetype = archetypeForSeed(seed))`: the 4th parameter defaults to the seed's archetype, so callers still on 3 arguments (the gallery's `stageThumb.test`) keep compiling. `RaceStage.archetype` is set; geometry ignores it.
- `match.ts`: `StageChoice` (race) carries `archetype` from `roundArchetype(round)` = `parseArchetype(round.archetype) ?? archetypeForSeed(round.seed)`. The read is defensive (a stale server or bad value falls back to the seed). Test added.
- `stageParams.ts`: `StageParams.archetype?` is only set from a legal `?arch=`; `stageArchetype(params)` resolves the fallback. `withStageParams` keeps `?arch=` and sets it when given. `MainScene` solo keeps an asked-for `?arch=` across R.
- **Snapshots:** the full hash changed (`55dd9412 278be7d4 73a6b10c` → `3e5d885d a93d04be e2c504ff`) only because the stage JSON gained `archetype`. A new test hashes the stage with the new contract fields stripped and still gets the old three values, so the geometry is identical.
- Verified: 27 files / 262 tests, `tsc` clean, sweep files ~32 s wall.

### Slice 2
- Ports carry `dir` (`HPort` E/W `{x, top, bottom}`, `VPort` N/S `{y, left, right}`); `portCells(port, 'in'|'out')` in `segments.ts` owns the side logic ('out' = the side the orb leaves, 'in' = the side it arrives in). `planPassable` builds a mini-grid from the plan plus the entry's 'out' cells (padded 1 column, 2 rows of rock) and needs any exit 'out' cell reached; for E ports it is the same grid as before.
- `SegmentPlan.pitCols` became `pits: CellRect[]` (chamber floor down to the sea surface), fed to `buildGrid` as carves; `GridSpec.pitCols`, `curtainCols` and the `isPit` branch are gone. `Carve.owner` tags each carve with its segment and `buildGrid` puts a curtain where the owner of a column's lowest carve changes between two owned columns. New `grid.test.ts`: pit to the sea, rock between stacked tunnels, ownership curtains, and on generated left-to-right stages the curtains are exactly the old entry columns.
- `generateStagePlan(seed, diff, bays, archetype)` returns `{plans, bays, finishCol, parMs, stats}`; `generateStage` builds the grid from it.
- Placement check `fits` (SEP = 2 cells of rock from every earlier opening, pits included, except the two carves meeting at the entry port; band ceiling; right of the start room). **Report-only in slice 2** (`ENFORCE_PLACEMENT = false`, counted in `stats.misfits`), because enforcing it changes stages: on 2000 sweep stages, 27% hold at least one misfit. Per stage: about 521 shaftDown zigzag legs sitting under the predecessor's floor (they touch the open air under the previous tunnel, a small leak), 33 shaftUp zigzag legs too close to the predecessor, and 118 openings above `HIGHEST_ROW` (a run after a high shaft keeps its floor and opens up to 5 rows above the band). Slice 3 enforces the check, which is one of the reasons its snapshots change.
- `FinishGate.right` (finish room's right wall); `round.ts` `inGate` needs `x ≤ right` and `finishCrossing` handles entry from the right; `reachTargets` covers only `[finish.x, finish.right)`. Test added.
- `reach.ts` `solidify` is deferred to slice 6, where it is first used.
- **Snapshots:** the full hash changed again (`3e5d885d a93d04be e2c504ff` → `cb90f6df 68b5d6e5 5d0d968e`) only because ports gained `dir` and the finish gained `right`. The stripped-field hash (now also stripping those) still equals the original `55dd9412 278be7d4 73a6b10c`. Also compared 2000 stages (200 seeds × difficulties 1–10) against the committed generator: grid, solids, edges, spine, par and segments identical.
- Verified: 28 files / 267 tests, `tsc` clean, full suite 25.7 s.

### Slice 3
- `PROFILES` lives in a new `race/profiles.ts` (not `archetype.ts`, which keeps exactly the contract §6 exports). Fields as planned: `ceilingRow`, `startFloor`, `weightPct`, `adjustKnobs` (through `clampKnobs`: tunnels 3–8 rows, i.e. 150–400 px), `stepBias`, `maxWest`, `runCaps` (a boolean: the ceilings are fixed by the user, so only on/off varies), `forkCount(rng)`, `agenda(rng)`. Agendas are empty until slices 4–5. Bands: Tower and Descent −100 (5000 px), Canyon −70, Labyrinth −60, Speedway −45.
- Templates take `ceilingRow` and `stepBias` from the build context. `planRun` returns undefined instead of opening above the band (the old 5-row overshoot).
- Eligible-type picking: weight > 0 (difficulty weight × archetype %, kept at a tenth of a unit), not banned at this position, and unless Speedway (or the relaxed last resort) the prefix run ceiling `(runs+1)·5 ≤ (n+1)·2` and no third of a type in a row. Fallback chain: `MAX_REROLLS` (8) of the picked type, then each other eligible type in weighted order with `OTHER_REROLLS` (4), then pop the last segment and ban its type at its position (`MAX_POPS` 12 per attempt), then restart from the start room on the same stream (`MAX_RESTARTS` 3), then one relaxed attempt with the ceilings off (`stats.relaxed`; it throws if even that fails). A plan is also rejected when it would take the par past 63 s, and the finish must pass the placement check.
- The placement check is **enforced** now.
- `generateStagePlan` returns `stats {rerolls, fallbacks, pops, restarts, relaxed}`; `stageFromPlan(plan, …)` builds the stage, so the sweep generates each stage once.
- `stageChecks.ts`: real `stageStats` and `checkCeilings`; `checkGuarantee` still answers ok until each archetype's slice. `Segment.fork?` added to `stage.ts` (contract §6; undefined so far, so no JSON change).
- Sweep: archetype `ARCHETYPES[floor(seed/8) % 5]`; new checks for ceilings, SEP between non-neighbouring segments, every archetype covered, restarts in ≤ 0.5% of stages, and no relaxed attempt.
- **Snapshots** (changed on purpose): now one per archetype, `tower 2e25fc53, descent cf1a667d, labyrinth 1ceabf6f, speedway e2cb8d6f, canyon 74fda535`. They changed because of the archetype weights, knobs and bands, the enforced placement check (rerolls the zigzag legs and the over-band runs counted in slice 2), the run and streak ceilings, and the new fallback chain (it draws differently from the old fall-back-to-a-run).
- Restart stats (5000 stages, 500 seeds × difficulties 1–10): **0 restarts, 0 relaxed**, 155 pops in total (Tower 98, Labyrinth 36, Canyon 17, Speedway 4, Descent 0). Par 55.7–61.8 s. Mean segments: Tower 19.1, Descent 21.9, Labyrinth 25.4, Speedway 14.7 (86% runs), Canyon 20.3. Run share 28–34% outside Speedway.
- Verified: 29 files / 282 tests, `tsc` clean, sweep 29.5 s, full suite 32 s.

### Slice 4
- **Segments:** `mirrorPlan(plan, axis)` reflects a right-facing plan about the entry line (integer: `c → 2·axis − c`; E↔W; spine and stall slot x mirrored). `planSegment` builds W entries as the E template mirrored, so a leftward run (or shaft, stall chamber) needs no new type. New `switchback` (`REVERSING_TYPES`): lead-in, shaft at its far end, return tunnel stacked above or below with ≥2 rows of rock, exit heading back. Its spine has points every ≤6 cells (short legs). `planFinish(entry, clearCol)` adds the approach tunnel so the finish room starts at `frontier + SEP`, right of every other opening; its par counts the approach and must keep the stage ≤ 65 s.
- **Generator:** the route tracks `frontier`, `westStreak` and agenda progress (from `beat` tags on plans, so popping restores it). Leftward exits need `westStreak + 1 ≤ maxWest` and a frontier at least `WEST_AFTER_COLS` (30) past the start room. Every carve stays right of `frontier − BACKTRACK_COLS` (60). Generation stops only with par ≥ 55 s, the agenda done, heading E, and a finish that fits.
- **Agenda engine:** a beat starts once par ≥ its ‰ of 55 s, heading E, and its whole forced sequence passes the ceilings and the west budget. Its steps are then forced (`BEAT_REROLLS` 16). Tower: 2× `switchbackPair` at 150‰ and 450‰ (up, up). Labyrinth: 1× `doubleBack` at 250–450‰ (switchback, long leftward run with floor steps away from the route below or above, switchback).
- **Found while tuning** (all within the plan's rules, but worth knowing):
  - **Clearance:** a switchback's return layer must clear earlier openings in the columns it will cross. Turning left, the generator measures the highest and lowest openings in `[x−60, x+25]`; turning back right, `[x−30, x+5]`. The template then widens its rock gap to clear them (`upFloorMax` / `downTopMin`). Without this, leftward layers ran into tall stall rooms and shaft lead-ins (about half the beat steps failed).
  - **Turn-back room:** a switchback turning left must leave room for a second layer on the same side (`reserveRows` = tunnelMax + 2).
  - **Headroom:** ordinary segments keep below the band ceiling plus headroom for pending climbing beats (`BEAT_HEADROOM`: pair 30 rows, double-back 24), so Tower doesn't reach its ceiling before the pairs.
  - **Turn only:** heading left, ordinary picks may only turn back. Carrying on left is reserved for beats.
  - **Profile changes from slice 3:** `maxWest` Tower/Descent/Canyon 1, Labyrinth 2. Labyrinth band −80 with `startFloor` −40, so its layers can stack both ways. Labyrinth switchback weight 150%.
  - **Pop budget:** `MAX_POPS` (12) now applies per dead end (it resets when the route passes its deepest point) rather than per attempt. A whole-stage budget let scattered small dead ends add up to restarts (2.4% of Labyrinth stages); depth is bounded by par, so it still ends.
- **Checks:** `checkGuarantee` covers Tower (`switchbackPairs` ≥ 2), Labyrinth (`doubleBacks` ≥ 1: a segment entering and leaving W whose columns overlap a segment at least two before it) and Speedway (0 leftward segments). Sweep adds the guarantees, net rightward (`checkRightward`: finish room's first column right of every other opening, backtrack limit), more than 100 leftward segments, and `switchback` in the type set. Tests: templates passable entering E and W, mirror equals the reflected plan, switchback stacking, and progress tracking along the stacked spines of generated Tower stages.
- **Snapshots** (on purpose): `tower 51f79178, descent d3d25a96, labyrinth 34dbf357, speedway e2cb8d6f (unchanged: no turns), canyon 63b45231`. They changed because of the new type and its weights, mirrored leftward travel, the agendas, and the finish room now starting 12 columns after its approach.
- **Restart stats** (5000 stages): **0 restarts, 0 relaxed**; pops Tower 52, Descent 7, Labyrinth 1129, Canyon 58. Leftward segments per stage: Tower 4.1, Labyrinth 7.1, Canyon 2.2, Descent 0.4, Speedway 0. Par 55.7–64.9 s; Labyrinth comes closest to the 65 s cap (the risk the plan flags).
- Verified: 29 files / 300 tests, `tsc` clean, sweep 24.5 s, full suite 29.7 s.
- The user's hand edit to `lobbyRoom.ts` (two more floor pads) broke the lobby test's pad count. I updated that expectation from 2 to 6 pad cells and left the map untouched.

### Slice 5
- **Vertical ports:** `shaftUp` can leave out its top (N port) and `shaftDown` out its bottom (S port). The chance is per profile (`endPortPct`: Tower 35/15, Labyrinth 20/20, Canyon 25/25, Descent 0/35, Speedway 0/0). End-port shafts are straight, without the zigzag. Only `chimney` and `chamber` accept N/S entries (`VERTICAL_ENTRY_TYPES`). Leaving a vertical port, the generator picks the turn: E 3 : W 1, with W only inside the west budget.
- **`chimney`:** the shaft carries on 1–4 rows up (or 0–4 down) and turns into a tunnel leaving E or W, built directly for each turn (an odd-width shaft has no integer mirror axis).
- **`chamber`:** 10–18 × 9–14 cells, entered through the left wall (mirrored for W), the floor (N) or the ceiling (S). 1–2 bounce pads; a pit to the sea one time in three; a one-row ledge island half the time when the room is ≥ 11 rows tall. The exit is at most `chamberExitRiseMax` rows above the floor (Descent 0, Labyrinth 4, others 6). Its room is in `chambers`, so it is exempt from the tunnel height limit.
- **Descent:** band −110, `startFloor` −80. Shaft-up and stall-chamber weights are 0, and with `climbRows: 3` any ordinary segment rising ≥ 3 rows is rejected, so climbs come only from 0–2 `climb` beats (a shaft up or a stall chamber, at 250‰ and 550‰). `glide`: ordinary segments keep their floors above a line sliding from the start floor to `LOWEST_FLOOR`, reached at 80% of the target par, so the drop is spread over the stage. The stage finishes only once drop ≥ 2 × climb (summed per segment by port level). Guarantee check added.
- **Canyon:** agenda chamber 120‰, stall chamber 300‰, chamber 480‰, stall chamber 650‰; chamber weight 300%. Guarantee check added (≥ 2 of each).
- **Headroom:** `BEAT_HEADROOM` now also covers chamber 14, stall chamber 20 and climb 20. Pending switchback pairs add up (they climb one after another); other beats count only the largest.
- **Port levels:** horizontal port = floor row, vertical port = its line. `riseOf(plan)` is used for the climb rule; `stageChecks.portLevel` is the same in px.
- **Tests:** chimney and chamber are passable from N and S entries turning E and W (other types refuse vertical entries); shaft end ports; mirror test also checks that a refused E template is refused W. Sweep: all 9 types, and exits in all four directions.
- **Snapshots** (on purpose): `tower 5b31aa2, descent c0370ee0, labyrinth dcf6b374, speedway e2cb8d6f (unchanged), canyon d170410b`. They changed because of the two new types and their weights, end-port draws, the Descent and Canyon profiles and agendas, and the per-beat headroom.
- **Restart stats** (5000 stages): **0 restarts, 0 relaxed**; pops Tower 342, Descent 339, Labyrinth 1352, Canyon 264. Per stage: vertical ports Tower 0.9, Descent 1.4, Labyrinth 1.6, Canyon 1.2; chambers Canyon 5.8, **Descent 6.9** (the chamber is Descent's main non-climbing alternative to runs near the bottom; worth judging in the gallery). Par 55.7–64.7 s. Descent is the tallest stage (5450 px). Runs: Canyon 23%, Descent 37%.
- Verified: 29 files / 302 tests, `tsc` clean, sweep 31.5 s, full suite 33 s (machine shared with other agents).

### Slice 6
- **`fork`** (E→E, mirrored for W). A tall split junction (3 columns) and merge junction (3 columns) join the two branches.
  - **Low branch:** a 14–22-column tunnel whose floor dips 2–3 rows in its middle half. The dip shrinks to fit the band floor, down to 0.
  - **High branch:** 4–5 rows tall, above an island of 2–3 rows of rock. It has 2 of 3 features: a squeeze (3 rows = 150 px, so it stays inside the tunnel limit), a wall-bounce step (the floor jumps 3 rows for the last 5 columns), and a slot wall (one column with a 2-row = 100 px slot at its foot, counted as a chamber piece like the stall slot).
  - **Drop hole:** one fork in three has a 2-wide hole from the high floor down into the low branch. It counts as part of the high branch.
  - `SegmentPlan.branches {high, low}` (cells) becomes `Segment.fork {high, low}` (px). Spine (points every ≤6 cells) and par follow the low branch.
- **Counts** come only from agenda beats: `withForks(agenda, profile.forkCount(rng))` adds fork beats (1 fork at 400‰, 2 at 200/600‰) and sorts the agenda. Labyrinth 2; Tower, Descent and Canyon 1; Speedway `rng.int(0, 1)`. The ordinary fork weight is 0. `BEAT_HEADROOM.fork` is 20.
- **Passability:** `planPassableEveryWay` requires the plan to pass as a whole and with each branch turned to rock (`planPassable(plan, solid)`). The stage-level sweep check `checkForkBranches` uses the new `reach.ts` `solidify(grid, rects)`: from bay 0, the finish is reachable with the high branch solid and with the low branch solid. It also checks the fork count per archetype (`FORK_COUNTS`).
- **Fixed while tuning:**
  - Chimneys turn left only out of N ports ("up, then left"). Leftward turns out of S ports stranded Descent below its earlier route.
  - A shaft's bottom end port needs `tunnelMax + 4` rows below it, and a downward chimney's shaft shortens to fit. Near the band floor the next segment had nowhere to go, and the bans cascaded back to the start room.
  - `START_HEADROOM` (24): the beats' headroom reserve never pushes the ordinary ceiling below `startFloor − 24`. With 1–2 bays, Tower's reserve (two pairs + a fork) put it at −20, so nothing fitted out of the start room (1.2% of Tower stages restarted).
- **Tests:** fork template branches passable on their own (E and W entries, all difficulties), island ≥ 2 rows; `progress.test`: an orb walking the high branch of generated forks keeps being tracked forward. Projecting from above the low branch's dip can slip back up to ~150 px for a moment (the test allows 250); no latching onto other legs was seen.
- **Sweep time:** `reach.ts` now prepares the bordered open/pad/surface maps once per grid and reuses them for every bay and the sea (`prepare`/`run`; identical results, snapshots unmoved). That halved the traversable check. The determinism check now regenerates every 4th stage (250 per file, all archetypes and bay counts) instead of every stage.
- **Snapshots** (on purpose): `tower 74ee499a, descent 7bf4c34e, labyrinth acbad711, speedway a46331de, canyon 9717d53c`. They changed because of the fork beats (Speedway changed too: its 0–1 fork count is drawn from the stream) and `START_HEADROOM`.
- **Restart stats** (5000 stages): **0 restarts, 0 relaxed**; pops Tower 243, Descent 43, Labyrinth 1907, Speedway 0, Canyon 72. Forks: Labyrinth 2.0, others 1.0, Speedway 0.48 per stage. Par 55.7–64.4 s.
- Verified: 28 files / 308 tests (the temporary probe test is gone), `tsc` clean, sweep 27.4 s, full suite 29.9 s (load average 3.6).


### Slice 7: integration (2026-10-23)
- **Checks:**
  - vitest: 28 files, 308 tests pass; `tsc` clean; the capped build succeeds.
  - Kotlin: 62 tests, 0 failures, over 3 consecutive runs.
  - Dependency rule: `race/` and `fx/stageThumb.ts` import nothing outward.
  - The generator uses no `Math.random`, trig or `Date`.
- **Fix:** `RoomFlowTest.returnToLobbyEndsMatchOverWaitEarly` was flaky. Alice and Bob connected at once, so Bob's join could win the race and make him host. Alice's `updateSettings` was then ignored and the test timed out. Alice now fully joins before Bob connects.
- **Two-browser run** (first to 3 wins), 6/6 checks: each round both clients built the same archetype, seed and stage, and no archetype repeated back to back (labyrinth → speedway → descent). No page errors. Per-round stats:

| Round | Archetype | Segments | West | Forks | Height |
|---|---|---|---|---|---|
| 1 | Labyrinth | 27 | 5 | 2 | 3600 px |
| 2 | Speedway | 17 | 0 | 0 | 2400 px |
| 3 | Descent | 30 | 2 | 1 | 4800 px |

- **Still open:**
  - the play review with the user (the `?gallery` dev page and solo `?arch=`)
  - Descent's chamber count, about 6.9 per stage
  - Labyrinth par running close to the 65 s cap
  - `?perf` on tall stages
