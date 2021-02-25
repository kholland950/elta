<script>
  import { onDestroy } from 'svelte'
  import { startGame } from 'game/Game'
  import { navigate } from 'svelte-routing'

  export let id

  const name = localStorage.getItem('name')
  const color = localStorage.getItem('color')
  const validName = name.match(/[\w\d ]+/) && name.length >= 4 && name.length <= 15
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
