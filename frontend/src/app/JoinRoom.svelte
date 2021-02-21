<script>
  import { navigate } from 'svelte-routing'

  export let id

  console.log('does it even render?')

  //if no id or room doesn't exist, send to /

  let name = window.localStorage.getItem('name')
  let color = window.localStorage.getItem('color')

  const url = `${window.location.origin}/room/${id}`

  function roomCodeClick(event) {
    event.target.setSelectionRange(0, event.target.value.length)
  }

  function joinRoom(event) {
    event.preventDefault()
    console.log(name)
    if (name.match(/[\w\d ]+/) && 4 < name.length < 15 && color) {
      window.localStorage.setItem('name', name)
      window.localStorage.setItem('color', color)
      navigate(`/room/${id}`)
    }
  }
</script>

<main>
  <div class="card main">
    <form class="join-room" on:submit={joinRoom}>
      <label for="room-code">Share with friends</label>
      <input type="text" id="room-code" readonly value={url} on:click={roomCodeClick} />
      <label for="name">Choose your name</label>
      <input type="text" placeholder="Name" id="name" bind:value={name} autocomplete="off" />
      <label for="color">Choose your color</label>
      <select id="color" bind:value={color}>
        <option />
        <option value="Blue">Blue</option>
        <option value="Green">Green</option>
        <option value="Orange">Orange</option>
        <option value="Red">Red</option>
        <option value="Violet">Violet</option>
        <option value="Yellow">Yellow</option>
      </select>
      <button class="button" on:click={joinRoom} type="submit">Join Room</button>
    </form>
  </div>
</main>
