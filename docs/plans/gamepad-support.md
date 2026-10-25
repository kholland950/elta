# Gamepad support

## Context
Players can only use keyboard and mouse today. Commit 37c1023 added custom key bindings but listed gamepad as out of scope (`docs/plans/custom-keybindings.md:15`). Goal: a standard (Xbox-layout) controller plays the game and drives the menus, and its buttons are remappable in the existing bindings menu. Keyboard and mouse keep working alongside it.

Settled decisions:
- **Left/right:** the left stick, with **analog** acceleration (scaled by tilt past a deadzone). The D-pad also moves, at full strength.
- **Default buttons:** A = jump, RB = stall, LB held = dash modifier (hold it and push a direction, same as the keyboard).
- **Remapping:** pad buttons can be remapped in Key Bindings. The stick stays fixed to left/right.
- **Menus:**
  - Start opens and closes the menu.
  - The D-pad and the stick move the highlight.
  - A confirms and B backs out.
  - Pad input to the game is blocked while the menu is open.
  - A button held over from play never fires in the menu.
- **Implementer:** the `phaser4-gamedev` agent, at your request.
- **Server:** no change. It never sees input; clients simulate their own orb and send position.

Out of scope: rumble, triggers as an analog stall, remapping the stick, per-pad player assignment (input from any connected pad is merged).

## Glossary
- **Pad code:** `Pad<N>`, using the Standard Gamepad button index (0 A, 1 B, 4 LB, 5 RB, 8 View, 9 Start, 12–15 D-pad).
- **Pad slot:** the third binding slot per action, which accepts only pad codes.
- **moveX:** horizontal input from -1 to 1 (replaces the `left`/`right` booleans).

## Design (layers match the existing layout; no new abstractions)
**Core (pure TS, no DOM or Phaser):**
- `frontend/src/game/race/movement.ts`
  - `InputFrame.left`/`right` become `moveX: number`.
  - `accelX = moveX * ACCELERATION`.
  - `facing = sign(moveX)` when non-zero.
- `frontend/src/game/input/bindings.ts`
  - `Bindings` becomes a 3-tuple per action, with `PAD_SLOT = 2`, plus `padCode` and `isPadCode`.
  - Pad defaults: left Pad14, right Pad15, jump Pad0, dash Pad4, stall Pad5.
  - Reserved: Pad9 (Start), Pad16 (Home), Pad1 (B = cancel/back). Pad8 (View) clears a slot.
  - `captureOutcome(slot, code)` returns `bind | cancel | clear | reserved | wrongDevice`. `rebind` applies the same device check.
  - Storage moves to `version: 2`. A v1 save keeps its keyboard/mouse slots and gets the pad defaults. A code saved in the wrong-device slot is dropped.
- `frontend/src/game/input/controls.ts`
  - Pad codes flow through the existing `keyDown`/`keyUp`, so latches, dash and remaps work unchanged.
  - New `setStick(x)`.
  - `frame()` sets `moveX` to the digital direction if one is held (keys or D-pad), otherwise to the stick value.
  - The stick crossing |x| ≥ 0.5 (released below 0.35) counts as pressing a direction, so held-dash works with the stick. Factor this into `pressDir`/`releaseDir`.
  - `releaseAll` zeroes the stick.
- `frontend/src/game/input/gamepad.ts` (new)
  - `PadLike` snapshot type and `mergePads` (any connected pad; a button is down when `pressed || value > 0.5`).
  - `stickX`: deadzone 0.2, saturates at 0.95, linear in between. Constants go in `tuning.ts`.
  - `PadReader.poll(pads, nowMs)` returns `{downs, ups, stickX, menu}` from button edges, with no per-frame allocation.
  - On disconnect, the reader emits ups for every held button.
  - `reset()` takes what is held now as the baseline. The stick doesn't push the menu until it returns to centre, but it steers the game straight away (see Deviations).
  - `MenuRepeater` handles the D-pad and stick (dominant axis, enters at 0.5, releases at 0.35). Repeats come at 400 ms, then every 120 ms. A → confirm, B → back, LB/RB → prev/next.

