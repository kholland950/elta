# Custom key bindings + dash modifier

## Context
Every orb control is hard-coded in [PlayerManager.ts](frontend/src/game/PlayerManager.ts): Left/Right are Phaser `Key` objects (←/A, →/D), and Jump/Dash/Stall are latched from `event.code` sets (Space/↑, Shift L/R, E). The Esc options menu (ddaff67) has a disabled "Key bindings (coming soon)" row. This change lets players rebind the five race actions there, and turns Dash into a held modifier.

## Settled decisions
1. **Scope:** Left, Right, Jump, Dash and Stall can be rebound. Tab, V, R and Esc stay fixed.
2. **Dash is a held modifier.** A dash fires on a fresh Left/Right press while Dash is held, or on a fresh Dash press while a direction is already held. Holding never auto-repeats. Dash with no direction does nothing. Left/Right still steer normally while Dash is held. If both directions are held when Dash is pressed, the most recently pressed one wins.
3. **Two slots per action**, each rebindable. Defaults: ←/A, →/D, Space/↑, Shift L/Shift R, E/(empty).
4. **Bindings are stored by `KeyboardEvent.code`.** The menu shows the layout label from `navigator.keyboard.getLayoutMap()` when the browser has it, and a readable form of the code otherwise.
5. **Duplicates are allowed.** Any key bound to more than one slot shows in red on every slot that uses it, and nothing is swapped or refused.
6. **Editor:** a sub-screen of the Esc menu. It lists 5 actions × 2 slots with "Press a key…" capture (Esc cancels the capture), Reset to defaults and Back, using the menu's shared highlight model.
7. **Reserved keys:** Escape, Tab, Enter, NumpadEnter, V, R and the OS keys (MetaLeft, MetaRight, ContextMenu) are refused with a notice and capture keeps listening. Backspace or Delete during capture clears the slot, so those two can't be bound.
8. **Persistence:** localStorage, versioned JSON merged over the defaults. Corrupt or missing data falls back to the defaults.
9. **Out of scope:** gamepad bindings, hold/toggle options, profiles and rebinding menu-navigation keys.

## Layers

**Entity, movement rule: [movement.ts](frontend/src/game/race/movement.ts)**
- In `InputFrame`, replace `dashPressed: boolean` with `dash: 1 | -1 | 0`, the direction of a dash requested this step (0 means none).
- `stepPilot`: `if (input.dash !== 0 && next.dashes > 0)` sets `velocity.x = DASH_SPEED * input.dash`, sets `facing = input.dash`, and emits `{kind:'dash', dir}`. The stall → flap → dash order stays the same. `facing` is still updated from held direction.
- Update `NO_INPUT` and the dash cases in [movement.test.ts](frontend/src/game/race/movement.test.ts). The "dashes the last facing way when no direction is held" test is replaced: the facing fallback is gone.

**Entity, bindings: `frontend/src/game/input/bindings.ts`** (pure. The only import is the `KeyValueStore` type from [quality.ts](frontend/src/game/fx/quality.ts))
- `type Action = 'left'|'right'|'jump'|'dash'|'stall'`, `ACTIONS` (display order), `ACTION_LABELS` ("Jump"; the code keeps "flap" internally).
- `type Slot = 0|1`, `type Bindings = Readonly<Record<Action, readonly [string|null, string|null]>>`.
- `DEFAULT_BINDINGS`, `RESERVED`, `CLEAR_CODES`.
- `rebind(b, action, slot, code): Bindings`. A reserved or clear code returns `b` unchanged. `clearSlot(b, action, slot)`.
- `duplicates(b): ReadonlySet<string>`: codes held by more than one slot, which the menu shows in red.
- `parseBindings(raw: string|null): Bindings` reads `{version:1, actions}`. It ignores unknown actions, uses the default for a missing or malformed action, and empties a slot holding a reserved or non-string code.
- `loadBindings(store)` / `saveBindings(store, b)` use storage key `keyBindings` with the same try/catch pattern as `loadQuality`/`saveQuality`.

**Input state: `frontend/src/game/input/controls.ts`** (pure, no Phaser)
- `class Controls(bindings)` provides `setBindings`, `keyDown(code, repeat): boolean` (true if bound, so the caller can `preventDefault`), `keyUp(code)`, `frame(): InputFrame` (consumes latches), `clearLatches()` and `releaseAll()`.
- It tracks held codes, the last-pressed direction, and latched jump, stall and dash direction. A fresh direction press with Dash held latches `dash = thatDir`. A fresh Dash press with a direction held latches `dash = lastPressedHeldDir`. A key bound to several actions acts as all of them; for example, a key on both Dash and Right dashes right.
- `setBindings` calls `releaseAll`, so no key stays stuck under its old meaning.

**Adapters**
- [PlayerManager.ts](frontend/src/game/PlayerManager.ts):
  - Delete `FLAP_KEYS`/`DASH_KEYS`/`STALL_KEYS`, `controls.left/right` and the `addKeys('SPACE,UP,SHIFT,E')` capture. The Tab scoreboard key stays.
  - Phaser `ANY_KEY_DOWN`/`ANY_KEY_UP` feed `Controls` by `event.code`, and bound codes are `preventDefault`ed.
  - `step()` uses `controls.frame()`.
  - `clearLatches`/`releaseInput` delegate to `Controls`, and `Phaser.Core.Events.BLUR` calls `releaseAll()`.
  - The constructor takes the initial bindings, and `setBindings(b)` is public.
