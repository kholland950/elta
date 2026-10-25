<script>
  import { onDestroy, onMount } from 'svelte'
  import { startPreview } from 'game/preview/PreviewScene'

  export let profile

  // A name only reaches the canvas once typing pauses, so each key doesn't rebuild the orb
  const NAME_DEBOUNCE_MS = 200

  let host
  let preview = null
  let shown = profile
  let timer

  onMount(() => {
    preview = startPreview(host, profile)
  })

  onDestroy(() => {
    clearTimeout(timer)
    preview?.destroy()
  })

  $: if (preview && (profile.name !== shown.name || profile.color !== shown.color)) {
    clearTimeout(timer)
    const next = profile
    const show = () => {
      shown = next
      preview?.setProfile(next)
    }
    if (next.color !== shown.color) show()
    else timer = setTimeout(show, NAME_DEBOUNCE_MS)
  }
</script>

<div class="preview" bind:this={host} aria-hidden="true"></div>

<style>
  .preview {
    width: 280px;
    height: 240px;
    margin: 0 auto;
  }
</style>
