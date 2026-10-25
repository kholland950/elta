<script>
  import { navigate } from 'svelte-routing'

  export let reason
  export let id

  const MESSAGES = {
    inProgress: 'Match in progress, try again after it ends',
    full: 'This room is full',
    badName: 'That name or color was not accepted',
    staleBuild: 'The game was updated. Reload the page',
    expired: 'You were disconnected for too long and lost your place in the match',
  }

  $: message = MESSAGES[reason] ?? 'Could not join this room'

  const reload = (event) => {
    event.currentTarget.blur()
    window.location.reload()
  }
  const back = (event) => {
    event.currentTarget.blur()
    navigate(reason === 'badName' ? `/customize?next=/room/${id}` : '/')
  }
</script>

<div class="rejected card" role="alert">
  <h2>Can't join</h2>
  <p>{message}</p>
  {#if reason === 'staleBuild'}
    <button class="button" on:click={reload}>Reload</button>
  {:else}
    <button class="button" on:click={back}>{reason === 'badName' ? 'Change name' : 'Back'}</button>
  {/if}
</div>

<style>
  .rejected {
    max-width: 420px;
    background-color: rgba(10, 14, 32, 0.9);
  }

  h2 {
    color: var(--secondary);
    text-shadow: 0 0 14px rgba(255, 61, 154, 0.6);
  }
</style>
