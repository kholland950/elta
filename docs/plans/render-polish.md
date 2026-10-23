# Render polish: neon + cinematic look for elta

## Context
elta is a side-view multiplayer platformer (Phaser 4.2.1 + Svelte 5). Players are ~40px glowing orbs (`*Light.png`, scale 0.1) on a 4000×4000 world with a 1024px `spacebg.jpg` tiled 4×4, no parallax, no camera FX; trails are dotted SCREEN particles; only effect is a 20-particle flare burst on collision. Goal: a polished neon/cinematic look without touching gameplay, physics, protocol or server. (Survey + three grill rounds done.)

### Settled decisions (Gate 1)
- **Look:** neon + cinematic — procedural parallax starfield/nebula, neon world border, camera bloom, enhanced neon orbs (bright core + coloured halo, squash/stretch, ribbon-like trail), upgraded explosions.
- **Scope:** Phaser canvas + **light-touch** Svelte reskin (palette, display font, glowing buttons/inputs; keep Milligram & layout). No gameplay/protocol/server changes.
- **Effects:** Dash (afterimage streak), Stall (shockwave ring), Flap (puff), Recharge (pulse), Collision upgrade (bigger burst + ring + small shake). **Local player only**; remote players get glow + trail. Collision fires as today (when the local player is involved).
- **Not doing:** HUD charge pips, remote-player interpolation, animated nebula shader, new character art, motion inference for remotes.
- **Assets:** procedural first; CC0 only if clearly better (none planned).
- **Quality:** High/Low toggle in the Tab scoreboard menu, persisted to localStorage, **default High**, no auto-detect. Shake also suppressed under `prefers-reduced-motion`.
- **Perf:** 60fps on iGPU at High; Low disables bloom, extra parallax layers, and cuts particle counts.
- **Structure/testing:** small pure FX core unit-tested with Vitest; Phaser adapters around it.
- **First slice:** background + bloom + toggle + orbs + trails.

## Architecture (sized down: 2 layers)
Dependency rule: `render/*` and scenes import `fx/*`; `fx/*` imports nothing from Phaser, Svelte or the DOM.

**Pure core — `frontend/src/game/fx/`** (entities + use-case logic, no Phaser)
- `quality.ts` — `type QualityLevel = 'high' | 'low'`; `loadQuality(store)` / `saveQuality(store, level)` against a tiny `KeyValueStore` port (`getItem/setItem`, satisfied by `window.localStorage` and a Map fake); `qualityProfile(level, reducedMotion)` → `{ bloom, parallaxLayers, nebula, trailRate, burstCount, shake }`.
- `starfield.ts` — seeded PRNG (mulberry32) + `generateStarLayers(seed, layerCount, tileSize)` → per-layer `{ scrollFactor, stars: {x,y,r,alpha}[] }`, and `generateNebula(seed, worldSize)` → blob list `{x,y,radius,color,alpha}`. Deterministic, bounds-respecting.
- `orbMotion.ts` — `squashStretch(vx, vy, maxSpeed)` → `{ scaleX, scaleY, angle }` (volume-preserving, clamped).
- `feelEvents.ts` — `type FeelEvent = { kind: 'dash', x, y, dir } | { kind: 'stall' | 'flap' | 'recharge' | 'collision', x, y }` and port `interface FeelSink { emit(e: FeelEvent): void }`.

**Phaser adapters — `frontend/src/game/render/`**
- `BackgroundRenderer.ts` — bakes each star layer into a texture (Graphics → `generateTexture`), shows as `tileSprite` with `setScrollFactor(layer.scrollFactor)`; nebula blobs from one generated radial-gradient texture, ADD blend, low scroll factor; neon world-border Graphics with a Glow filter. Replaces the `spacebg` tileSprite in-game.
- `CameraFX.ts` — `Phaser.Actions.AddEffectBloom` on the main camera (verify signature in `node_modules/phaser/src/actions/AddEffectBloom.js`), subtle `addVignette`; `applyQuality(profile)` enables/disables. Collision `shake()` honouring profile.
- `PlayerVisuals.ts` — per-player: halo sprite (coloured `*Light.png`, ADD) + small bright core (generated white radial texture) following the physics sprite; ribbon trail (denser, short-lifespan ADD emitter tinted per colour, rate from profile); squash/stretch from `orbMotion`; styled name label (Comfortaa, glow shadow). `destroy()` removes everything — **fixes the leaked `player.particles` emitter in `playerLeft`**.
- `EffectsDirector.ts` — implements `FeelSink`; dash streak (afterimage sprites tweened out), stall shockwave (expanding ring Graphics/tween), flap puff, recharge pulse (scale/alpha tween on halo), collision (flare burst sized by profile + ring + `CameraFX.shake`).

