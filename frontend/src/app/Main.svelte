<style>
  .main > * {
    margin-top: 3rem;
  }
</style>

<script>
  import { navigate } from 'svelte-routing'

  let roomCode = 'test'

  function joinRoom(event) {
    event.preventDefault()
    if (roomCode) {
      //check if room exists
      navigate(`/joinroom/${roomCode}`)
    }
  }
</script>

<main>
  <div class="card main">
    <h1>spacelights</h1>
    <div class="create-room">
      <button class="button" on:click={joinRoom}> Create Room </button>
    </div>
    <form class="join-room" on:submit={joinRoom}>
      <label for="room-id">Room Code</label>
      <input
        type="text"
        placeholder="Room Code"
        id="room-id"
        bind:value={roomCode}
        autocomplete="off" />
      <button class="button" on:click={joinRoom}> Join Room </button>
    </form>
  </div>
</main>
