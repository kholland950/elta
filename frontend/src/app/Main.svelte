<style>
  .main > * {
    margin-top: 3rem;
  }
</style>

<script>
  import { navigate } from 'svelte-routing'

  let roomCode = ''

  const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

  // 6 random chars from [a-z0-9] (server accepts ^[a-z0-9]{4,12}$)
  function randomRoomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
  }

  function createRoom(event) {
    event.preventDefault()
    navigate(`/joinroom/${randomRoomCode()}`)
  }

  function joinRoom(event) {
    event.preventDefault()
    const code = roomCode.trim().toLowerCase()
    if (/^[a-z0-9]{4,12}$/.test(code)) {
      navigate(`/joinroom/${code}`)
    }
  }
</script>

<main>
  <div class="card main">
    <h1 class="title">elta</h1>
    <div class="create-room">
      <button class="button" on:click={createRoom}> Create Room </button>
    </div>
    <form class="join-room" on:submit={joinRoom}>
      <label for="room-id">Room Code</label>
      <input
        type="text"
        placeholder="Room Code"
        id="room-id"
        bind:value={roomCode}
        autocomplete="off" />
      <button class="button" type="submit"> Join Room </button>
    </form>
  </div>
</main>
