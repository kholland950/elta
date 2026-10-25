<script>
  import { move } from './menuNav'
  import { menuActionForKey } from './menuKeys'
  import { usePadMenu } from './padMenu'
  import KeyBindingsMenu from './KeyBindingsMenu.svelte'
  import CustomizePanel from './CustomizePanel.svelte'

  export let quality
  export let onQuality
  export let bindings
  export let onBindings
  export let profile
  export let onProfile
  /** Looks can only change in the lobby, between matches. */
  export let canCustomize
  export let onLeave
  export let onClose

  // Resume / High | Low / Customize / Key bindings / Leave room
  const grid = [1, 2, 1, 1, 1]
  const refs = grid.map(() => [])
  let selection = { row: 0, col: 0 }
  let view = 'main'
  const CUSTOMIZE = 2
  const KEY_BINDINGS = 3
  const LEAVE = 4

  const backTo = (row) => () => {
    view = 'main'
    selection = { row, col: 0 }
  }
  const closeBindings = backTo(KEY_BINDINGS)
  const closeCustomize = backTo(CUSTOMIZE)

  const saveProfile = (next) => {
    onProfile(next)
    closeCustomize()
  }

  // A match starting under the screen ends the chance to change looks
  $: if (view === 'customize' && !canCustomize) closeCustomize()

  // Hovering selects on pointermove rather than enter, so a resting mouse can't pull the highlight
  // back from the keys
  const select = (row, col) => {
    if (selection.row !== row || selection.col !== col) selection = { row, col }
  }

  // Browser focus follows the highlight, so screen readers track it too
  $: refs[selection.row][selection.col]?.focus()

  // Shared by the keyboard and the pad
  const apply = (action) => {
    if (action === 'confirm') refs[selection.row][selection.col]?.click()
    else if (action === 'back') onClose()
    else selection = move(grid, selection, action)
  }

  const onKeydown = (event) => {
    // The bindings screen handles its own keys
    if (view !== 'main') return
    const action = menuActionForKey(event)
    if (!action) return
    // The menu owns these keys: no native button presses or Tab focus moves on top of ours
    event.preventDefault()
    apply(action)
  }

  // The bindings screen goes on top of this one for the pad while it's open
  usePadMenu({
    action: (action) => {
      if (view === 'main') apply(action)
    },
  })
</script>

<svelte:window on:keydown={onKeydown} />

{#if view === 'bindings'}
  <KeyBindingsMenu {bindings} onChange={onBindings} onBack={closeBindings} />
{:else if view === 'customize'}
  <div class="backdrop">
    <CustomizePanel {profile} onSave={saveProfile} onBack={closeCustomize} />
  </div>
{:else}
<div class="backdrop">
  <div class="options card" role="dialog" aria-modal="true" aria-labelledby="options-title">
    <h2 id="options-title">Options</h2>

    <button
      class="button button-outline"
      class:selected={selection.row === 0}
      bind:this={refs[0][0]}
      on:pointermove={() => select(0, 0)}
      on:focusin={() => select(0, 0)}
      on:click={onClose}>Resume</button>

    <div class="quality" role="group" aria-label="Graphics quality">
      <span>Graphics</span>
      {#each ['high', 'low'] as level, col}
        <button
          class="button"
          class:button-outline={quality !== level}
          class:selected={selection.row === 1 && selection.col === col}
          aria-pressed={quality === level}
          bind:this={refs[1][col]}
          on:pointermove={() => select(1, col)}
          on:focusin={() => select(1, col)}
          on:click={() => onQuality(level)}>
          {level === 'high' ? 'High' : 'Low'}
        </button>
      {/each}
    </div>

    <button
      class="button button-outline"
      class:selected={selection.row === CUSTOMIZE}
      aria-disabled={!canCustomize}
      title={canCustomize ? undefined : 'Only in the lobby'}
      bind:this={refs[CUSTOMIZE][0]}
      on:pointermove={() => select(CUSTOMIZE, 0)}
      on:focusin={() => select(CUSTOMIZE, 0)}
      on:click={() => canCustomize && (view = 'customize')}>
      Customize{#if !canCustomize}<span class="note"> · lobby only</span>{/if}
    </button>

    <button
      class="button button-outline"
      class:selected={selection.row === KEY_BINDINGS}
      bind:this={refs[KEY_BINDINGS][0]}
      on:pointermove={() => select(KEY_BINDINGS, 0)}
      on:focusin={() => select(KEY_BINDINGS, 0)}
      on:click={() => (view = 'bindings')}>Key bindings</button>

    <button
      class="button button-outline"
      class:selected={selection.row === LEAVE}
      bind:this={refs[LEAVE][0]}
      on:pointermove={() => select(LEAVE, 0)}
      on:focusin={() => select(LEAVE, 0)}
      on:click={onLeave}>Leave room</button>
  </div>
</div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(4, 6, 16, 0.55);
    z-index: 20;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 320px;
    background-color: rgba(10, 14, 32, 0.9);
  }

  .options h2 {
    color: var(--primary);
    text-shadow: 0 0 14px rgba(46, 230, 214, 0.6);
  }

  .options .button {
    margin-bottom: 0;
  }

  /* One highlight only: the selection. Hover and focus don't draw their own */
  .backdrop .options .button:not(.selected):is(:hover, :focus, :focus-visible) {
    background-color: var(--primary);
    border-color: var(--primary);
    color: var(--darkText);
    box-shadow: 0 0 10px rgba(46, 230, 214, 0.35);
  }

  .backdrop .options .button.button-outline:not(.selected):is(:hover, :focus, :focus-visible) {
    background-color: transparent;
    color: var(--primary);
    box-shadow: none;
  }

  .backdrop .options .button:is(:focus, :focus-visible) {
    outline: none;
  }

  .backdrop .options .button.selected {
    background-color: #7ff5ea;
    border-color: #fff;
    color: var(--darkText);
    box-shadow: 0 0 20px rgba(46, 230, 214, 0.8);
  }

  .button[aria-disabled='true'] {
    opacity: 0.5;
  }

  .note {
    text-transform: none;
    font-weight: 400;
  }

  .quality {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
</style>
