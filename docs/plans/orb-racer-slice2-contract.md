# Orb Racer slice 2: interface contract

This is the single source of truth for every seam between agents in slice 2. If you need to change it, stop and report the change instead of making it. The overall design is in `orb-racer.md`.

Ownership:
- **kotlin**: everything under `src/` and `test/`.
- **frontend**: the pure parts of `frontend/src/game/race/` (`protocol.ts`, `clockSync.ts`, `session.ts`), `frontend/src/game/net/`, `frontend/src/app/`, `frontend/src/main.ts`, and the rollup config.
- **phaser**: the rest of `frontend/src/game/` (scenes, `PlayerManager`, `RaceDirector`, `render/`, `stage/`, `Game.ts`).

## 1. Wire protocol (kotlin ⇄ frontend)

Every frame is JSON `{"event": string, "data": object}`. Times are **server epoch ms** (a JSON number; `Long` in Kotlin). Player ids are opaque strings assigned by the server.

### Client → server
| event | data | rules |
|---|---|---|
| `joinRoom` | `{roomId: string, name: string, color: string, build: string, resumeToken?: string}` | Must be the first frame. With `resumeToken`, reattaches to a held seat (§7). `roomId` matches `^[a-z0-9]{4,12}$`. `name` is 2–15 characters matching `^[\w ]+$`. `color` is one of `Blue Green Orange Red Violet Yellow`. |
| `clockPing` | `{t0: number}` | Any time after `joined`. |
| `updateSettings` | `{winsToMatch: 1\|3\|5\|7, difficulty: 1..10}` | Host only, lobby only. Anything else is silently ignored. |
| `startMatch` | `{}` | Host only, lobby only. Works with ≥1 player. |
| `voteSkip` | `{round: number}` | Counted only for the current round while it is running. One vote per player, idempotent. |
| `finishReport` | `{round: number, raceTimeMs: number}` | `raceTimeMs` is a float. See §3. |
| `playerMove` | `{playerId, x, y, velocityX, velocityY}` | Unchanged shape. The server **overwrites `playerId` with the sender's id** and relays it to the rest of the room only. |
| `playerAction` | `{playerId, kind, x, y, dir?, otherId?}` | Unchanged shape. The server overwrites `playerId` and relays it to the rest of the room only. |

### Server → client
| event | data | when |
|---|---|---|
| `joined` | `{playerId, roomId, serverTime, resumeToken}` | Reply to an accepted `joinRoom`. It is followed immediately by `roomState`, sent to everyone. |
| `joinRejected` | `{reason: "inProgress"\|"full"\|"badName"\|"staleBuild"\|"expired"}` | Reply to a rejected `joinRoom`. The server then closes the socket. |
| `clockPong` | `{t0, serverTime}` | Reply to `clockPing`. `t0` is echoed back. |
| `roomState` | `{roomId, hostId, phase: "lobby"\|"match", settings: {winsToMatch, difficulty}, players: [{id, name, color, wins}]}` | Sent to everyone on any change to membership, host, settings, phase or wins. `players` is in join order. |
| `playerLeft` | `{playerId}` | Sent to the rest of the room when a player leaves (a clean close, or a held seat running out; §7), before the `roomState` that follows. |
| `roundStart` | `{round, seed, difficulty, startOrder: [playerId], exploreAt, snapAt, goAt}` | Sent to everyone at the start of each round. `round` counts from 1 within a match. |
| `skipVotes` | `{round, votes, needed}` | Sent to everyone whenever the vote count or `needed` changes during a round. |
| `roundEnd` | `{round, winnerId: string\|null, reason: "finish"\|"timeout"\|"skipped", times: [{playerId, raceTimeMs}], wins: {[playerId]: number}, nextRoundAt: number\|null, matchWinnerId: string\|null}` | Sent to everyone. `times` holds the reports the server accepted, sorted by time. On match end, `matchWinnerId` is set and `nextRoundAt` is `null`. |

## 2. Server rules (kotlin; also what the frontend can rely on)
- **Rooms:**
  - A room is created on its first join and deleted once it is empty.
  - It holds at most **8** players. A 9th gets `full`.
  - A join while `phase == "match"` gets `inProgress`.
  - A malformed name or colour gets `badName`.
  - **Build:** the room stores the `build` of whoever created it. A later join with a different `build` gets `staleBuild`.
