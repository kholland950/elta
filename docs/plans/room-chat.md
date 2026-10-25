# Room chat + quick chat

## Status
- [x] Slice 1: typed chat end to end, plus the HUD moves
- [x] Slice 2: quick chat on the keyboard, with reserved keys and the new binding defaults
- [x] Slice 3: D-pad quick chat and bubbles
- [ ] Manual two-tab playtest

### Deviations from the plan
- **D-pad routing.** The D-pad reaches quick chat through `gamepadHub.onQuickChat(listener)`, the same pattern as `onStart`, instead of a `sink.quickChat` method. The sink is the orb's `Controls`, which shouldn't know about chat. In play, D-pad presses never reach `Controls`.
- **Bubble anchor.** Bubbles always anchor to `PlayerManager.visualsFor(id)`. The victory lap moves the winner's real sprite, so `ReplaySequence` needed no getter.
- **Skip-vote position.** The skip vote sits at x=10 to line up with the chat panel's 10px left edge.
- **Colors module.** The player color map moved to `frontend/src/app/playerColors.ts`, which `Lobby.svelte` and `chatStore.ts` both use.
- **Send button focus.** The Send button keeps focus in the input on mousedown, so clicking it doesn't blur the input and close the chat first.

## Context
Players in a room have no way to talk to each other. This plan adds two things:
- **Typed chat:** opened with T or Enter, shown bottom-left.
- **Quick chat:** keys 1–4 or the D-pad, with phase-dependent line sets and speech bubbles over orbs.

To make room, the HUD location text moves to the bottom-right, and the skip-vote line moves to bottom-left under the chat.

## Settled decisions (Gate 1)
**Where chat works**
- Typed chat and quick chat work across the whole room (lobby, explore, countdown, race, replay, results).
- Solo play has no room, so no chat.

**Typed chat**
- T or Enter opens it and auto-focuses the input.
- Enter or the Send button sends. Empty Enter or Esc closes it.
- While it's open, game and gamepad input are released, using the Esc-menu path.
- Messages appear only in the log, never as bubbles.

**Safety and history**
- The server trims each message, caps it at 120 characters and drops it if empty.
- Each player is limited to 5 messages per 5 s; typed and quick chat share that budget.
- There is no profanity filter, and late joiners get no history.
- While chat is closed, the log fades about 8 s after the last message.

**Quick chat keys**
- Keys `1`–`4`, and on the pad the D-pad: Up=1, Right=2, Down=3, Left=4.
- These keys are fixed: `KeyT`, `Digit1-4` and `Pad12-15` are added to `RESERVED`.
- Pad14 and Pad15 are removed from the default left/right bindings (the stick steers). Saved bindings drop them automatically, because `parseSlot` rejects reserved codes.

**Quick chat lines**
- In-game set: Wow! / Nooo! / Too slow / WTF.
- Winner set: Nice try! / ez / Too slow / No problem.

**Quick chat by phase**

| Local phase | Who can send | Set | Shown as |
|---|---|---|---|
| Live (lobby free roam, explore, countdown, race) | everyone | in-game | log + bubble over the sender's orb |
| Replay beats (disintegrate, pause, zoomOut, replay) | everyone | in-game | log only |
| Celebration (zoomIn, victoryLap; finish rounds only) | round winner only | winner | log + bubble over the winner's lap orb |
| Results beat, results card, match-over | nobody | — | typed chat only |

- A round that times out or is skipped has no celebration, so its replay beats follow the replay row and its results follow the results row.

**Layout**
- Bottom-left, from bottom to top: the skip-vote line, then the chat input when it's open, then the chat log growing upward.
- Bottom-right: the location text (`lobby | free roam`, `round N | seed …`).

**Out of scope:** history, moderation and mute, typed bubbles, remappable chat keys, and typing on a gamepad.

## Architecture (sized to the feature, no extra interfaces)
Inner rules are pure and unit-tested. Adapters (protocol, connection, actor) and UI (Svelte, Phaser) depend on them, never the other way round.

### Entities / rules (pure)
- `src/chat/Chat.kt`
  - `sanitizeChat(raw): String?`: trim, strip control chars, cap at 120, null if empty.
  - `QUICK_LINE_IDS`: `wow, nooo, tooSlow, wtf, niceTry, ez, noProblem`.
  - `ChatThrottle`: a per-player sliding window of 5 messages per 5000 ms, `allow(playerId, nowMs): Boolean`. It is owned by the actor and forgets players who leave.
- `frontend/src/game/chat/quickChat.ts`
  - `QUICK_TEXT` (id → text), `IN_GAME_SET` and `WINNER_SET`.
  - `quickChatState({ beat: BeatKind | null, isRoundWinner }) → { set, bubble } | null` encodes the phase table. `beat` comes from `replayTimeline`: null means live. Any time after the timeline's end clamps to `results`.
  - The receiver uses the same function to decide whether to show a bubble.
- `frontend/src/game/chat/chatLog.ts`
  - `ChatEntry { playerId, name, color, text, quick, at }`.
  - `append` keeps the newest 50 entries.
  - `visible(log, now, open)` returns every entry when chat is open; otherwise it returns entries younger than 8 s, each with a fade alpha.

### Use case + adapters
- **Server protocol** (`src/ws/Protocol.kt`)
  - New client messages: `chat {text}` and `quickChat {id}`, decoded in `decodeClient`.
  - New server frame: `chatMessage {playerId, text, quick: Boolean}`. For a quick message, `text` is the line id.
- **Server actor** (`src/ws/RoomActor.kt`, `Command.Message` branch)
  - Chat bypasses the pure `Room`, because it doesn't change race state.
  - The handler sanitizes or whitelists the message and checks the throttle.
  - It broadcasts to all seats, including the sender, so every client sees the same order. The sender's `playerId` is stamped by the server.
