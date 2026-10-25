<script>
  import { onMount } from 'svelte'
  import { move } from './menuNav'
  import { menuActionForKey } from './menuKeys'
  import { keyLabel, loadLayoutMap } from './keyLabel'
  import {
    ACTIONS,
    ACTION_LABELS,
    CLEAR_CODES,
    DEFAULT_BINDINGS,
    RESERVED,
    actionsFor,
    clearSlot,
    duplicates,
    mouseCode,
    rebind,
  } from 'game/input/bindings'

  export let bindings
  export let onChange
  export let onBack

  // One row per action with its two slots, then Reset, then Back
  const grid = [...ACTIONS.map(() => 2), 1, 1]
  const RESET = ACTIONS.length
  const BACK = ACTIONS.length + 1
  const refs = grid.map(() => [])
  let selection = { row: 0, col: 0 }
  /** The slot waiting for a key, if any. */
  let capturing = null
  /** Set when a mouse press was bound, so its click doesn't press a button too. */
  let swallowClick = false
  let notice = ''
  let layout

  onMount(async () => {
    layout = await loadLayoutMap()
  })

  $: dup = duplicates(bindings)

  const select = (row, col) => {
    if (selection.row !== row || selection.col !== col) selection = { row, col }
  }

  $: refs[selection.row][selection.col]?.focus()

  const othersFor = (b, action, code) =>
    actionsFor(b, code)
      .filter((other) => other !== action)
      .map((other) => ACTION_LABELS[other])

  const startCapture = (action, slot) => {
    capturing = { action, slot }
    notice = ''
  }

  const reset = () => {
    capturing = null
    notice = 'Keys reset to defaults'
    onChange(DEFAULT_BINDINGS)
  }

  const bind = (code) => {
    const { action, slot } = capturing
    capturing = null
    const next = rebind(bindings, action, slot, code)
    const others = othersFor(next, action, code)
    notice = others.length ? `${keyLabel(code, layout)} is also bound to ${others.join(', ')}` : ''
    onChange(next)
  }

  // Esc cancels, Backspace/Delete empties the slot, a reserved key is refused and capture goes on
  const capture = (event) => {
    if (event.repeat) return
    if (event.code === 'Escape') {
      capturing = null
    } else if (CLEAR_CODES.has(event.code)) {
      const { action, slot } = capturing
      capturing = null
      onChange(clearSlot(bindings, action, slot))
    } else if (RESERVED.has(event.code)) {
      notice = `${keyLabel(event.code, layout)} is reserved`
    } else {
      bind(event.code)
    }
  }

  // The click that started capturing is over by now, so any press here is the one to bind
  const onMousedown = (event) => {
    if (!capturing) return
    event.preventDefault()
    swallowClick = event.button === 0
    bind(mouseCode(event.button))
  }

  // Swallow the click that follows, so it can't also press whatever button is under the mouse
  const onClickCapture = (event) => {
    if (!swallowClick) return
    swallowClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeydown = (event) => {
    if (capturing) {
      // Every key belongs to the capture, Tab and Space included
      event.preventDefault()
      capture(event)
      return
    }
    const action = menuActionForKey(event)
    if (!action) return
    event.preventDefault()
    if (action === 'confirm') refs[selection.row][selection.col]?.click()
    else if (action === 'back') onBack()
    else selection = move(grid, selection, action)
  }
</script>

<svelte:window on:keydown={onKeydown} on:mousedown={onMousedown} on:click|capture={onClickCapture} />

<div class="backdrop">
  <div class="bindings card" role="dialog" aria-modal="true" aria-labelledby="bindings-title">
    <h2 id="bindings-title">Key bindings</h2>
    <p class="hint">Press a key or mouse button · Backspace clears · Esc cancels</p>

    <div class="rows">
      {#each ACTIONS as action, row}
        <span class="action">{ACTION_LABELS[action]}</span>
        {#each bindings[action] as code, slot}
          {@const listening = capturing?.action === action && capturing?.slot === slot}
          <button
            class="button button-outline slot"
            class:selected={selection.row === row && selection.col === slot}
            class:duplicate={code !== null && dup.has(code)}
            class:empty={code === null}
            title={code !== null && dup.has(code)
              ? `Also bound to ${othersFor(bindings, action, code).join(', ') || ACTION_LABELS[action]}`
              : undefined}
            aria-label="{ACTION_LABELS[action]} {slot === 0 ? 'primary' : 'secondary'}: {listening
              ? 'press a key'
              : code === null
                ? 'unbound'
                : keyLabel(code, layout)}"
            bind:this={refs[row][slot]}
            on:pointermove={() => select(row, slot)}
            on:focusin={() => select(row, slot)}
            on:click={() => startCapture(action, slot)}>
            {listening ? 'Press a key…' : code === null ? '—' : keyLabel(code, layout)}
          </button>
        {/each}
      {/each}
    </div>

    <p class="notice" aria-live="polite">{notice}</p>

    <button
      class="button button-outline"
      class:selected={selection.row === RESET}
      bind:this={refs[RESET][0]}
      on:pointermove={() => select(RESET, 0)}
      on:focusin={() => select(RESET, 0)}
      on:click={reset}>Reset to defaults</button>

    <button
      class="button button-outline"
      class:selected={selection.row === BACK}
      bind:this={refs[BACK][0]}
      on:pointermove={() => select(BACK, 0)}
      on:focusin={() => select(BACK, 0)}
      on:click={onBack}>Back</button>
  </div>
</div>

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

  .bindings {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 320px;
    max-width: calc(100vw - 32px);
    background-color: rgba(10, 14, 32, 0.9);
  }

  .bindings h2 {
    color: var(--primary);
    text-shadow: 0 0 14px rgba(46, 230, 214, 0.6);
    margin-bottom: 0;
  }

  .hint,
  .notice {
    margin: 0;
    font-size: 0.85em;
    opacity: 0.75;
  }

  .notice {
    min-height: 1.2em;
  }

  .rows {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    align-items: center;
    gap: 0.6rem 0.8rem;
  }

  .action {
    text-align: left;
  }

  .bindings .button {
    margin-bottom: 0;
  }

  .slot {
    min-width: 8rem;
    padding: 0 0.8rem;
    text-transform: none;
  }

  .slot.empty {
    opacity: 0.6;
  }

  .backdrop .bindings .slot.duplicate {
    color: #ff6b6b;
    border-color: #ff6b6b;
  }

  /* One highlight only: the selection. Hover and focus don't draw their own */
  .backdrop .bindings .button.button-outline:not(.selected):is(:hover, :focus, :focus-visible) {
    background-color: transparent;
    color: var(--primary);
    box-shadow: none;
  }

  .backdrop .bindings .button.duplicate:not(.selected):is(:hover, :focus, :focus-visible) {
    color: #ff6b6b;
  }

  .backdrop .bindings .button:is(:focus, :focus-visible) {
    outline: none;
  }

  .backdrop .bindings .button.selected {
    background-color: #7ff5ea;
    border-color: #fff;
    color: var(--darkText);
    box-shadow: 0 0 20px rgba(46, 230, 214, 0.8);
  }

  .backdrop .bindings .button.selected.duplicate {
    background-color: #ff9b9b;
    box-shadow: 0 0 20px rgba(255, 107, 107, 0.8);
  }
</style>