- **Host:** the first player to join. When the host leaves, the next player in join order becomes host.
- **Settings:** default to `{winsToMatch: 3, difficulty: 4}`.
- **Seed:** a random integer in `[1, 2147483646]`.
- **Difficulty for a round:** `min(10, base + min(roundIndex, 3))`, where `roundIndex` is 0-based (round 1 → base).
- **Timings:** these are injectable, and tests use short values.
  - `exploreAt = now + 500` (a short lead so every client receives the message in time)
  - `snapAt = exploreAt + 15000`
  - `goAt = snapAt + 3500` (500 ms snap, then the 3000 ms countdown; this matches `race/round.ts`)
  - `startOrder` is a random shuffle of the current players.
- **Finish:**
  - A report is accepted only for the current round, after `goAt`, with `0 < raceTimeMs ≤ (now − goAt) + 500`, and only once per player.
  - The first accepted report opens a **150 ms** window. When it closes, the lowest `raceTimeMs` wins; on a tie, the earlier arrival wins.
- **Timeout:** at `goAt + 120000` with no accepted report, `roundEnd` is sent with `reason: "timeout"` and `winnerId: null`.
- **Skip:**
  - `needed` is the number of players currently in the room.
  - The round is skipped when `votes ≥ needed`, which ends it with `reason: "skipped"` and `winnerId: null`.
  - A player leaving recomputes both `needed` and the votes, and can trigger the skip.
- **After `roundEnd`:**
  - If `wins[winner] == winsToMatch`, the match is over. After `5000` ms the phase returns to `"lobby"`, wins reset to 0, and `roomState` is sent.
  - Otherwise the next `roundStart` comes at `nextRoundAt = endAt + 5000`.
- **Last player leaves mid-match:** the room is deleted.

## 3. Client race clock (phaser ⇄ frontend)
- `serverNow()` is local `performance.now()` plus the offset from `clockSync`.
- Phases are worked out with `roundPhaseAt(plan, connection.serverNow())`, using the existing `race/round.ts`.
- **Race time** for `finishReport` is measured from the client's own GO step (`steps × stepMs` plus the crossing fraction), exactly as in slice 1. It is not `serverNow() − goAt`.

## 4. Client internal API (frontend implements it, phaser consumes it)
- The file `frontend/src/game/race/protocol.ts` holds every wire type above. It is already written; extend it only with the agreement of both sides.
- The file `frontend/src/game/net/RoomConnection.ts` is already written with the public API below and stub bodies. **frontend** implements the bodies and must not change the signatures. **phaser** codes against the signatures.

```ts
class RoomConnection {
  constructor(opts: { roomId: string; name: string; color: string; url?: string })
  readonly roomId: string
  get playerId(): string | null              // set once `joined` arrives
  serverNow(): number                        // performance.now() + clock offset
  on<E extends ServerEvent>(event: E, cb: (data: ServerMessages[E]) => void): () => void  // multi-listener; returns unsubscribe
  sendMove(m: Omit<PlayerMoveMessage, 'playerId'>): void
  sendAction(m: Omit<PlayerActionMessage, 'playerId'>): void
  reportFinish(round: number, raceTimeMs: number): void
  voteSkip(round: number): void
  updateSettings(s: RoomSettings): void
  startMatch(): void
  close(): void
}
```
- **Connecting:**
  - The constructor connects at once to `/ws/game` (same host; `ws:` or `wss:` following the page) and sends `joinRoom` with the build id.
  - Once `joined` arrives, it runs 5 clock pings 100 ms apart. It sends 1 more ping on every `roundStart`.
  - Messages that arrive before a listener subscribes are **not** replayed. Phaser should subscribe synchronously in `MainScene.create`. Svelte reads state from `roomStore`, which subscribes in its factory.
- **`app/roomStore.ts`** (frontend): `createRoomStore(conn): Readable<SessionState>`, built on the `reduceSession` reducer in `race/session.ts`. `SessionState` includes at least `me`, `roomId`, `hostId`, `phase`, `settings`, `players`, `currentRound` (a `roundStart` or null), `lastRoundEnd`, `skipVotes`, and `rejected` (a reason or null).
- **`startGame(conn: RoomConnection)`** in `Game.ts` (phaser) replaces the old `startGame()`. `Room.svelte` is the composition root: it creates the connection, the store and the game, and calls `conn.close()` and `game.destroy()` when it is destroyed. `main.ts` loses the `location.hash` auto-start.
- **Who draws what:**

