<script>
  import { onDestroy } from 'svelte'
  import { startGame } from 'game/Game'
  import { navigate } from 'svelte-routing'

  export let id

  if (!localStorage.getItem('name') || !localStorage.getItem('color')) {
    setTimeout(() => navigate(`/joinroom/${id}`))
  } else {
    let game = startGame()

    onDestroy(() => {
      game.canvas.remove()
      game.destroy()
    })
  }
</script>
