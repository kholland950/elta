# Player customization

## Status
- [x] Slice 1: 32-color palette and tinted orbs
- [x] Slice 2: random profile, no join form
- [x] Slice 3: Customize screen from the main menu
- [x] Slice 4: customizing in the room (lobby only)

### Deviations from the plan
- **Tint mode:** the orb uses `Phaser.TintModes.SCREEN`, not the default multiply. `OrbLight.png` holds BlueLight's whiteness, taken from its red channel, as gray. With a screen tint the result is tint·(1−s)+s, which reproduces the original art exactly in any color. The trail emitters use the same mode through `tintMode`.
- **Relative imports:** `game/profile/*` and `chatStore.ts` use relative imports, because vitest has no `game/` path alias.
- **Seat name:** RoomActor's `Seat.name`, which is only used in logs, follows profile updates.
- **Customize button outside the lobby:** the button stays in the menu, marked "lobby only" and inert. If a match starts while the panel is open, the panel closes itself.
- **When a profile is created:** a new player's random profile is made the first time they open Customize or enter a room, not when the main menu loads.

## Context
- New players get an empty name field and an empty color dropdown on every join (`JoinRoom.svelte`). There are only 6 colors, picked from a plain `<select>`.
- A player can't change their name or color once they are in a room. The server has no message for it.
- The palette is defined in 3 places, and two of them don't match:
  - `app/playerColors.ts`
  - `ORB_COLORS` in `render/PlayerVisuals.ts`
  - six colored PNGs, `{Color}Light.png`
- Goal: every player starts with a random, valid profile. One Customize screen shows a live orb that jumps and a visual picker with 32 colors. It opens from the main menu, and from the Escape menu while the room is in the lobby.

## Settled decisions (Gate 1)
- **Random name:** the `unique-names-generator` npm package, with its adjective and animal dictionaries. Names are PascalCase with no separator, for example `SwiftOtter`. We re-roll until the name passes the server rule: 2–15 characters, matching `^[\w ]+$`.
- **When randomizing happens:** only when the saved name or color is missing or invalid. It is saved straight away. There are no re-roll buttons.
- **Join flow:**
  - The JoinRoom form goes away. Create and Join go straight to `/room/:id`.
  - `/joinroom/:id` stays only as a redirect to `/room/:id`.
  - On the Rejected screen, "Change name" opens `/customize?next=/room/:id`.
- **Customize screen:**
  - Contents: a name field, a grid of 32 orb swatches, a live preview, and Save / Back.
  - Save is disabled while the name is invalid. Back or Esc throws the edits away.
- **Colors:**
  - 32 neon hues spaced evenly around the wheel.
  - Each color is a named string, in one TS palette and one Kotlin palette, with a parity test between them.
  - The 6 existing names are kept, so saved values stay valid.
  - Two players may have the same color.
- **Textures:** one neutral white orb, `OrbLight.png`, tinted with `setTint`, replaces the 6 colored PNGs. The DOM swatches use the same PNG as a CSS `mask-image` over the hex color.
- **Preview:**
  - A small Phaser canvas that reuses `PlayerVisuals`.
  - It runs real arcade physics: a floor, a hidden body, and `stepPilot` (`race/movement.ts`) fed a jump input about every 1.5s.
- **In-room editing:**
  - The Escape menu gets a Customize row, enabled only while `Phase.Lobby`.
  - A new `updateProfile` message is validated on the server and broadcast as room state. Every client rebuilds the orb visuals that changed.

### Palette (hue = i × 11.25°, about hsl(h, 100%, 62%); exact hex values are pinned in tests)
Red, Scarlet, Vermilion, Orange, Amber, Yellow, Citrine, Lime, Chartreuse, Leaf, Clover, Emerald, Jade, Green, Mint, Seafoam, Aqua, Cyan, Sky, Blue, Cobalt, Sapphire, Indigo, Iris, Violet, Amethyst, Purple, Orchid, Magenta, Fuchsia, Rose, Crimson.

The six existing names (Red, Orange, Yellow, Green, Blue, Violet) land close to their old hues.

## Architecture (sized to the feature; the only ports are KeyValueStore and a name-generator function)

