# Jump pad glow and launch effect

## Context
Bounce pads are drawn as a flat `0x5a0f5e` rectangle (100×50px, 2×1 cells) with a magenta neon outline on every open side ([StageRenderer.ts:54-67](frontend/src/game/render/StageRenderer.ts#L54-L67)). They read as "a purple square", and a launch plays no feedback at all; the velocity is just set in the pad collider ([StageWorld.ts:55-60](frontend/src/game/stage/StageWorld.ts#L55-L60)). Goal: pads that glow and breathe at rest and visibly kick on launch, without touching physics.

## Settled decisions (Gate 1: grill answers)
| # | Decision |
|---|---|
| Q1 Idle | Vertical gradient (bright top, fading to clear about ¾ of the way down), a slow ~1 Hz brightness pulse, and a few faint sparks drifting up. Low quality drops the sparks. Reduced motion holds the pulse steady. |
| Q2 Edges | Only the top (launch surface) gets the crisp neon line. The sides fade with the gradient. No bottom line. |
| Q3 Launch | A magenta spark fountain thrown upward from the contact point, a pad flash (~150ms), and a short upward streak. No screen shake. |
| Q4 Multiplayer | A new `bounce` feel event, relayed like dash and stall. The server relays `playerAction` as-is ([Protocol.kt:61](src/ws/Protocol.kt#L61)), so no backend change is needed. Old clients drop unknown kinds. |
| Q5 Out of scope | Sound, replays, pad physics and size. The lobby room gets the new look for free (same renderer). |
| Q6 Colour | Keep magenta (`padEdge 0xff3df0`). |

## Design (sized small; this matches the existing `fx/` (pure) and `render/` (Phaser) split)

**Pure, tested (inner):** `frontend/src/game/fx/padGlow.ts`
- `padPulse(tMs, phase, reducedMotion): number` returns the brightness factor (e.g. 0.7–1.0 sine at ~1 Hz). It is constant when reduced motion is on. The phase comes from the pad's x, so the pads ripple across the stage rather than blinking in unison.
- `padAt(pads, x, y): Rect | undefined` returns the pad whose top span contains x, with y within a few px of its top. It is used to pick which pad flashes for a (possibly relayed) launch point.
- `flashLevel(elapsedMs): number` gives the 1→0 decay over ~150ms (ease-out).

**Feel event (inner port, already exists):**
- [feelEvents.ts](frontend/src/game/fx/feelEvents.ts): add `'bounce'` to the plain-kind union.
- [actions.ts](frontend/src/game/fx/actions.ts): add `'bounce'` to `KINDS`. It needs no extra fields, so it uses the `default` branch.
- [quality.ts](frontend/src/game/fx/quality.ts): add `padMotes: boolean` (high only) and `padBurstCount` (e.g. 24 high, 10 low) to `QualityProfile`.

**Emit (adapter):**
- [StageWorld.ts](frontend/src/game/stage/StageWorld.ts): extend `StageContacts` with `onLaunch(x, padTop)`. Call it inside the existing "landing" branch, where `setVelocityY(-BOUNCE_PAD_VY)` is set.
- [PlayerManager.ts](frontend/src/game/PlayerManager.ts): add `launchedFromPad(x, y)`, which emits `{kind:'bounce', playerId, x, y}` through `this.feel` (same pattern as `emitLocal`).
- [MainScene.ts:462](frontend/src/game/MainScene.ts#L462): wire `onLaunch` in `buildStage`.

**Render (outer):** new `frontend/src/game/render/PadRenderer.ts`, modelled on [GateRenderer.ts](frontend/src/game/render/GateRenderer.ts) (own class, `applyQuality`, reduced-motion check, `destroy`).
- A baked canvas texture `fx-pad` goes in [textures.ts](frontend/src/game/render/textures.ts) (canvas, so it also works without WebGL): a few px of soft glow above the top, a near-white→magenta core line, then a linear gradient fading to alpha 0 at ~75% of the height. The texture is white and tinted `padEdge`.
- One additive Image per pad, scaled to the pad rect, at `STAGE_DEPTH` and created after StageRenderer so it draws on top. On `PRE_RENDER`, set each visible pad's alpha to `padPulse(...) + flash`.
- Idle motes: **one** shared particle emitter using `GLOW_TEXTURE`. A custom `emitZone.getRandomPoint` picks a random point on the top edge of a pad currently near the camera. The sparks are slow, drift upward, are faint and short-lived. The emitter is off when `!padMotes`.
- `launch(x, y)` uses `padAt` to find the pad: it flashes the pad, explodes `padBurstCount` fountain particles (a second shared emitter: angle about -110…-70°, gravity, `ADD`, lightened magenta, depth 9 behind the orb), and tweens one stretched glow image upward as the streak, destroyed on complete. If no pad is found (a stale relayed point), it shows the fountain only.
- [StageRenderer.ts](frontend/src/game/render/StageRenderer.ts): stop drawing the pad fill and skip edges where `e.pad` (PadRenderer now owns pads).

**Routing the event:** [EffectsDirector.ts](frontend/src/game/render/EffectsDirector.ts) gets `setPadLaunch(sink?: { launch(x, y): void })`. `case 'bounce'` calls `sink?.launch(e.x, e.y)`, using the event point (the pad position), not the orb as drawn. MainScene sets it in `buildStage` and adds `padRenderer.applyQuality` and `destroy` beside the gate renderer.

Dependency direction: `fx/padGlow` and `fx/feelEvents` import nothing from Phaser. `render/*` and `stage/*` import `fx/*`. MainScene is the only place that knows both PadRenderer and EffectsDirector.

## Build order
1. [x] **Slice 1, idle look:** `padGlow.ts` + tests, the `fx-pad` texture, PadRenderer (gradient + pulse + motes), and the StageRenderer pad removal. Check in a browser.
2. [x] **Slice 2, launch effect:** `bounce` event + action parsing + tests, quality fields + test, StageWorld/PlayerManager/MainScene wiring, EffectsDirector routing, and PadRenderer `launch` (flash + fountain + streak).
3. [x] Copy this plan to `docs/plans/jump-pad-glow.md` and tick slices off as they land.

The implementation is delegated to the **phaser4-gamedev** agent (as you asked), one slice per run, with this plan as its brief.

## Test strategy
- Vitest unit tests (no Phaser): `padGlow.test.ts` covers pulse range, period, reduced motion held constant, `padAt` hit/miss and edge tolerance, and flash decay. `actions.test.ts` covers the `bounce` round trip and that the parse accepts it. `quality.test.ts` checks the new fields for high and low.
- Run `npm test` in `frontend/`.
- Visual check: `npm run build` on its own (WSL memory: no parallel Gradle). Run the app and look at a stage with pads in the lobby and in a race. Check the fade, the pulse, the motes, and that the launch shows the fountain, flash and streak. Check with low quality (no motes, fewer sparks) and with reduced motion emulated (steady glow). With two clients, check that the remote launch shows.

## Open risks
- Pad count per stage: there's one Image per pad, plus two shared emitters. Images are cheap; check the frame time on low quality.
- Additive blending with bloom on high quality could blow out the top line. Tune the alpha so it stays under the bloom threshold, as the collision burst already does.
- The relayed launch point can lag a stage rebuild. `padAt` falls back to the fountain only.

## Slice 1 notes (as built)
Not yet checked in a browser (low-memory VM: no headless run). Unit tests and `tsc` pass.

Deviations from the design:
- **Two Images per pad, not one.** A white texture tinted magenta can't give a near-white core line, so the top line is a second thin additive Image (`fx-pad-core`, tinted the new `STAGE_PALETTE.padCore 0xffd8fb`) over the body (`fx-pad`, tinted `padEdge`). Both follow the pulse.
- **Pads are filled as rock.** Pads replace rock in the grid, so dropping the fill would leave a hole showing the background. StageRenderer now fills pads with `solidFill` and skips `e.pad` edges. `padFill` was removed from the palette.
- **Motes are also off under reduced motion**, not only on low quality.
- `padMotes` was added to `QualityProfile` in this slice. `padBurstCount` waits for slice 2.

Tuning values (expect to adjust them in the browser):
- Pulse 0.7–1.0, period 1000ms, phase = x / 800px × 2π. Flash 150ms, quadratic ease-out. `padAt` tolerance is 6px.
- Texture: a glow margin of 8px above the top. Body alpha stops are 0.22 at 2px above the line, 1 on the line, 0.42 at 2px below, 0.3 at 15%, 0.14 at 40%, 0.05 at 60% and 0 at 75% of the pad height. Peak alphas are body 0.6 × pulse and core 0.6 × pulse (to keep the core under the bloom threshold of 0.55).
- Motes: one mote per near pad about every 700ms (the shared emitter's frequency is 700 / pads near the camera), speedY -30..-12, speedX ±6, life 700–1300ms, scale 0.07→0, alpha 0.5→0, lightened magenta, max 24 alive. The cull margin is 200px.
- For slice 2: PadRenderer keeps per-pad records (`PadGlow`) and computes alpha in `frame()`. `launch(x, y)` can store a flash start on the pad from `padAt` and add `flashLevel` there.

## Slice 2 notes (as built)
`npm run build` (Rollup) succeeds, and unit tests and `tsc` pass. Not yet checked in a browser or with two clients.

- `bounce` was added to the feel kinds and to `KINDS`, with a round-trip test and a parse test in `actions.test.ts`. `padBurstCount` is 24 on high and 10 on low.
- `StageContacts.onLaunch(x, padTop)` is called in the landing branch. `PlayerManager.launchedFromPad` emits `bounce`, and MainScene wires it in `attach`.
- `EffectsDirector.setPadLaunch(sink?)` takes a `PadLaunchSink`. `case 'bounce'` calls `sink.launch(e.x, e.y)`. MainScene sets the sink in `buildStage`.
- `PadRenderer.launch(x, y)`:
  - It flashes the pad found by `padAt` (+0.4 on body and core alpha at the peak, capped at 1, 150ms).
  - It throws the fountain from a second shared emitter: angle -110..-70, speed 300–650, gravityY 900, life 400–700ms, scale 0.18→0, alpha 0.8→0, magenta lightened 0.5, depth 9, max 96 alive.
  - It shoots the streak: a GLOW image at scale 0.12×0.9, origin at its bottom, alpha 0.7, rising 120px over 220ms with Quad.easeOut, destroyed on complete.
  - Under reduced motion the flash stays, the fountain is halved (rounded up) and there is no streak. With no pad at the point, only the fountain shows.

Deviations and additions:
- **Relaunch guard:** a second launch off the same pad within 60ms is ignored, in case the pad collider fires on consecutive steps of one landing.
- The fountain emitter is created even on a stage with no pads, so a stale relayed launch still shows sparks.
- `LAUNCH_DEPTH = 9` is a local constant that mirrors EffectsDirector's private `BEHIND_ORB_DEPTH`, which keeps PadRenderer from importing EffectsDirector.