**Edits to existing code**
- `PlayerManager.ts` — delegate sprite/trail creation to `PlayerVisuals`; call `feelSink.emit(...)` at existing points: jump (`~L204`), dash (`~L218/224`), stall (`~L228`), recharge on world/player touch (`~L45`, `~L184`), collision (`~L187`, replacing `playerExplosion.explode`). Physics sprite stays the hitbox (its texture alpha 0 or kept as halo).
- `MainScene.ts` — composition root: load quality, build `BackgroundRenderer`, `CameraFX`, `EffectsDirector`, pass into `PlayerManager`; listen for quality changes.
- `app/events.ts` + `Room.svelte` — High/Low toggle in the Tab scoreboard menu; emits `qualityChanged` via the existing events bus; saved with `saveQuality`.
- `css/global.css`, `App.svelte` — light reskin: neon palette vars (keep names), display font for title (Google Fonts, e.g. Orbitron) alongside Comfortaa, glowing button/input focus states, `.card` glassy translucency; fix `body { height: 100vw }` → `100vh`.
- `package.json` — add `vitest` devDep + `"test": "vitest run"`.

Step 0 of implementation: copy this plan to `docs/plans/render-polish.md` and keep it ticked off there.

## Build order
1. [x] **Slice 1 — Background, bloom, toggle, orbs, trails**: Vitest setup → `quality`, `starfield`, `orbMotion` + tests → `BackgroundRenderer`, `CameraFX`, `PlayerVisuals` → wire in `MainScene`/`PlayerManager` → Tab-menu toggle. Fix emitter leak.
   - Done 2026-10-23. Vitest 5 (`npm test`, 22 tests); tests import `fx/*` relatively, so no alias config was needed.
   - Deviations:
     - `CameraFX` sets an opaque black camera background. With filters on, the camera renders into a transparent framebuffer: ADD objects punched dark squares and the page showed through the canvas.
     - World border is a few stacked ADD strokes instead of a Glow filter. An internal Glow on a 4000px Graphics would need a world-sized framebuffer, and bloom already gives the glow.
     - Nebula uses scroll factor 0.08 and is offset by `(viewport/2)*(1-s)` (recomputed on resize) so it stays centred on the camera; blobs come from `generateNebula` over `worldSize*s + 2000`, not the full world. Star layers are `2*worldSize` tileSprites so they cover any viewport.
     - `trailRate` means trail particles per 100px travelled (High 25, Low 8), not per frame, so the ribbon holds at low fps. Emitters are capped with `maxAliveParticles` (160 local / 120 remote). Fixed after the slice: the first cut used `maxParticles`, which in Phaser caps the emitter's lifetime total and stopped the trail for good; no emitter should use it as a cap.
     - The physics sprite is hidden (`setVisible(false)`) and stays the hitbox and camera target. `PlayerVisuals` draws the orb (same texture and 0.1 scale), an ADD halo, a white core and the label. Visuals sync on scene `POST_UPDATE`, after the physics step.
     - `events.send` is now a no-op when nothing is listening, and `events.remove` was added. The scene unregisters `qualityChanged` on destroy.
     - `CameraFX` has no `shake()` yet; it is used only by the slice 2 collision upgrade. The collision explosion is unchanged (20 flares, depth raised above the orbs).
   - Verified headless (SwiftShader only, no GPU in WSL headless): bloom on/off, layers 3→1, nebula hidden on Low, toggle persists across reload, Space after clicking does not re-trigger the button, and player-left removes one full set of objects (sprite + 3 images + text + emitter).
   - Perf, 1280×720, 10s of movement, software GL: HEAD baseline p50 33ms/p95 50ms (29fps); High p50 267ms/p95 400ms (3.6fps); Low p50 50ms/p95 67ms (21fps). Bloom dominates in software. The iGPU 60fps target is not measured here. **60fps at High verified by user on real GPU** (2026-10-23).