### Entities / rules (pure TS, `frontend/src/game/profile/`)
- `palette.ts`
  - `ORB_PALETTE: readonly {name, hex:number}[]`
  - `isPaletteColor(name)`, `colorHex(name)` (number, for Phaser), `colorCss(name)`
  - Replaces `app/playerColors.ts` and `ORB_COLORS`.
- `profile.ts`
  - `Profile {name, color}`
  - `validName(name)`, with anchors, matching `Room.kt`. The two copies of the regex in `JoinRoom` and `Room.svelte` are removed.
  - `validProfile(p)`

### Use cases (pure TS, same folder)
- `profileStore.ts`
  - `loadProfile(store: KeyValueStore, genName: () => string, rng: () => number): Profile` reads the `'name'` and `'color'` keys. It replaces whatever is missing or invalid, saves the result, and returns a valid profile.
  - `saveProfile(store, profile)`
  - `KeyValueStore` is reused from `game/fx/quality.ts`, following the same try/catch pattern.

### Adapters
- `profile/randomName.ts` wraps `unique-names-generator` (`style: 'capital'`, `separator: ''`) and loops until `validName`. It is the only file that imports the package.
- **Protocol:**
  - `race/protocol.ts` adds `updateProfile {name, color}`.
  - `RoomConnection.updateProfile(p)` sends it and updates `opts`, so a reconnect's `joinRoom` carries the new profile.
- **Rendering:**
  - `MainScene` loads only the `orb` texture.
  - `PlayerVisuals` takes `color` and uses the `orb` texture with `setTint(colorHex)` for the orb, the halo and the trail particles.
  - The same switch to the `orb` texture applies to `PlayerManager.createSprite` and `EffectsDirector:221`.
  - When room state changes a player's name or color, `PlayerManager` destroys and recreates that player's visuals. This covers the local player too.
- **Server (Kotlin):**
  - New `src/race/Palette.kt` holds `ORB_COLORS` (the 32 names) and replaces `Room.COLORS`.
  - New `Room.updateProfile(playerId, name, color): Step`. It returns an unchanged `Step` when the phase isn't Lobby or the input is invalid; otherwise it updates the player and emits `StateChanged`.
  - `Protocol.kt` gets `UpdateProfile` and its decode branch. `RoomActor` routes it the way it routes `UpdateSettings`.

### UI / drivers (Svelte + Phaser)
- `game/preview/PreviewScene.ts` + `startPreview(parent, profile)`
  - Builds a small `Phaser.Game` with an arcade world (GRAVITY, STEP_HZ), a static floor, a hidden sprite and `PlayerVisuals`.
  - `stepPilot` runs on `worldstep`, with jump pressed for a few steps every ~1.5s.
  - `setProfile()` rebuilds the visuals. Name changes are debounced.
- `app/OrbPreview.svelte` mounts the preview and destroys the Phaser game when it unmounts.
- `app/CustomizePanel.svelte`
  - Props: `profile`, `onSave`, `onBack`.
  - Contents: name input, an 8×4 swatch grid (CSS mask of `OrbLight.png`, with the selected swatch ringed and scaled up), `OrbPreview`, Save / Back.
  - Keyboard and pad navigation use `menuNav` / `usePadMenu`.
  - Used by both of the next two screens.
- `app/Customize.svelte`: the `/customize` route. It saves with `saveProfile`, then goes to `?next=`, or `/` when there is none.
- **Edits to existing screens:**
  - `App.svelte`: add the `/customize` route, and turn `/joinroom/:id` into a redirect.
  - `Main.svelte`: add a Customize button, and send Create/Join straight to `/room/:id`.
  - `Room.svelte`: call `loadProfile`, which removes the validation redirect, and colors the scoreboard dot with `colorCss`.
  - `OptionsMenu.svelte`: add a Customize row and a `view === 'customize'` branch. The row is disabled when the phase isn't Lobby. A new `onSaveProfile` prop is handled by Room, which saves the profile and calls `conn.updateProfile`.
  - `Rejected.svelte`: link to Customize.
  - `Lobby.svelte` and `chatStore.ts`: switch to `colorCss`.
