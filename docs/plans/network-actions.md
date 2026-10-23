# Networked action effects

## Context
Render polish (PR #42, merged) added effects for jump (flap), dash, stall, recharge and collision, but only for the **local** player: the protocol sends positions only, so other clients never see your actions. Goal: clients broadcast their actions so every client shows each player's action effects. Remote-vs-remote collisions (currently invisible to bystanders) also become visible.

### Settled decisions (Gate 1)
- **Broadcast:** dash, stall, flap, recharge, and collision.
- **Collision de-dupe:** only the participant with the lexicographically smaller player id broadcasts (message carries both ids). Receivers ignore collision messages involving themselves (they already showed it locally).
- **Server:** dumb relay — new `playerAction` event forwarded as-is to other sessions, no validation, no state.
- **Remote fidelity:** same effects as local (respecting High/Low), **never camera shake** for remote actions; attached effects follow the remote orb.
- **No server test**; verify with two browser tabs.
- **Branch:** new branch from freshly pulled `master` (#42 is merged).

## Design (sized to the change; extends the existing fx/ + render/ split)

**Pure core — `frontend/src/game/fx/`**
- `feelEvents.ts`: every `FeelEvent` gains `playerId: string`; collision gains `otherId: string`. `FeelSink` unchanged.
- New `actions.ts` (+ `actions.test.ts`), no Phaser/DOM:
  - `toActionMessage(e: FeelEvent): PlayerActionMessage` / `fromActionMessage(m): FeelEvent | undefined` (drops unknown `kind`, bad `dir`).
  - `shouldBroadcast(e, localId)`: true for local flap/dash/stall/recharge; for collision only when `localId < e.otherId`.
  - `shouldShowRemote(e, localId)`: false if `e.playerId === localId` or (collision and `e.otherId === localId`).
  - The message DTO type lives here (or in `messages.ts` imported as a type) so fx stays framework-free.

**Protocol — `frontend/src/game/messages.ts`**
- `MessageEventType.PLAYER_ACTION = 'playerAction'`; `PlayerActionMessage { playerId, kind, x, y, dir?, otherId? }`; add to `SendableMessageData` / `ReceivableMessageData`.

**Adapters**
- `frontend/src/game/MessageBroker.ts`: handler for `PLAYER_ACTION` → `fromActionMessage` → `shouldShowRemote` → `scene.effects.emit(e)`. Add the case to `route()`.
- New `frontend/src/game/BroadcastingFeelSink.ts`: implements `FeelSink`; forwards every event to the `EffectsDirector`, and if `shouldBroadcast(e, localId)` sends `toActionMessage(e)` via `MessageBroker.send(PLAYER_ACTION, …)` immediately (not on the TPS schedule).
- `frontend/src/game/render/EffectsDirector.ts`: replace the single `local` with a visuals lookup (`setVisualsLookup((id) => PlayerVisuals | undefined)` + `localId`). Per event:
  - Resolve visuals by `e.playerId`; drop the event if missing (player not joined yet / already left).
  - Tint, afterimage texture, `ignite()`, `pulse()` come from that player's visuals; attached effects use the visuals' live position (fallback `e.x/e.y`).
  - Shared emitters (puff, burst) set tint per explode (verify Phaser applies tint at emit time; otherwise per-colour emitters).
  - Afterimage timers become per-player (map by id) so two players dashing don't cancel each other.
  - `cameraFX.shake()` only when the local player is a collision participant.
  - Wisps already pooled; remote dashes share the pool (cap 220).
- `frontend/src/game/PlayerManager.ts`: put `playerId` (local id) on emitted events; collision passes `otherId` (the remote player's id from the collide callback). Expose `visualsFor(id)` for the lookup.
- `frontend/src/game/MainScene.ts` (composition root): build `EffectsDirector`, then `MessageBroker`, then `BroadcastingFeelSink(effects, broker, localId)` passed to `PlayerManager`; expose `effects` for the broker handler; wire the visuals lookup. (Order may need adjusting since `PlayerManager` is created before `MessageBroker` today.)

**Server — `src/MessageBroker.kt`**
- In `receive`: `"playerAction" -> broadcastToOthers("playerAction", message.data, session)`. Nothing else.

## Build order
1. [x] **Slice 1 — dash/stall/flap/recharge for remotes:** fx `feelEvents` + `actions` with tests → messages → EffectsDirector per-player → BroadcastingFeelSink + broker handler + MainScene wiring → server relay line.
2. [x] **Slice 2 — collision broadcast:** `otherId` + smaller-id rule + self-ignore (already in `actions` tests) → PlayerManager collide callback → bystander burst without shake.
Review after each slice (fx imports nothing outward; only DTOs cross the socket).

Delegation: client work to the phaser4-gamedev agent; the one-line Kotlin relay done directly.

## Tests
- Vitest `fx/actions.test.ts`: message round-trip for each kind; unknown kind / bad dir rejected; `shouldBroadcast` (local actions yes, collision only for smaller id); `shouldShowRemote` (own echoes and own collisions ignored, bystander collision shown).
- Existing 37 tests stay green.

## Verification
- `cd frontend && npx vitest run`, `npx tsc --noEmit` (pre-existing TS6133 `up` error only), capped build `NODE_OPTIONS=--max-old-space-size=2048 npm run build`.
- Backend compile per low-memory rules: `./gradlew compileKotlin -x npm_run_build -x npmInstall -Pkotlin.compiler.execution.strategy=in-process --max-workers=1` (not alongside the frontend build). The user restarts their backend to pick up the relay.
- Manual, two browser tabs in one room: in tab A dash/stall/jump/land → effects appear on A's orb in tab B (no camera shake in B); A bumps B → one burst in each tab, shake only for participants; with a third tab, a bystander sees exactly one burst per bump. Toggle Low in B → remote effects reduce.

## Open risks
- Remote positions are un-interpolated (32 TPS), so attached effects may look slightly steppy on remote orbs.
- Message rate: flap can be frequent; small JSON, acceptable for now.
- Clock skew means remote effects show ~one network latency late; acceptable.

## Implementation notes (client)
Deviations from the design above:
- `PlayerActionMessage` is defined in `fx/actions.ts`; `messages.ts` imports and re-exports it as a type, so fx imports nothing outward.
- The local player id is generated in `MainScene` (`PlayerManager.generatePlayerId` made public) and passed to `addPlayer`, so `BroadcastingFeelSink` can be built before the local player exists. Order: `EffectsDirector` → `MessageBroker` → `BroadcastingFeelSink` → `PlayerManager` → `setVisualsLookup` → `addPlayer`. `MainScene` exposes `effects` and `localId` for the broker handler; `PlayerManager.localVisuals` was replaced by `visualsFor(id)`.
- Flap puff and stall ring (one-shots) are also placed at the resolved visuals' position rather than `e.x/e.y`. Locally these are the same point (same sprite, same frame); for remotes it puts the effect on the orb as drawn instead of a network hop away. Collision still uses `e.x/e.y`.
- Phaser tint check: in Phaser 4.2.1 a static `tint` EmitterOp is read in `Particle.fire` via `onEmit` and `onUpdate` is `defaultUpdate` (keeps the particle's value), so `setParticleTint` right before `explode` colours only that burst. The shared puff emitter is re-tinted per flap; the burst emitter is untinted as before.
- `fromActionMessage` also rejects a collision whose `otherId` equals `playerId`, and non-finite coordinates.
- The local collision callback only emits when the other body maps to a known remote player (always true today).