**Glue:**
- `frontend/src/game/input/gamepadHub.ts` (new, module singleton)
  - Owns its own `requestAnimationFrame` loop over `navigator.getGamepads()`. It doesn't use the Phaser gamepad plugin, because the Svelte menus need the pad while Phaser input is off.
  - API: `start`/`stop`, `setGameSink`, `pushMenu(handler) → pop`, `setMenuOpen`, `onStart`.
  - When `menuOpen` changes, it calls `releaseAll`, `reader.reset()` and resets the repeater.
  - While the tab is hidden or the window is blurred, it releases and resets.
  - It does not use `app/events.ts`, which allows one listener per name, and `MainScene` already holds those.
- `frontend/src/game/PlayerManager.ts` registers the game sink and clears it on SHUTDOWN.
- `frontend/src/app/Room.svelte` calls hub `start`/`stop` and `$: gamepadHub.setMenuOpen(menuOpen)`. `onStart` toggles `menuOpen` unless the session was rejected.
- `frontend/src/app/padMenu.ts` (new): `usePadMenu(handler)` pushes on mount and pops on destroy.
- `frontend/src/app/OptionsMenu.svelte` and `frontend/src/app/KeyBindingsMenu.svelte`
  - Move the `onKeydown` body into `apply(action)`, shared by the keyboard and the pad.
  - KeyBindingsMenu:
    - Gets a third "Pad" column (grid `[3,3,3,3,3,1,1]`).
    - Capture switches on `captureOutcome`.
    - Its pad `button()` handler takes over pad presses while capturing.
    - Shows a "Press a pad button" / "Press a key" notice when the wrong device is used.
- `frontend/src/app/keyLabel.ts`: pad button names (A, B, X, Y, LB, RB, LT, RT, View, Menu, LS, RS, D-pad arrows; anything else shows as `Pad N`).

Dependencies point inward. The core files import nothing from the DOM, Phaser or Svelte. The hub and the Svelte/Phaser files depend on the core.

## Build order (thin slices; run tests at the end of each)
1. [x] **The pad plays the game with default buttons:** movement `moveX`, bindings with the 3rd slot and v2 storage, controls with stick and dash, `PadReader`, the hub with game sink and menu blocking, wiring in PlayerManager and Room. KeyBindingsMenu temporarily shows only slots 0–1.
2. [x] **Pad remapping:** keyLabel pad names, hub `pushMenu` with `button()` routing, the KeyBindingsMenu Pad column and capture.
3. [x] **The pad drives the menus:** `MenuRepeater`, hub action routing and Start, `padMenu.ts`, `apply(action)` refactor in both menus.

