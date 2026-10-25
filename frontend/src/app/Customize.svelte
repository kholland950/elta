<script>
  import { navigate } from 'svelte-routing'
  import CustomizePanel from './CustomizePanel.svelte'
  import { loadPlayerProfile, savePlayerProfile } from './playerProfile'

  const profile = loadPlayerProfile()

  // Where to go after: `?next=/room/abc` from a rejected join, else the main menu. Only paths on
  // this site are followed
  const next = new URLSearchParams(window.location.search).get('next')
  const done = () => navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/')

  const save = (p) => {
    savePlayerProfile(p)
    done()
  }
</script>

<main>
  <CustomizePanel {profile} onSave={save} onBack={done} />
</main>

<style>
  main {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
  }
</style>