2. [x] **Slice 2 — Event effects**: `feelEvents` → `EffectsDirector` (with a recording fake sink test for PlayerManager-free logic only) → emit calls in `PlayerManager`.
   - Done 2026-10-23. 29 tests (`feelEvents`, `color`, extended `quality`).
   - What each event draws: flap = glow-dot puff in the player colour, kicked sideways and down; dash = afterimages (orb copies dropped every 28ms while the dash runs, fading over 260ms) + white-hot exhaust sparks (see the dash rework below); stall = expanding soft ring (player colour lightened toward white); recharge = 280ms swell of the local halo (scale + alpha); collision = flare burst (`profile.burstCount`) + warm ring + `CameraFX.shake()`.
   - Deviations:
     - `QualityProfile` gained `puffCount` (10/4), `afterimages` (4/2) and `wisps` (55/20; was `speedLines` 6/3) so Low cuts every effect, not only the burst.
     - Recharge feedback is gated by the pure `restoresCharge(charge, dashesAllowed)` in `fx/feelEvents.ts`: `worldbounds` fires every frame while resting on the floor, so it only fires when a dash or the stall had been used. `PlayerManager.recharge()` now does the refill for both the world-bounds and player-collision paths.
     - The recharge pulse lives in `PlayerVisuals.pulse()` (a counter tween folded into the per-frame halo scale/alpha), because `update()` overwrites the halo's scale every frame. `EffectsDirector.setLocalPlayer(visuals)` is called from `MainScene` after the local player is added (`PlayerManager.localVisuals` getter); the director takes the effect tint, orb texture and position from it.
     - Afterimages are NORMAL blend (not ADD) at the trail's depth, drawn after it: ADD copies vanished into the saturated white trail ribbon.
     - Collision burst: 40/15 flares (was 20) but scale 0.26 (was 0.8), alpha 0.6, born across an 18px disc and thrown out at 380–900px/s, so the core no longer overlaps into a white blob under bloom. Lifespan 0.7–1.3s (was 2s). The ring is a generated soft-ring texture (`fx-ring`, `render/textures.ts`), shared with the stall.
     - `CameraFX.shake(duration = 160, intensity = 0.004)` is a no-op when `profile.shake` is false (Low or `prefers-reduced-motion`).
     - Small pure helper `fx/color.ts` `lighten()` (tested) for the lightened ring/wisp tint.
     - `PlayerManager.state.canStall` typed `boolean` (was the `Boolean` wrapper) so it fits `MoveCharge`; no behaviour change.
     - Two feel events can fire for one bump (Arcade's `collide` callback can run on two consecutive frames); that matches the old explosion behaviour and was left alone.
     - **Dash rework (2026-10-23, user feedback: speed lines were "too arcadey", wanted "ethereal and aura-y").** Afterimages unchanged; speed lines removed. Two new layers, local player only:
       - Aura swell: `PlayerVisuals.swell()`, a 480ms counter tween shaped by pure `fx/swell.ts` `swellEnvelope(t)` (sine rise to 1 over the first 18%, then `(1-u)^2` ease-out back to 0 over ~400ms). Folded into the per-frame halo scale/alpha next to `pulse()`: halo scale +90% and alpha +0.4 at the peak (alpha clamped to 1). Runs at both quality levels.
       - Drifting wisps: `profile.wisps` motes (High 10, Low 4) of the generated glow texture, ADD, player colour lightened, depth 9. They are shed evenly over the dash's first 150ms, each born where the orb is at its delay, then drift 60-140px backward (ease-out), curl with a sine wobble across and along the drift (amplitude 8-20px, 0.6-1.3 cycles, random phase, growing from zero so they leave the orb cleanly), rise slightly, grow 1.8-2.6x and fade in over 15% of life then out over 600-800ms. Seeds and per-frame offsets are pure `fx/wisps.ts` (`wispSeeds`, `wispFrame`, tested).
       - Wisps are pooled images, not an emitter (each mote needs its own wobble phase): `EffectsDirector` creates them lazily up to 40, drives each with one counter tween and returns it to the pool on complete/stop. 39 tests after the rework (`swell`, `wisps` added). Spamming dashes created 20 images total and all were back in the pool after settling; tweens returned to 0.
       - Verified headless with the game loop stepped manually at 16.7ms and `Date.now` faked (TweenManager clocks itself from `Date.now`, so under SwiftShader tweens otherwise trail physics): swell peaks ~100ms and is back to the base halo by 480ms; motes strung behind the dash path at 250ms. Not verified: how it feels at real frame rate on a GPU, and Low in a browser (only the profile unit test).
      - **Dash rework 2 (2026-10-23, user feedback: the dash halo bloom "looks weird", wisps "a little soft"; wanted more, smaller, brighter, "very bright exhaust clipping the camera").** Aura swell removed (`fx/swell.ts` deleted; camera bloom unchanged). Wisps retuned as exhaust: High 30 / Low 12, shed over 180ms, scale 0.035-0.065 shrinking to 15-40% as they burn out, peak alpha 0.9-1 with a 5% flash-in, life 280-480ms, drift 70-190px, wobble 3-9px, tint lightened 75% toward white. Pool cap raised to 120. Checked by the user in their browser, not headless.
     - **Punchier dash (user: "feels like a long boost, instead of an immediate POW"):** sparks shed over 40ms (was 220) with a quartic ease-out and 200-360ms life; trail ignition 140ms (was 380); afterimages every 18ms fading over 180ms (was 28/260); new 140ms white pop flash (glow texture, 0.3→1.1 scale) between halo and orb, destroyed on complete.
     - **Dash camera kick: removed (user request, after merge prep).** Tried a follow-offset nudge (absorbed by the 0.2 follow lerp), a zoom punch (looked bad), then a render-time view-matrix recoil (worked, measured 8px); the user then dropped the kick from dashes entirely. Collision shake via `CameraFX.shake()` is kept.
     - **Spark fan-out:** each spark gets a signed `spread` (±0.7 of its drift, a ~±35° cone) so the trail doesn't cover them, and sparks moved above the trail (depth 10.5).
     - **Trail ignition (user request):** on dash, `PlayerVisuals.ignite()` lays a white-hot copy of the trail (same texture, scale and lifespan as the trail, tint 70% toward white, alpha 1) over it for 380ms; an earlier 0.5-scale glow version made the trail balloon, from a lazily created emitter capped with `maxAliveParticles`; destroyed with the player.
     - **Dash rework 3:** user asked for brighter, larger, bloomier, faster, more. High 55 / Low 20 over 220ms, scale 0.09-0.17 shrinking to 25-50%, alpha 1, life 240-420ms, drift 160-380px, wobble 4-12px, tint 85% toward white, pool cap 220.
  - Cleanup: two emitters (puff, burst) are created once and re-exploded, both capped with `maxAliveParticles`; every afterimage and ring object is destroyed in its tween's `onComplete`; wisp images are pooled (see below); a new dash cancels the previous afterimage timer and a new pulse removes the running one.
   - Verified headless (SwiftShader, effects slowed with tween/time/physics/emitter time scales for capture): each input (Space, Shift+arrow, E, landing, bumping a second player) emits exactly the expected event; 2.5s resting on the floor emits nothing; scene object/tween counts return to baseline after all effects settle and after the second player leaves (no per-event leaks, 0 alive puff/burst particles); `camera.shake` is called on a High collision and not on Low. No page errors.
   - Not verified: how the effects feel at real frame rates (software GL runs ~4fps at High), and `prefers-reduced-motion` in a browser (covered by the `qualityProfile` unit test only).
3. **Slice 3 — Svelte light reskin** [x] done (light touch, no markup restructuring).
   - Palette (same var names, re-valued): `--primary #2ee6d6` teal, `--secondary #ff3d9a` magenta, `--bg #080b18`, `--text #f4f7ff`, `--darkText #050810`; new `--glass`, `--glow`. Body keeps spacebg.jpg under a dark overlay plus faint magenta/teal radial gradients; `height: 100vw` fixed to `100vh`.
   - Orbitron 700 (Google Fonts, added to the existing link in `App.svelte`) for the Main title only via `class="title"` on that h1; Comfortaa stays for body. Glass `.card` (blur, teal hairline border, glow); buttons are teal with dark labels, glow on hover, 3px white outline on `:focus-visible`; outline buttons (quality toggle) inverted; inputs/select get a teal border, outline and glow on focus. Transitions disabled under `prefers-reduced-motion` (no animations added).
   - Deviations: `Main.svelte` gained one class; Room.svelte untouched (scoreboard and toggle styled via global.css). Contrast: text/bg 18.3, button label/primary 12.8, label/hover 15.4, outline label/bg 12.5, placeholder 8.0.
   - Not verified: Chrome's backdrop-filter on a real GPU, Firefox/Safari, reduced motion in a browser, Orbitron actually loading (screenshots show it rendering with network).
Review (dependency grep on `fx/`, boundaries, over-engineering, spec) after each slice.

## Tests
- Vitest (`frontend/src/game/fx/*.test.ts`): quality load/save/defaults with Map store, profile Low disables bloom & shake, reducedMotion kills shake; starfield determinism per seed, star counts, coordinates within tile; nebula within world; squashStretch identity at rest, clamping at max speed, area ≈ 1.
- Phaser adapters: verified in-browser (no unit tests).

## Verification
- `cd frontend && npx vitest run` and `npx tsc --noEmit`.
- Build in capped steps (low-memory WSL): `NODE_OPTIONS=--max-old-space-size=2048 npm run build` separately from Gradle; run backend (`./gradlew run`) and `npm start` separately.
- Phaser4-gamedev agent: headless Chrome screenshots before/after (idle, moving, dash, stall, collision) at High and Low; frame-time sample (p50/p95) over ~10s movement at High — target p95 ≤ 16.7ms on this machine as a proxy; confirm Low visibly drops bloom.
- Manual: Tab menu toggle persists across reload; two tabs in one room to see remote trails and the player-left cleanup (no orphaned emitter).

## Open risks
- Exact `AddEffectBloom` / filter signatures in 4.2.1 — check source before coding.
- Bloom on a full-screen camera on iGPU — Low path is the fallback.
- Canvas renderer fallback loses filters silently (acceptable).
- `parent: 'game'` element doesn't exist; canvas appends to body — leave unless it interferes with the reskin.