When the plan is approved, copy it to `docs/plans/gamepad-support.md` (that's where the repo keeps plans) and tick off slices there.

## Deviations (recorded during implementation)
- **The menu vector isn't part of `poll()`.** `PadReader.poll(pads)` returns `{downs, ups, stickX}` and takes no `nowMs`. The menu push (D-pad as ±1, else the guarded stick) comes from `reader.menuPush()`, which the hub reads *after* routing presses. The hub owns the `MenuRepeater` and gives it the rAF timestamp. Reason: a hub test showed that a vector computed inside `poll()` still held a D-pad press that the capture had just taken and suppressed. So binding a D-pad direction also moved the highlight.
- **`padMenu.ts` arrived in slice 2, not slice 3.** The KeyBindingsMenu pad capture needs it to push its `button()` handler.
- **The pad is ignored while the window is away, not just released.** The hub keeps polling so that what's held becomes the baseline, but it routes nothing while the window is blurred or the tab is hidden. It releases and resets again on return. Reason: browsers can keep reporting pads to a background page, and the keyboard gets no events there either.
- **`setGameSink(sink)` returns an unregister function.** That function only clears the sink if it is still the current one. PlayerManager calls it on `DESTROY` as well as `SHUTDOWN`. Reason: `game.destroy()` (Room unmount) emits only `DESTROY` in Phaser 4.2. Note that PlayerManager's existing window mouse listeners and its `BLUR` listener are removed only on `SHUTDOWN`, so they outlive a destroyed game. That predates this change and isn't fixed here.
- **`reset()` only guards a stick that is off-centre at that moment.** A stick resting at centre needs no return trip.
- **Stick thresholds live in `tuning.ts`.** That's `STICK_DEADZONE`, `STICK_SATURATION`, `STICK_PRESS` (0.5) and `STICK_RELEASE` (0.35). The menu repeat constants (0.5/0.35, 400/120 ms) stay private to `gamepad.ts`.
- **`captureOutcome` checks in this order:** cancel (Esc, B), clear (Backspace, Delete, View), wrongDevice, reserved, bind. Either device can cancel or clear. A key in the Pad slot reads "Press a pad button", and a pad button in a key slot reads "Press a key or mouse button", because those slots take mouse buttons too.
- **Smaller binding slots.** Slot buttons shrank from 8rem to 7rem min-width so three columns fit.
- **`navigator.getGamepads` is wrapped in try/catch.** Browsers leave it out on insecure origins, and a permissions policy can block it. Either way the hub sees no pads.
- **Extra test file `gamepadHub.test.ts`.** It stubs `window`, `document`, `navigator` and rAF. It covers menu blocking, menu actions, held-over buttons and the stick, Start, a capturing screen taking presses, blur, and sink replacement. To allow this, `GamepadHub` is exported as a class next to the singleton.
- **Stick steers straight after the menu closes** (user feedback after PR #53): holding the stick while pressing B to close the menu should move the orb at once. The recentre guard now applies only to menu navigation; buttons held across the switch still stay quiet.

## Tests (Vitest, pure, colocated `*.test.ts`, with a `fakePad({...})` builder)
- **gamepad.test.ts:**
  - Button edges across polls.
  - Buttons already held at `reset` don't fire.
  - A trigger at 0.6 counts as down.
  - Merging multiple pads.
  - Disconnect emits ups.
  - Stick recentre guard.
  - Deadzone and saturation values.
  - Repeater timing driven by explicit `nowMs`.
- **controls.test.ts:**
  - Holding Pad4 and moving the stick to 0.6 latches a dash of +1.
  - A stick at 0.4 steers (`moveX` ≈ 0.27) but doesn't dash.
  - Digital input overrides the stick.
  - `releaseAll` zeroes the stick.
- **bindings.test.ts:**
  - A v1 save migrates.
  - Wrong-device codes are dropped on parse.
  - `captureOutcome` table.
  - `rebind` refuses a pad code in slot 0 or 1.
- **movement.test.ts:** switch the `{right:true}` helpers to `moveX`, and check that `moveX: 0.5` gives accelX 1500.
- **keyLabel.test.ts:** pad names.

## Verification
- Tests (low-memory WSL; run as separate steps, no Gradle):
  - `cd frontend && npx vitest run src/game/input src/game/race/movement.test.ts src/app`
  - then `NODE_OPTIONS=--max-old-space-size=1536 npm run build`
- Manual, in Chrome on localhost with an Xbox-style pad (press any button first to wake the Gamepad API):
  1. **Movement:**
     - A half-tilted stick is slower than full tilt.
     - The D-pad is full speed.
     - A jumps and RB stalls.
     - LB + D-pad, LB then a stick flick, and stick then LB all dash.
     - Keyboard and mouse still work at the same time.
  2. **Opening the menu:** Start opens it with A held, and the orb doesn't jump. The D-pad and stick move the highlight with repeat. A confirms, B backs out of Key Bindings and then closes the menu, and Start closes it.
  3. **Key Bindings:**
     - A on a Pad cell, then X, binds X.
     - B cancels and View clears.
     - Using the wrong device shows the notice.
     - Bindings persist across a reload.
     - An old v1 save keeps its custom keys.
  4. **Nothing gets stuck:** holding the stick while closing the menu moves the orb straight away; holding it while opening the menu doesn't move the highlight until it recentres. Alt-tabbing or unplugging the pad with a button held leaves nothing stuck.
