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
</style>

<script>
  import { onDestroy } from 'svelte'
  import { startGame } from 'game/Game'
  import { navigate } from 'svelte-routing'
  import events from './events'
  import { loadQuality, saveQuality } from 'game/fx/quality'

  export let id

  $: players = []
  $: showScoreboard = false
  let quality = loadQuality(localStorage)

  const setQuality = (level, event) => {
    // Drop focus so Space (jump) can't re-press the button
    event.currentTarget.blur()
    if (level === quality) return
    quality = level
    saveQuality(localStorage, level)
    events.send('qualityChanged', level)
  }

  events.add('addPlayer', (player) => {
    players = [...players, player]
  })

  events.add('removePlayer', (id) => {
    const index = players.findIndex((player) => player.id === id)
    if (index > -1) {
      players = [...players.slice(0, index), ...players.slice(index + 1, players.length)]
    }
  })

  events.add('showScoreboard', (show) => {
    showScoreboard = show
  })

  const name = localStorage.getItem('name')
  const color = localStorage.getItem('color')
  const validName = name?.match(/[\w\d ]+/) && name.length >= 2 && name.length <= 15
  if (!validName || !color) {
    setTimeout(() => navigate(`/joinroom/${id}`))
  } else {
    let game = startGame()

    onDestroy(() => {
      game.canvas.remove()
      game.destroy()
    })
  }
</script>

<main class="menu">
  <div id="scoreboard" class="scoreboard card" hidden={!showScoreboard}>
    <h1>Players</h1>
    <ul>
      {#each players as player}
        <li>{player.name}</li>
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
</main>