| Owner | Draws |
|---|---|
| **phaser** | The world and every in-game HUD element: the explore time remaining, snap, 3-2-1 countdown, race timer and vote count. Also the finish effects: other orbs disintegrate and the winner celebrates. |
| **frontend** (Svelte overlays) | The **Lobby panel**: player list, host badge, host-only settings and Start, and a room link to copy. It shows while `phase == "lobby"`. The **RoundResults panel**: winner, times, win tally, and a match winner banner. It shows from `roundEnd` until the next `roundStart`, or until the lobby returns. The **Rejected screen**, with the reason and a way back. Overlays must not take keyboard focus (blur on click; Space flaps). The existing Tab scoreboard and quality toggle stay. |

- **Lobby sandbox (phaser):** while `phase == "lobby"`, or before any `roundStart`, the scene runs stage `seed 0, difficulty 1` as free roam. There is no countdown and no timer. R does nothing in multiplayer, and the solo `?seed=` mode stays only when there is no connection.
- **Remote orbs (phaser):** created from `roomState.players` (excluding `me`), positioned from their first `playerMove`, and removed on `playerLeft`. The `newPlayer` and `gameState` messages are gone.
- **V key (phaser):** calls `conn.voteSkip(currentRound)` while a round is running. The HUD shows `votes/needed`.
- **Events bus (`app/events.ts`):** stays only for Phaser → Svelte UI signals (`showScoreboard`) and Svelte → Phaser (`qualityChanged`). Room data goes through the connection and the store, never the bus.

## 5. Addendum: return to lobby (2026-10-23)

These decisions come from the user: the button returns only the player who presses it, and the auto-return wait is 30 s (a starting value). Everything below adds to the earlier sections; nothing in them is removed.

### Wire
| Direction | event | data | Rules |
|---|---|---|---|
| C→S | `returnToLobby` | `{}` | Valid only while the match is over (after the `roundEnd` that sets `matchWinnerId`, and before the phase goes back to `"lobby"`). Repeating it has no further effect. Ignored at any other time. |
| S→C | `lobbyReturn` | `{returned: [playerId], lobbyAt: number}` | Sent to everyone straight after the match-ending `roundEnd` (with `returned: []`), and again each time a player returns or leaves during that wait. `lobbyAt` is when the wait ends regardless. |

### Server rules
These replace "after 5000 ms the phase returns to lobby" in §2.
- The match-over wait is **`matchOverMs = 30000`**, set in Timings. `lobbyAt = endAt + matchOverMs`.
- The phase returns to `"lobby"` when either of these happens:
  - every current player is in `returned`. A player leaving takes them out of the count and can finish the wait early.
  - `now ≥ lobbyAt`.
- When it does, wins reset to 0 and `roomState` is sent with `phase: "lobby"`. The returned list is cleared.
- Joins during the wait are still rejected with `inProgress`, because the phase is still `"match"`.

### Client
- `RoomConnection` gains **`returnToLobby(): void`**. No other signature changes.
- A player counts as **returned** when `me` is in the latest `lobbyReturn.returned`, or the phase is `"lobby"`. That state comes from the server, so there is no separate local flag.
- **Svelte (frontend):**
  - **RoundResults**, at match end: a **Return to lobby** button and a countdown to `lobbyAt`.
  - **Lobby panel** while you have returned but the phase is still `"match"`: the player list, a line reading "Waiting for N players… (Ns)" with N = players not yet returned, and Start disabled.
  - The session store keeps `lobbyReturn` and clears it when the phase becomes lobby or a new `roundStart` arrives.
- **Phaser (phaser):**
  - A returned player is moved into the lobby room straight away, the same as at phase `"lobby"`.
  - In the lobby room, show only remote orbs whose players have returned (or everyone once the phase is lobby). Hide the others, along with their moves and actions, until they return.
  - A player who has not returned keeps the match-end view.

## 6. Addendum: route variety and archetypes (2026-10-23)

Design: `docs/plans/route-variety.md`. Everything below adds to the earlier sections and removes nothing. As before, if anything here needs to change, report it rather than changing it.

### Wire (kotlin ⇄ frontend)
- `roundStart` gains `archetype: "tower" | "descent" | "labyrinth" | "speedway" | "canyon"`. These are the only legal values.
- **Server picker:** a shuffle-bag. Refill it with all 5 in random order; if the first equals the previously drawn archetype, swap it with a random later one. The bag lives on the Room and persists across matches, so no two consecutive rounds share an archetype, including across a match boundary.
- **Draw order:** draw the archetype *after* the seed and the `startOrder` shuffle, so existing seeded tests keep their values.

### `frontend/src/game/race/archetype.ts` (phaser owns; everyone imports)
```ts
export type Archetype = 'tower' | 'descent' | 'labyrinth' | 'speedway' | 'canyon'
export const ARCHETYPES: readonly Archetype[]          // exactly that order
export const archetypeForSeed: (seed: number) => Archetype   // ARCHETYPES[(seed >>> 0) % 5]; solo + fallback
export const parseArchetype: (s: unknown) => Archetype | undefined
```
`protocol.ts` `RoundStartMessage.archetype: Archetype` imports the type from here.

