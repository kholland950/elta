<script>
  import { Router, Route } from 'svelte-routing'
  import JoinRoom from './JoinRoom.svelte'
  import Main from './Main.svelte'
  import Room from './Room.svelte'
</script>

<svelte:head>
  <style src="css/global.css"></style>
</svelte:head>

<Router>
  <Route path="/" component={Main} />
  <Route path="/joinroom/:id" component={JoinRoom} />
  <Route path="/room/:id" component={Room} />
</Router>
