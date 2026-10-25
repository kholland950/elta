<script>
  import { onDestroy, onMount } from 'svelte'
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
  import OptionsMenu from './OptionsMenu.svelte'
  import { loadQuality, saveQuality } from 'game/fx/quality'
  import { loadBindings, saveBindings } from 'game/input/bindings'
  import { gamepadHub } from 'game/input/gamepadHub'

  export let id

  let showScoreboard = false
  let quality = loadQuality(localStorage)

  // Only the options menu sets this, and it holds the keyboard, so Space can't re-press it
  const setQuality = (level) => {
    if (level === quality) return
    quality = level
    saveQuality(localStorage, level)
    events.send('qualityChanged', level)
  }

  let bindings = loadBindings(localStorage)

  const setBindings = (next) => {
    bindings = next
    saveBindings(localStorage, next)
    events.send('bindingsChanged', next)
  }

  let menuOpen = false
  // The game drops its keys and pad while the menu is up; the race goes on underneath
  $: events.send('menuOpen', menuOpen)
  $: gamepadHub.setMenuOpen(menuOpen)

  // Start both opens and closes the menu: unlike Esc, the pad's back button is B
  const toggleMenu = () => {
    if (!$session.rejected) menuOpen = !menuOpen
  }

  onMount(() => {
    gamepadHub.start()
    const offStart = gamepadHub.onStart(toggleMenu)
    return () => {
      offStart()
      gamepadHub.stop()
    }
  })

  const onKeydown = (event) => {
    // Esc only opens; once open, the menu's own back action closes it
    if (menuOpen || event.key !== 'Escape' || event.repeat || $session.rejected) return
    event.preventDefault()
    menuOpen = true
  }

  const openMenu = (event) => {
    event.currentTarget.blur()
    menuOpen = true
  }

  const closeMenu = () => (menuOpen = false)

  // Unmounting the room closes the connection cleanly, so the seat is freed straight away
  const leave = () => navigate('/')

  events.add('showScoreboard', (show) => {
    showScoreboard = show
  })

  const name = localStorage.getItem('name')
  const color = localStorage.getItem('color')
  const validName = name?.match(/[\w\d ]+/) && name.length >= 2 && name.length <= 15
  let conn = null
  let session = readable(initialSession(id))
  let status = 'connecting'

  if (!validName || !color) {
    setTimeout(() => navigate(`/joinroom/${id}`))
  } else {
    // Order matters: the connection doesn't replay, so the store and game subscribe right away
    conn = new RoomConnection({ roomId: id, name, color })
    session = createRoomStore(conn)
    const game = startGame(conn)
    // conn.close() drops status listeners too
    conn.onStatus((s) => (status = s))

    onDestroy(() => {
      conn.close()
      game.canvas?.remove()
      game.destroy(true)
    })
  }

  onDestroy(() => events.remove('showScoreboard'))

  const rejoin = (event) => {
    event.currentTarget.blur()
    window.location.reload()
  }

  $: inLobby = meReturned($session) && $session.me !== null && !$session.rejected
  $: inResults = $session.phase === 'match' && $session.lastRoundEnd !== null && !meReturned($session) && !$session.rejected
</script>

<!-- Right click can be bound to an action, so the browser's menu never opens over the game -->
<svelte:window on:keydown={onKeydown} on:contextmenu|preventDefault />

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
  </div>

  {#if conn && inLobby}
    <Lobby {conn} session={$session} />
  {/if}
  {#if conn && inResults}
    <RoundResults {conn} session={$session} />
  {/if}
  {#if !$session.rejected}
    <button class="options-button button button-outline" aria-label="Options" on:click={openMenu}>⚙</button>
  {/if}
  {#if menuOpen && !$session.rejected}
    <OptionsMenu
      {quality}
      onQuality={setQuality}
      {bindings}
      onBindings={setBindings}
      onLeave={leave}
      onClose={closeMenu} />
  {/if}
  {#if $session.rejected}
    <Rejected reason={$session.rejected} {id} />
  {:else if status === 'reconnecting'}
    <div class="connection card" role="status">
      <h2>Reconnecting…</h2>
      <p>Your place in the room is saved</p>
    </div>
  {:else if status === 'lost'}
    <div class="connection card" role="alert">
      <h2>Connection lost</h2>
      <p>Couldn't reach the server</p>
      <button class="button" on:click={rejoin}>Rejoin</button>
    </div>
  {/if}
</main>

<style>
  .options-button {
    position: fixed;
    top: 1rem;
    right: 1rem;
    margin: 0;
    padding: 0 1rem;
    font-size: 1.6rem;
    z-index: 10;
  }

  .dot {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 50%;
    margin-right: 0.4em;
  }

  .connection {
    max-width: 420px;
    background-color: rgba(10, 14, 32, 0.9);
  }

  .connection h2 {
    color: var(--secondary);
    text-shadow: 0 0 14px rgba(255, 61, 154, 0.6);
  }

  .wins {
    color: var(--primary);
    margin-left: 0.4em;
  }
</style>