### Generator (phaser owns; gallery consumes)
- `generateStage(seed: number, difficulty: number, bays: number, archetype: Archetype): RaceStage`
- `RaceStage.archetype: Archetype`
- `Port` gains `dir: 'E' | 'W' | 'N' | 'S'`. E and W ports keep `{x, top, bottom}`; N and S ports are `{y, left, right}`.
- `Segment.fork?: { high: Rect[]; low: Rect[] }` (px)
- `FinishGate` gains `right: number` (px). Finishing requires `gate.x ≤ x ≤ gate.right`.
- `stage.grid` is already exposed and unchanged in meaning.

### Shared checks: `frontend/src/game/race/stageChecks.ts` (phaser owns)
Pure predicates, used by the sweep and shown in the gallery. Each returns `{ ok: boolean; detail: string }`:
- `checkCeilings(stage)`: runs ≤ 40% of buildable segments, ≤ 2 runs in a row, no type > 2× in a row. Speedway is exempt.
- `checkGuarantee(stage)`: the guarantee for `stage.archetype`.
- `stageStats(stage) → { segments, runPct, westSegments, forks, parMs }`

Until the phaser agent lands real predicates, a stub returning `ok: true` is acceptable.

### Gallery (frontend owns)
- `frontend/src/game/fx/stageThumb.ts` (pure):
  ```ts
  stageThumb(stage: RaceStage, pxPerCell: number): { w: number; h: number; rgba: Uint8ClampedArray }
  ```
  It rasterises `stage.grid` (rock, open space, pads, sea) and overlays the spine, the finish, the bays, fork branches (high and low in two colours, when present) and W-heading segments (tinted, when ports have `dir`).
- `frontend/src/app/Gallery.svelte` is mounted from `main.ts` only when `?gallery` is set **and** `__BUILD_ID__ === 'dev'` (or undefined). Params: `?gallery=<baseSeed>&diff=<1..10, default 4>&bays=<1..8, default 4>`. It shows 12 stages with archetype `ARCHETYPES[i % 5]` and seed `base + i`. Each card shows the archetype, seed, difficulty, par, the `stageStats` and the `checkCeilings`/`checkGuarantee` results.
- The archetype is never shown in the game HUD or the Svelte room UI.

## 7. Addendum: reconnecting (2026-10-24)
- **Seat hold (server):**
  - A socket that closes with code 1000 (normal) or 1001 (going away) leaves at once, as before.
  - Any other end (no close frame, a ping timeout, an error, or a client's 4000) keeps the player in the room for **30 s**. They still count for skip votes and start order, and other clients keep their orb. If the hold runs out, they leave as usual (`playerLeft`, then `roomState`).
- **Resume:**
  - `joined.resumeToken` is a secret per seat. A `joinRoom` carrying it reattaches to the seat with the same `playerId`, in any phase. `name`, `color` and `build` are not checked.
  - A resume answers `joined` (to the resumer only), then a snapshot: `roomState`, then by phase:
    - Round: `roundStart`, plus `skipVotes` if any are cast.
    - Results: the last `roundStart` and `roundEnd`.
    - Match over: the last `roundStart` and `roundEnd`, then `lobbyReturn`.
  - Clients ignore repeats of these as before.
  - A resume for a seat that is gone is rejected with `expired`. If the seat still has a connection the server hadn't noticed was dead, that connection is closed and the resume takes its place.
- **Client (`RoomConnection`):**
  - On a close it retries after 250, 500, 1000, 2000, 4000, then 5000 ms, and gives up after 30 s (`lost`). `joinRejected` also stops it.
  - Listeners stay attached across retries. While down, moves and actions are dropped. `finishReport`, `voteSkip`, `updateSettings`, `startMatch` and `returnToLobby` wait and are sent after the resume.
  - While connected it sends a `clockPing` every 4 s, unless the last one is unanswered. If nothing arrives within 8 s of it, the link is treated as dead: the client closes with 4000 and retries.
  - `close()` closes with 1000.
  - New members: `get status(): 'connecting'|'connected'|'reconnecting'|'lost'` and `onStatus(cb): () => void`.
- **`Room.svelte`** shows a "Reconnecting…" card while `reconnecting`, and "Connection lost" with Rejoin (reload) when `lost`. A rejection shows the Rejected screen instead.