- **Frontend wire** (`frontend/src/game/race/protocol.ts`, `net/RoomConnection.ts`)
  - Mirror the new types.
  - Add `sendChat(text)` and `sendQuickChat(id)`. These are not added to `QUEUED`, so they drop while disconnected.
- **Chat store** (`frontend/src/app/chatStore.ts`)
  - Subscribes to `chatMessage`.
  - Resolves name and color from the room's players, using the hex map from `Lobby.svelte:13-20`, moved to a shared module.
  - Folds messages through `chatLog`.

### UI / drivers
- **`frontend/src/app/Chat.svelte`** (mounted in `Room.svelte`)
  - A fixed bottom-left panel with the log, the input and a Send button.
  - T or Enter opens it via `svelte:window` keydown, ignored while the options menu is open. `preventDefault` stops the T from being typed.
  - It emits `events.send('chatOpen', bool)`.
  - Esc inside the input closes the chat and stops propagation, so the options menu doesn't open. The Esc handler in `Room.svelte` also checks that chat isn't open.
- **Input release**
  - `MainScene` handles `chatOpen` through the same release path as `setMenuOpen` (`MainScene.ts:200-212`).
  - `gamepadHub.setMenuOpen` is also set, so the D-pad doesn't quick chat while you're typing.
- **Quick chat triggers**
  - `Digit1-4` go in `MainScene`'s key handlers, next to V (`MainScene.ts:247`).
  - The D-pad is intercepted in `gamepadHub.toGame` (`gamepadHub.ts:151`) and sent to a new `sink.quickChat(slot)`.
  - Both call `quickChatState` and send only if it returns a set.
- **Bubbles** (`frontend/src/game/render/ChatBubbles.ts`)
  - One bubble per player, which follows the orb for 2.5 s; a new line replaces the old one.
  - The anchor is the live orb from `PlayerManager`, or the victory-lap orb from `ReplaySequence` during the celebration.
- **HUD moves**
  - `HUDScene.ts:52-56`: `stageInfo` moves to `(width-10, height-10)` with origin `(1,1)`.
  - `render/hud/RoundStatus.ts`: `votes` moves to `(10/16, height-10)` with origin `(0,1)`, left-aligned.
  - The chat panel's bottom offset leaves room for that line.
- **Bindings** (`game/input/bindings.ts`)
  - `RESERVED` gets `KeyT`, `Digit1`–`Digit4` and `Pad12`–`Pad15`.
  - The default pad slot for left/right becomes `null`.
  - The doc comment is updated.

## Dependency diagram
```
Chat.svelte / ChatBubbles / MainScene / gamepadHub   (UI, drivers)
          │                 │
     chatStore.ts      RoomConnection ── protocol.ts            RoomActor ── Protocol.kt
          │                 │                                        │
   chatLog.ts, quickChat.ts (pure) ── replayTimeline (pure)      Chat.kt (pure)
```
Every arrow points down, toward pure code. `Chat.kt`, `chatLog.ts` and `quickChat.ts` import nothing outward.

## Build order (vertical slices)
1. **Typed chat end to end:**
   - `Chat.kt` and its tests.
   - Protocol and actor changes, plus `RoomFlowTest`.
   - `protocol.ts` and `RoomConnection`.
   - `chatLog`, `chatStore` and `Chat.svelte`.
   - Input release and the Esc guard.
   - Moving the location text bottom-right and the votes bottom-left.
2. **Quick chat, keyboard:**
   - `quickChat.ts` and its phase-matrix tests.
   - The `Digit1-4` handler.
   - Reserved keys and the binding defaults.
3. **Quick chat on the pad, plus bubbles:**
   - D-pad routing in `gamepadHub` and its test.
   - `ChatBubbles` on live orbs and the victory-lap orb.

## Test strategy
**Server**
- `test/chat/ChatTest.kt`: sanitize edge cases, the whitelist, and the throttle window.
- `test/ws/RoomFlowTest.kt`, using the relay test at :126-150 as a template:
  - a chat message reaches both clients, with the sender's id stamped;
  - a bad quick id gets no response (`expectSilence`);
  - a sixth message inside 5 s is dropped.

**Frontend (vitest)**
- `quickChat.test.ts`: every row of the phase table, for both winner and non-winner, plus timeout and skip rounds.
- `chatLog.test.ts`: the cap and the fade.
- `bindings.test.ts`: the new reserved codes, and a saved `Pad14` on left that loads as empty.
- `RoomConnection.test.ts`: the new send methods, using `FakeSocket.sent`.
- `gamepadHub.test.ts`: the D-pad goes to `quickChat` and not to a game key.

**Running it** (low-memory WSL: run each step on its own)
1. `./gradlew test`
2. `cd frontend && npm test`
3. A frontend build on its own.
4. A manual two-tab check using the `run` skill:
   - chat open and close with T, Enter and Esc;
   - no movement while typing;
   - each phase's quick chat;
   - bubbles;
   - the bottom-left and bottom-right layout.

## Open risks
- **Winner set is client-gated.** The server doesn't check that a winner-set line comes from the round's winner, so a modified client could send "ez" at any time. That's acceptable for now.
- **Phase gating is local.** Clients' timelines can drift slightly, so a message sent at a beat boundary may show a bubble on one client and not another.
- **Frame size is unlimited.** `maxFrameSize = Long.MAX_VALUE` (`Application.kt:90`). The 120-character cap applies after the frame is decoded. Capping the frame size is a separate hardening task.
- **The victory-lap orb has to be reachable from `ReplaySequence`.** If it isn't exposed cleanly, a small getter is added there.
