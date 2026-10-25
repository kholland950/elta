<script>
  import { Router, Route } from 'svelte-routing'
  import Customize from './Customize.svelte'
  import Main from './Main.svelte'
  import Redirect from './Redirect.svelte'
  import Room from './Room.svelte'
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.gstatic.com" />
  <link
    href="https://fonts.googleapis.com/css2?family=Comfortaa&family=Orbitron:wght@700&display=swap"
    rel="stylesheet" />
  <style src="css/global.css"></style>
</svelte:head>

<!--
  Routes render through slots: svelte-routing's `component` prop treats anything that
  isn't a class as a lazy import, and Svelte 5 components are plain functions
-->
<Router>
  <Route path="/"><Main /></Route>
  <Route path="/customize"><Customize /></Route>
  <!-- Old share links: every player has a profile now, so they go straight in -->
  <Route path="/joinroom/:id" let:params><Redirect to={`/room/${params.id}`} /></Route>
  <Route path="/room/:id" let:params><Room id={params.id} /></Route>
</Router>
