<script>
  import { onDestroy, tick } from 'svelte'
  import { visibleEntries } from 'game/chat/chatLog'

  export let conn
  /** The chat store's lines. */
  export let log
  /** True while the input is up; the room releases the game's keys and pad for it. */
  export let open = false
  /** No opening over the options menu or the rejected screen. */
  export let blocked = false

  const MAX_LENGTH = 120

  let input
  let draft = ''

  // A closed chat fades its lines, so it needs a clock
  let now = performance.now()
  const timer = setInterval(() => (now = performance.now()), 250)
  onDestroy(() => clearInterval(timer))

  $: lines = visibleEntries($log, now, open)

  const typing = () => {
    const el = document.activeElement
    return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  const openChat = async () => {
    open = true
    await tick()
    input?.focus()
  }

  const close = () => {
    open = false
    draft = ''
    input?.blur()
  }

  $: if (blocked && open) close()

  const send = () => {
    const text = draft.trim()
    if (text) conn.sendChat(text)
    close()
  }

  const onWindowKeydown = (event) => {
    if (open || blocked || event.repeat || typing()) return
    if (event.code === 'KeyT' || event.key === 'Enter') {
      // Or the T lands in the input
      event.preventDefault()
      openChat()
    }
  }

  // Kept from the window, so Esc doesn't also open the options menu
  const onInputKeydown = (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<div class="chat" class:open>
  <ul class="log" aria-live="polite">
    {#each lines as { entry, alpha } (entry.key)}
      <li style="opacity: {alpha}" class:quick={entry.quick}>
        <span class="name" style="color: {entry.color}">{entry.name}:</span>
        {entry.text}
      </li>
    {/each}
  </ul>
  {#if open}
    <form class="entry" on:submit|preventDefault={send}>
      <input
        bind:this={input}
        bind:value={draft}
        on:keydown={onInputKeydown}
        on:blur={close}
        maxlength={MAX_LENGTH}
        placeholder="Say something…"
        aria-label="Chat message"
        autocomplete="off" />
      <!-- Pressing it keeps the focus in the input, so the blur doesn't close the chat first -->
      <button type="submit" class="button" on:mousedown|preventDefault>Send</button>
    </form>
  {/if}
</div>

<style>
  /* Bottom left, above the skip-vote line the game draws on the very bottom */
  .chat {
    position: fixed;
    left: 10px;
    bottom: 34px;
    width: min(420px, calc(100vw - 20px));
    z-index: 5;
    pointer-events: none;
  }

  .chat.open {
    pointer-events: auto;
  }

  .log {
    list-style: none;
    margin: 0 0 0.4rem;
    padding: 0;
    max-height: 40vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 0.2rem;
    font-size: 1.4rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  /* Each line on its own dark pill, so it reads over any stage */
  .log li {
    margin: 0;
    padding: 0.15rem 0.6rem;
    border-radius: 4px;
    background: rgba(6, 10, 24, 0.72);
    color: #ffffff;
  }

  .quick {
    font-style: italic;
    color: #f4ff6b;
  }

  .name {
    font-weight: bold;
  }

  .entry {
    display: flex;
    gap: 0.5rem;
    margin: 0;
  }

  .entry input {
    flex: 1;
    margin: 0;
    background: rgba(10, 14, 32, 0.85);
    color: #fff;
  }

  .entry .button {
    margin: 0;
    padding: 0 1.2rem;
  }
</style>
