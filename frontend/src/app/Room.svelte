<script>
  import { onDestroy } from 'svelte'
  import { readable } from 'svelte/store'
  import { startGame } from 'game/Game'
  import { RoomConnection } from 'game/net/RoomConnection'
  import { initialSession, meReturned } from 'game/race/session'
  import { navigate } from 'svelte-routing'
  import events from './events'
  import { createRoomStore } from './roomStore'
  import Lobby from './Lobby.svelte'
  import RoundResults from './RoundResults.svelte'
  import Rejected from './Rejected.svelte'
  import { loadQuality, saveQuality } from 'game/fx/quality'

  export let id

  let showScoreboard = false
  let quality = loadQuality(localStorage)

  const setQuality = (level, event) => {
    // Drop focus so Space (jump) can't re-press the button
    event.currentTarget.blur()
    if (level === quality) return
    quality = level
    saveQuality(localStorage, level)
    events.send('qualityChanged', level)
  }

  events.add('showScoreboard', (show) => {
    showScoreboard = show
  })

  const name = localStorage.getItem('name')
  const color = localStorage.getItem('color')
  const validName = name?.match(/[\w\d ]+/) && name.length >= 2 && name.length <= 15
  let conn = null
  let session = readable(initialSession(id))

  if (!validName || !color) {
    setTimeout(() => navigate(`/joinroom/${id}`))
  } else {
    // Order matters: the connection doesn't replay, so the store and game subscribe right away
    conn = new RoomConnection({ roomId: id, name, color })
    session = createRoomStore(conn)
    const game = startGame(conn)

    onDestroy(() => {
      conn.close()
      game.canvas?.remove()
      game.destroy(true)
    })
  }

  onDestroy(() => events.remove('showScoreboard'))

  $: inLobby = meReturned($session) && $session.me !== null && !$session.rejected
  $: inResults = $session.phase === 'match' && $session.lastRoundEnd !== null && !meReturned($session) && !$session.rejected
</script>

<main class="menu">
  <div id="scoreboard" class="scoreboard card" hidden={!showScoreboard}>
    <h1>Players</h1>
    <ul>
      {#each $session.players as player (player.id)}
        <li>
          <span class="dot" style="background: {player.color.toLowerCase()}"></span>
          {player.name}
          {#if player.wins > 0}<span class="wins">{player.wins}</span>{/if}
        </li>
      {/each}
    </ul>
    <div class="quality" role="group" aria-label="Graphics quality">
      <span>Graphics</span>
      {#each ['high', 'low'] as level}
        <button
          class="button"
          class:button-outline={quality !== level}
          aria-pressed={quality === level}
          on:click={(event) => setQuality(level, event)}>
          {level === 'high' ? 'High' : 'Low'}
        </button>
      {/each}
    </div>
  </div>

  {#if conn && inLobby}
    <Lobby {conn} session={$session} />
  {/if}
  {#if conn && inResults}
    <RoundResults {conn} session={$session} />
  {/if}
  {#if $session.rejected}
    <Rejected reason={$session.rejected} {id} />
  {/if}
</main>

<style>
  .quality {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .quality .button {
    margin-bottom: 0;
  }

  .dot {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 50%;
    margin-right: 0.4em;
  }

  .wins {
    color: var(--primary);
    margin-left: 0.4em;
  }
</style>