- **Deleted:** `JoinRoom.svelte`, `playerColors.ts`, and the six `assets/{Color}Light.png` files.
- **New asset:** `assets/OrbLight.png`, generated once from `BlueLight.png` by a throwaway pure-Python PNG script (PIL isn't installed). The script desaturates the image and normalizes its brightest pixel to white, so tinting it brings back the old look.

## Dependency diagram
```
Svelte screens / PreviewScene / MainScene / PlayerManager   (drivers)
        │                         │
        ▼                         ▼
 RoomConnection, randomName (adapter → unique-names-generator), localStorage
        │                         │
        ▼                         ▼
          profileStore (loadProfile / saveProfile)  ── port: KeyValueStore, genName fn
                          │
                          ▼
              profile.ts, palette.ts  (no imports)
Kotlin: RoomActor/Protocol → Room.updateProfile → Palette.kt
```
`profile/palette.ts`, `profile.ts` and `profileStore.ts` import nothing from Phaser, Svelte or the npm package.

## Build order (vertical slices)
1. **32-color palette and tinted orbs**
   - Add `palette.ts` and `Palette.kt` with parity tests.
   - Generate `OrbLight.png`, and switch MainScene, PlayerVisuals, PlayerManager and EffectsDirector to tinting.
   - Switch Lobby, chat and the scoreboard to `colorCss`.
   - Keep the JoinRoom select working for now, filled from the palette.
2. **Random profile, no join form**
   - Add `profile.ts`, `profileStore.ts`, `randomName.ts` and the npm dependency.
   - Room uses `loadProfile`. Main navigates directly, `/joinroom` redirects, and `JoinRoom.svelte` is deleted.
3. **Customize screen from the main menu**
   - Add PreviewScene, OrbPreview, CustomizePanel, the `/customize` route, and the Main and Rejected buttons.
4. **Customizing in the room**
   - Server: `Room.updateProfile`, Protocol and RoomActor.
   - Client: protocol, `RoomConnection.updateProfile`, PlayerManager rebuilding visuals, and the OptionsMenu row and view, disabled outside Lobby.

## Test strategy
- **Unit tests (vitest, no I/O):**
  - `palette.test.ts`: 32 unique names, includes the 6 legacy names, hex values pinned.
  - `profile.test.ts`: validName edge cases (1/2/15/16 characters, symbols, spaces).
  - `profileStore.test.ts`: an in-memory store with a fixed `genName` and `rng`. Covers missing, invalid name, unknown color, an untouched valid profile, a store that throws, and saving.
  - `randomName.test.ts`: 500 generated names are all PascalCase and pass `validName`.
  - `RoomConnection.test.ts`: `updateProfile` sends the message, and a reconnect `joinRoom` carries the new profile.
- **Kotlin:**
  - `PaletteTest`: the names match `frontend/src/game/profile/palette.ts`, parsed by regex.
  - `RoomTest`:
    - In Lobby, `updateProfile` changes the player and emits `StateChanged`.
    - During Round or Results, and for a bad name, an unknown color or an unknown player, the room is unchanged and nothing is emitted.
    - `join` accepts a new color such as `"Cyan"`, which is now in the palette.
  - `RoomFlowTest`: the socket sends `updateProfile`, and the other client receives the new state.
- **Manual (run skill):**
  - First visit in a clean profile gives a random name and color.
  - Customize from Main: the preview hops, swatches switch the color, Save persists it and Back discards.
  - Two browsers in one room: change color in the lobby through Esc → Customize, and the other client's orb, label, Lobby dot and chat color update.
  - The row is disabled mid-race.
  - The pad can move through the swatch grid.

## Verification commands
Build in separate capped steps, because the WSL VM is low on memory:
- `cd frontend && npx vitest run`
- `./gradlew test`
- `npm run build`

Then run the app and work through the manual checks.

## Open risks
- **Bundle size:** `unique-names-generator`'s animal and adjective dictionaries add roughly 20–40KB minified. Check the output size after slice 2.
- **Telling colors apart:** neighboring hues 11° apart will be hard to distinguish, especially for color-blind players. You chose neon hues only; the name label still identifies each player.
- **Tinting changes the look:** a tinted white orb may look slightly different from the hand-colored PNGs. Compare them side by side in slice 1.
- **Old clients:** an old client receiving a new color name loads a texture it doesn't have. That's acceptable, because the build check (StaleBuild) already rejects mismatched builds.
- **Preview cost:** a second Phaser instance runs on the Customize screen, including inside the Room's Escape menu while the main game is running. Use a small canvas and stop it when the screen unmounts.
