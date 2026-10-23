<script>
  import { Router, Route } from 'svelte-routing'
  import JoinRoom from './JoinRoom.svelte'
  import Main from './Main.svelte'
  import Room from './Room.svelte'
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.gstatic.com" />
  <link href="https://fonts.googleapis.com/css2?family=Comfortaa&display=swap" rel="stylesheet" />
  <style src="css/global.css"></style>
</svelte:head>

<!--
  Routes render through slots: svelte-routing's `component` prop treats anything that
  isn't a class as a lazy import, and Svelte 5 components are plain functions
-->
<Router>
  <Route path="/"><Main /></Route>
  <Route path="/joinroom/:id" let:params><JoinRoom id={params.id} /></Route>
  <Route path="/room/:id" let:params><Room id={params.id} /></Route>
</Router>
