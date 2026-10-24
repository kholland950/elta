<script lang="ts">
  import { generateStage } from '../game/race/generateStage'
  import { ARCHETYPES, type Archetype } from '../game/race/archetype'
  import type { RaceStage } from '../game/race/stage'
  import { checkCeilings, checkGuarantee, stageStats } from '../game/race/stageChecks'
  import { stageThumb } from '../game/fx/stageThumb'

  const CARDS = 12
  const PX_PER_CELL = 4

  const params = new URLSearchParams(window.location.search)
  const num = (key: string, fallback: number, min: number, max: number) => {
    const n = Number.parseInt(params.get(key) ?? '', 10)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  const base = num('gallery', 1, -2147483648, 2147483647)
  const diff = num('diff', 4, 1, 10)
  const bays = num('bays', 4, 1, 8)

  // The generator is gaining a 4th `archetype` parameter; passing it is harmless to the old signature
  const gen = generateStage as unknown as (seed: number, d: number, b: number, a?: Archetype) => RaceStage

  interface Card {
    archetype: Archetype
    seed: number
    stage: RaceStage | null
    error: string
  }

  const cards: Card[] = Array.from({ length: CARDS }, (_, i) => {
    const archetype = ARCHETYPES[i % ARCHETYPES.length]
    const seed = base + i
    try {
      return { archetype, seed, stage: gen(seed, diff, bays, archetype), error: '' }
    } catch (e) {
      return { archetype, seed, stage: null, error: String(e) }
    }
  })

  // Svelte action: paint the thumbnail onto the card's canvas
  const paint = (canvas: HTMLCanvasElement, stage: RaceStage) => {
    const t = stageThumb(stage, PX_PER_CELL)
    canvas.width = t.w
    canvas.height = t.h
    canvas.getContext('2d')?.putImageData(new ImageData(t.rgba, t.w, t.h), 0, 0)
  }
</script>

<div class="gallery">
  <h1 class="gallery-title">Stage gallery</h1>
  <p class="gallery-sub">
    base {base} / difficulty {diff} / bays {bays}. Change with ?gallery=&amp;diff=&amp;bays=. Orange/green: fork high/low, pink tint:
    west-heading, white: spine, yellow: finish, red dots: bays.
  </p>
  {#each cards as card (card.seed)}
    <section class="gallery-card">
      {#if card.stage}
        {@const stage = card.stage}
        {@const stats = stageStats(stage)}
        {@const ceil = checkCeilings(stage)}
        {@const guar = checkGuarantee(stage)}
        <header class="gallery-head">
          <strong class="gallery-arch">{card.archetype}</strong>
          <span>seed {card.seed}</span>
          <span>diff {stage.difficulty}</span>
          <span>par {(stats.parMs / 1000).toFixed(1)}s</span>
          <span>{stats.segments} segs</span>
          <span>runs {stats.runPct}%</span>
          <span>west {stats.westSegments}</span>
          <span>forks {stats.forks}</span>
        </header>
        <div class="gallery-checks">
          <span class={ceil.ok ? 'gallery-ok' : 'gallery-bad'}>ceilings {ceil.ok ? 'ok' : 'FAIL'}: {ceil.detail}</span>
          <span class={guar.ok ? 'gallery-ok' : 'gallery-bad'}>guarantee {guar.ok ? 'ok' : 'FAIL'}: {guar.detail}</span>
        </div>
        <div class="gallery-scroll">
          <canvas use:paint={stage}></canvas>
        </div>
      {:else}
        <header class="gallery-head">
          <strong class="gallery-arch">{card.archetype}</strong>
          <span>seed {card.seed}</span>
        </header>
        <div class="gallery-checks"><span class="gallery-bad">generation failed: {card.error}</span></div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .gallery {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    padding: 1.6rem 2rem 3rem;
    background: rgba(5, 8, 16, 0.82);
    color: var(--text);
  }
  .gallery-title {
    font-family: 'Orbitron', 'Comfortaa', sans-serif;
    letter-spacing: 0.3em;
    color: var(--text);
    text-shadow:
      0 0 8px var(--primary),
      0 0 28px var(--primary);
  }
  .gallery-sub {
    opacity: 0.75;
    font-size: 1.3rem;
  }
  .gallery-card {
    margin-bottom: 1.6rem;
    padding: 1rem 1.2rem;
    background: var(--glass);
    border: 1px solid var(--primary);
    border-radius: 6px;
    box-shadow: var(--glow);
  }
  .gallery-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.6rem;
    align-items: baseline;
    font-size: 1.3rem;
  }
  .gallery-arch {
    font-family: 'Orbitron', 'Comfortaa', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--primary);
  }
  .gallery-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 1.6rem;
    margin: 0.4rem 0 0.8rem;
    font-size: 1.2rem;
  }
  .gallery-ok {
    color: #6bff9c;
  }
  .gallery-bad {
    color: var(--secondary);
  }
  .gallery-scroll {
    overflow-x: auto;
    border: 1px solid rgba(46, 230, 214, 0.25);
  }
  .gallery-scroll canvas {
    display: block;
    image-rendering: pixelated;
  }
</style>
