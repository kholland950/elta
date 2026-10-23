<script>
  import { onDestroy } from 'svelte'
  import { formatRaceTime } from 'game/race/round'

  export let conn
  export let session

  let now = conn.serverNow()
  const timer = setInterval(() => (now = conn.serverNow()), 250)
  onDestroy(() => clearInterval(timer))

  $: end = session.lastRoundEnd
  $: nameOf = (id) => session.players.find((p) => p.id === id)?.name ?? 'Player'
  $: matchWinner = end?.matchWinnerId ?? null
  $: lobbySeconds = session.lobbyReturn
    ? Math.max(0, Math.ceil((session.lobbyReturn.lobbyAt - now) / 1000))
    : null
  const returnToLobby = (event) => {
    event.currentTarget.blur()
    conn.returnToLobby()
  }
  $: secondsLeft =
    end?.nextRoundAt != null ? Math.max(0, Math.ceil((end.nextRoundAt - now) / 1000)) : null
  $: headline = !end
    ? ''
    : end.winnerId
      ? `${nameOf(end.winnerId)} wins round ${end.round}`
      : `No winner - ${end.reason === 'skipped' ? 'skipped' : 'timeout'}`
  $: tally = [...session.players].sort((a, b) => (end?.wins[b.id] ?? b.wins) - (end?.wins[a.id] ?? a.wins))
</script>

{#if end}
  <div class="results card" role="status" aria-live="polite">
    {#if matchWinner}
      <h2 class="banner">{nameOf(matchWinner)} wins the match!</h2>
    {/if}
    <h3>{headline}</h3>

    {#if end.times.length > 0}
      <ol class="times">
        {#each end.times as t (t.playerId)}
          <li>
            <span>{nameOf(t.playerId)}</span>
            <span class="time">{formatRaceTime(t.raceTimeMs)}</span>
          </li>
        {/each}
      </ol>
    {/if}

    <ul class="tally">
      {#each tally as p (p.id)}
        <li><span>{p.name}</span><span class="time">{end.wins[p.id] ?? p.wins} / {session.settings.winsToMatch}</span></li>
      {/each}
    </ul>

    {#if matchWinner}
      <button class="button" on:click={returnToLobby}>Return to lobby</button>
      {#if lobbySeconds !== null}<p class="next">Back to the lobby in {lobbySeconds}s</p>{/if}
    {:else if secondsLeft !== null}
      <p class="next">Next round in {secondsLeft}</p>
    {/if}
  </div>
{/if}

<style>
  .results {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: 340px;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding: 1rem 1.2rem;
    font-size: 1.3rem;
    background-color: rgba(10, 14, 32, 0.78);
  }

  h3 {
    font-size: 1.8rem;
    margin-bottom: 0.6rem;
  }

  .banner {
    font-size: 2.2rem;
    color: var(--secondary);
    text-shadow: 0 0 14px rgba(255, 61, 154, 0.7);
    margin-bottom: 0.4rem;
  }

  ol,
  ul {
    margin: 0 0 0.8rem;
    padding: 0;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 0 0.2rem;
  }

  .times {
    list-style: none;
  }

  .time {
    color: var(--primary);
    font-variant-numeric: tabular-nums;
  }

  .tally {
    border-top: 1px solid rgba(46, 230, 214, 0.25);
    padding-top: 0.6rem;
  }

  .next {
    margin: 0;
    color: #9aa6c4;
  }
</style>