- [MainScene.ts](frontend/src/game/MainScene.ts): pass `loadBindings(window.localStorage)` into `PlayerManager`. Add `events.add('bindingsChanged', b => playerManager.setBindings(b))` next to `qualityChanged`/`menuOpen`, with a matching remove on DESTROY.
- `frontend/src/app/keyLabel.ts`:
  - `keyLabel(code, layout?)` uses the layout map for character keys and a table otherwise (arrows become ←→↑↓, ShiftLeft becomes "Left Shift", KeyQ becomes "Q", Digit1 becomes "1", Numpad4 becomes "Num 4", Space becomes "Space").
  - `loadLayoutMap()` wraps `navigator.keyboard?.getLayoutMap()` and returns undefined if it's unavailable or fails.
- `frontend/src/app/KeyBindingsMenu.svelte`:
  - The grid is `[2,2,2,2,2,1,1]`: five action rows with two slot buttons each, then Reset, then Back. It uses `move()` from [menuNav.ts](frontend/src/app/menuNav.ts) and `menuActionForKey` from [menuKeys.ts](frontend/src/app/menuKeys.ts), as [OptionsMenu.svelte](frontend/src/app/OptionsMenu.svelte) does.
  - Confirming a slot sets `capturing = {action, slot}` and the button reads "Press a key…". While capturing, the next non-repeat keydown is handled before navigation: Escape cancels, Backspace/Delete clears the slot, a reserved key shows "Tab is reserved", and anything else calls `rebind`.
  - Slots whose code is in `duplicates(b)` get a red `.duplicate` class with `title="Also bound to …"`. Notices are announced through `aria-live="polite"`.
  - Esc while not capturing goes Back to the options menu, not out of it.
  - Props: `bindings`, `onChange`, `onBack`. Styling copies OptionsMenu's single-highlight rules.
- [OptionsMenu.svelte](frontend/src/app/OptionsMenu.svelte): add `view: 'main'|'bindings'` and enable the Key bindings row. `onKeydown` returns early while `view === 'bindings'`, and Back restores the selection to that row. New props: `bindings`, `onBindings`.
- [Room.svelte](frontend/src/app/Room.svelte): `let bindings = loadBindings(localStorage)` and `setBindings` (save, then `events.send('bindingsChanged', b)`), mirroring `setQuality`.

## Dependency diagram
```
Room/OptionsMenu ─► KeyBindingsMenu ─► keyLabel
        │                 │
        └────────────────►├──────────► bindings ◄── controls ◄── PlayerManager ◄── MainScene
                                                       │
                                                       └──► movement (InputFrame, stepPilot)
```
`bindings.ts`, `controls.ts` and `movement.ts` import no Phaser, Svelte or DOM code. Only the adapters touch `localStorage`, `navigator` or Phaser.

## Build order (each slice is shippable)
1. **Dash modifier with default keys.** Change `movement.ts` and its tests, add `bindings.ts` (defaults and types) and `controls.ts` with tests, and port PlayerManager onto `Controls`. Today's keys still work, with the new dash feel.
2. **Persistence and live update.** Add parse/load/save with tests, the `bindingsChanged` event and the MainScene wiring.
3. **Menu UI.** Add `keyLabel.ts` with tests, `KeyBindingsMenu.svelte`, the OptionsMenu view switch and the Room wiring.
4. Copy this plan to `docs/plans/custom-keybindings.md`, tick the slices off, and record any deviations.

## Test strategy (vitest, no I/O)
- `movement.test.ts`: a dash fires in `input.dash` direction and updates facing; `dash: 0` does nothing; a dash with none left does nothing; stall plus dash in one step still gives a pure horizontal dash.
- `controls.test.ts`:
  - Held keys give left/right, and keyUp releases them.
  - Jump and stall latch once per fresh press, and repeats are ignored.
  - Dash held, then a fresh Right press, dashes right. Right held, then a fresh Dash press, also dashes right.
  - Dash alone does nothing. Holding Dash and Right gives no second dash on the next frame.
  - With both directions held, Dash goes the way pressed last.
  - A secondary slot works. A key bound twice drives both actions. `setBindings` releases held keys. An unbound code returns false.
- `bindings.test.ts`: the defaults; rebinding into empty and filled slots; reserved and clear codes are refused; `clearSlot`; `duplicates`, both within one action and across actions; parse with null, corrupt JSON, a wrong version, a partial save, a reserved code and a non-string code; load/save with a throwing store.
- `keyLabel.test.ts`: the table, the layout override and the fallback.

## Verification
- Following the WSL memory note, run the steps separately: `npx vitest run src/game/input src/game/race/movement.test.ts src/app`, then `npm test`, then `npm run build`.
- Manual check in the browser via the `run` skill (backend plus `npm run dev`):
  - Dash: Shift then →, and → then Shift, both dash. Shift alone does nothing.
  - Rebinding: rebind Jump to W and check that W flaps. Bind Stall to Space; both Jump and Stall slots should show red, and Space should do both. Esc and Tab during capture should cancel and be refused.
  - Reload and confirm the bindings persist, then use Reset to defaults.
  - Hold → and open the menu: nothing should stick after it closes.

## Status (2026-10-25)
- [x] Slice 1: dash modifier, `bindings.ts`, `controls.ts`, PlayerManager port
- [x] Slice 2: persistence + `bindingsChanged` live update
- [x] Slice 3: `keyLabel.ts`, `KeyBindingsMenu.svelte`, OptionsMenu/Room wiring
- [ ] Manual browser pass (see Verification)

Deviations:
- A capture that lands on a key already in use shows "X is also bound to Y" as well as the red mark.
- Jump and stall fire on each of their keys: pressing Space while ↑ is held flaps again. A second key of a direction or of Dash that is already held is not a fresh press.
- Mouse buttons are bindable (added after approval). They are stored as `Mouse<button>`, e.g. `Mouse2` for right click, and captured by clicking a mouse button while a slot reads "Press a key…". In play, a press on a page control (button, link, input) belongs to that control. The browser's right-click menu is turned off everywhere in a room.
