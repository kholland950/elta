<script>
  import { move } from './menuNav'
  import { menuActionForKey } from './menuKeys'
  import { usePadMenu } from './padMenu'
  import OrbPreview from './OrbPreview.svelte'
  import { colorCss, ORB_PALETTE } from 'game/profile/palette'
  import { NAME_MAX, validName } from 'game/profile/profile'

  /** The saved profile; edits stay local until Save. */
  export let profile
  export let onSave
  export let onBack

  const COLUMNS = 8
  const swatchRows = Array.from({ length: ORB_PALETTE.length / COLUMNS }, (_, r) =>
    ORB_PALETTE.slice(r * COLUMNS, (r + 1) * COLUMNS),
  )
  // Name / the swatch rows / Save | Back
  const grid = [1, ...swatchRows.map((row) => row.length), 2]
  const NAME_ROW = 0
  const ACTIONS_ROW = grid.length - 1
  const refs = grid.map(() => [])
  let selection = { row: NAME_ROW, col: 0 }

  let name = profile.name
  let color = profile.color
  $: draft = { name: name.trim(), color }
  $: canSave = validName(draft.name)

  const save = () => {
    if (canSave) onSave(draft)
  }

  const select = (row, col) => {
    if (selection.row !== row || selection.col !== col) selection = { row, col }
  }

  $: refs[selection.row][selection.col]?.focus()

  const apply = (action) => {
    if (action === 'confirm') refs[selection.row][selection.col]?.click()
    else if (action === 'back') onBack()
    else selection = move(grid, selection, action)
  }

  // While typing a name, only these keys leave the field; the rest (WASD, Space, ←→) are text
  const NAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter', 'NumpadEnter'])

  const onKeydown = (event) => {
    const inName = event.target === refs[NAME_ROW][0]
    if (inName && !NAME_KEYS.has(event.code)) return
    if (inName && (event.code === 'Enter' || event.code === 'NumpadEnter')) {
      event.preventDefault()
      save()
      return
    }
    const action = menuActionForKey(event)
    if (!action) return
    event.preventDefault()
    apply(action)
  }

  usePadMenu({ action: apply })
</script>

<svelte:window on:keydown={onKeydown} />

<div class="customize card" role="dialog" aria-modal="true" aria-labelledby="customize-title">
  <h2 id="customize-title">Customize</h2>

  <OrbPreview profile={draft} />

  <label for="customize-name">Name</label>
  <input
    id="customize-name"
    type="text"
    autocomplete="off"
    spellcheck="false"
    maxlength={NAME_MAX}
    class:selected={selection.row === NAME_ROW}
    aria-invalid={!canSave}
    aria-describedby="customize-name-hint"
    bind:value={name}
    bind:this={refs[NAME_ROW][0]}
    on:focusin={() => select(NAME_ROW, 0)} />
  <p id="customize-name-hint" class="hint" class:error={!canSave}>
    2–{NAME_MAX} letters, numbers or spaces
  </p>

  <span class="label" id="customize-color">Orb color</span>
  <div class="swatches" role="radiogroup" aria-labelledby="customize-color">
    {#each swatchRows as row, r}
      {#each row as swatch, c}
        <button
          class="swatch"
          role="radio"
          aria-checked={color === swatch.name}
          aria-label={swatch.name}
          title={swatch.name}
          class:chosen={color === swatch.name}
          class:selected={selection.row === r + 1 && selection.col === c}
          style="--orb: {colorCss(swatch.name)}"
          bind:this={refs[r + 1][c]}
          on:pointermove={() => select(r + 1, c)}
          on:focusin={() => select(r + 1, c)}
          on:click={() => (color = swatch.name)}><span class="orb"></span></button>
      {/each}
    {/each}
  </div>
  <p class="chosen-name">{color}</p>

  <div class="actions">
    <button
      class="button"
      class:selected={selection.row === ACTIONS_ROW && selection.col === 0}
      disabled={!canSave}
      bind:this={refs[ACTIONS_ROW][0]}
      on:pointermove={() => select(ACTIONS_ROW, 0)}
      on:focusin={() => select(ACTIONS_ROW, 0)}
      on:click={save}>Save</button>
    <button
      class="button button-outline"
      class:selected={selection.row === ACTIONS_ROW && selection.col === 1}
      bind:this={refs[ACTIONS_ROW][1]}
      on:pointermove={() => select(ACTIONS_ROW, 1)}
      on:focusin={() => select(ACTIONS_ROW, 1)}
      on:click={onBack}>Back</button>
  </div>
</div>

<style>
  .customize {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: min(440px, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    background-color: rgba(10, 14, 32, 0.9);
  }

  h2 {
    margin-bottom: 0;
    color: var(--primary);
    text-shadow: 0 0 14px rgba(46, 230, 214, 0.6);
  }

  label,
  .label {
    font-weight: 700;
    margin: 0;
  }

  input {
    margin-bottom: 0;
  }

  .hint {
    margin: 0 0 0.6rem;
    font-size: 1.2rem;
    color: #9aa6c4;
  }

  .hint.error {
    color: var(--secondary);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.4rem;
    margin-top: 0.4rem;
  }

  .swatch {
    aspect-ratio: 1;
    padding: 0.2rem;
    border: 2px solid transparent;
    border-radius: 50%;
    background: none;
    cursor: pointer;
    transition: transform 0.12s;
  }

  .swatch:is(:focus, :focus-visible) {
    outline: none;
  }

  /* The orb art's own shape, lit white in the middle like the in-game orb */
  .orb {
    display: block;
    width: 100%;
    height: 100%;
    background: radial-gradient(circle, #fff 0 8%, var(--orb) 38%);
    -webkit-mask: url('/static/assets/OrbLight.png') center / contain no-repeat;
    mask: url('/static/assets/OrbLight.png') center / contain no-repeat;
  }

  .swatch.selected {
    border-color: rgba(255, 255, 255, 0.55);
  }

  .swatch.chosen {
    border-color: #fff;
    transform: scale(1.18);
    box-shadow: 0 0 12px var(--orb);
  }

  .chosen-name {
    margin: 0.4rem 0 0.6rem;
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  .actions .button {
    margin-bottom: 0;
  }

  /* One highlight only: the selection */
  .customize .button.selected {
    background-color: #7ff5ea;
    border-color: #fff;
    color: var(--darkText);
    box-shadow: 0 0 20px rgba(46, 230, 214, 0.8);
  }

  .customize .button:is(:focus, :focus-visible) {
    outline: none;
  }

  .customize .button[disabled] {
    opacity: 0.4;
  }
</style>
