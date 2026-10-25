<script>
  import { onDestroy } from 'svelte'
  import { colorCss } from 'game/profile/palette'

  export let conn
  export let session

  const WINS = [1, 3, 5, 7]
  const PRESETS = [
    { label: 'Easy', value: 2 },
    { label: 'Normal', value: 4 },
    { label: 'Hard', value: 6 },
  ]

  let copied = false

  let now = conn.serverNow()
  const timer = setInterval(() => (now = conn.serverNow()), 250)
  onDestroy(() => clearInterval(timer))

  $: isHost = session.me !== null && session.me === session.hostId
  // Phase is still 'match' while players trickle back after a match: settings and Start stay locked
  $: canEdit = isHost && session.phase === 'lobby'
  $: waiting = session.phase === 'match'
  $: notReturned = session.players.filter((p) => !session.lobbyReturn?.returned.includes(p.id)).length
  $: waitSeconds = session.lobbyReturn ? Math.max(0, Math.ceil((session.lobbyReturn.lobbyAt - now) / 1000)) : 0
  $: link = `${window.location.origin}/room/${session.roomId}`

  // Buttons give up focus right away: Space must keep flapping, not re-press them
  const act = (fn) => (event) => {
    event.currentTarget.blur()
    fn()
  }

  const setWins = (winsToMatch) => conn.updateSettings({ ...session.settings, winsToMatch })
  const setDifficulty = (difficulty) => conn.updateSettings({ ...session.settings, difficulty })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      // clipboard unavailable (insecure context); the link is still visible to copy by hand
    }
  }
</script>

<div class="lobby card" role="region" aria-label="Lobby">
  <h2>Lobby</h2>

  <ul class="players">
    {#each session.players as player (player.id)}
      <li>
        <span class="dot" style="background: {colorCss(player.color)}"></span>
        <span class="name">{player.name}</span>
        {#if player.id === session.hostId}<span class="badge">host</span>{/if}
        {#if player.id === session.me}<span class="badge you">you</span>{/if}
      </li>
    {/each}
  </ul>

  <div class="link">
    <span class="url">{link}</span>
    <button class="button button-outline small" on:click={act(copyLink)}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>

  <div class="setting">
    <span class="label">Wins to win match</span>
    <div class="choices" role="group" aria-label="Wins to win match">
      {#each WINS as n}
        <button
          class="button small"
          class:button-outline={session.settings.winsToMatch !== n}
          disabled={!canEdit}
          aria-pressed={session.settings.winsToMatch === n}
          on:click={act(() => setWins(n))}>{n}</button>
      {/each}
    </div>
  </div>

  <div class="setting">
    <span class="label">Difficulty</span>
    <div class="choices" role="group" aria-label="Difficulty">
      {#each PRESETS as preset}
        <button
          class="button small"
          class:button-outline={session.settings.difficulty !== preset.value}
          disabled={!canEdit}
          aria-pressed={session.settings.difficulty === preset.value}
          on:click={act(() => setDifficulty(preset.value))}>{preset.label}</button>
      {/each}
    </div>
    <div class="fine" role="group" aria-label="Difficulty fine control">
      <button
        class="button button-outline small"
        disabled={!canEdit || session.settings.difficulty <= 1}
        aria-label="Decrease difficulty"
        on:click={act(() => setDifficulty(session.settings.difficulty - 1))}>-</button>
      <span class="level">{session.settings.difficulty} / 10</span>
      <button
        class="button button-outline small"
        disabled={!canEdit || session.settings.difficulty >= 10}
        aria-label="Increase difficulty"
        on:click={act(() => setDifficulty(session.settings.difficulty + 1))}>+</button>
    </div>
  </div>

  {#if waiting}
    <p class="waiting">Waiting for {notReturned} {notReturned === 1 ? 'player' : 'players'}&hellip; ({waitSeconds}s)</p>
  {/if}
  {#if isHost}
    <button class="button start" disabled={waiting} on:click={act(() => conn.startMatch())}>Start</button>
  {:else if !waiting}
    <p class="waiting">Waiting for the host to start</p>
  {/if}
</div>

<style>
  .lobby {
    position: fixed;
    top: 1rem;
    left: 1rem;
    width: 300px;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1rem 1.2rem;
    text-align: left;
    font-size: 1.3rem;
    background-color: rgba(10, 14, 32, 0.78);
  }

  h2 {
    font-size: 2rem;
    margin-bottom: 0.8rem;
    color: var(--primary);
    text-shadow: 0 0 14px rgba(46, 230, 214, 0.6);
  }

  .players {
    margin: 0 0 1rem;
  }

  .players li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.3rem;
  }

  .dot {
    width: 0.9em;
    height: 0.9em;
    border-radius: 50%;
    flex: none;
    box-shadow: 0 0 6px currentColor;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    font-size: 0.9rem;
    padding: 0 0.5rem;
    border-radius: 1rem;
    border: 1px solid var(--primary);
    color: var(--primary);
  }

  .badge.you {
    border-color: var(--secondary);
    color: var(--secondary);
  }

  /* Not `.row`: milligram's grid .row gets a negative margin and extra width on wide screens */
  .link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.1rem;
    color: #9aa6c4;
  }

  .setting {
    margin-bottom: 1rem;
  }

  .label {
    display: block;
    margin-bottom: 0.3rem;
    color: #9aa6c4;
  }

  .choices,
  .fine {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .fine {
    margin-top: 0.4rem;
  }

  .level {
    min-width: 4.5rem;
    text-align: center;
  }

  .button.small {
    margin: 0;
    padding: 0 1rem;
    height: 3rem;
    line-height: 3rem;
    font-size: 1.1rem;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .start {
    width: 100%;
    margin-bottom: 0;
  }

  .waiting {
    margin: 0;
    text-align: center;
    color: #9aa6c4;
  }
</style>
