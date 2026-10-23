/** Per-mote parameters for the dash wisps, rolled once when the dash starts. */
export interface WispSeed {
	/** Delay after the dash before the mote is shed (it is born at the orb's position then). */
	delayMs: number;
	lifeMs: number;
	/** How far the mote drifts backward, opposite the dash, over its life (px). */
	drift: number;
	/** Slow vertical drift over its life (px, negative is up). */
	rise: number;
	/** Sideways fan-out across the drift, as a fraction of the drift (signed). */
	spread: number;
	/** Wobble amplitude (px) and cycles over the mote's life. */
	amplitude: number;
	cycles: number;
	/** Wobble phase (radians). */
	phase: number;
	startScale: number;
	endScale: number;
	peakAlpha: number;
}

export interface WispFrame {
	/** Offset from the point the mote was shed. */
	x: number;
	y: number;
	scale: number;
	alpha: number;
}

/** Motes are shed over this much of the dash's start. */
export const WISP_SHED_MS = 20;
// Exhaust: many small, white-hot sparks that streak back fast and burn out as they shrink
const LIFE_MS = { min: 200, max: 360 };
const DRIFT = { min: 160, max: 380 };
const RISE = { min: -14, max: 6 };
// Sparks fan out in a cone around the trail (about ±35°) so the trail doesn't cover them
const SPREAD = { min: -0.2, max: 0.2 };
const AMPLITUDE = { min: 4, max: 12 };
const CYCLES = { min: 0.5, max: 1.1 };
const SCALE_START = { min: 0.09, max: 0.17 };
// End scale as a fraction of the start: sparks shrink as they cool
const SCALE_FALLOFF = { min: 0.25, max: 0.5 };
const PEAK_ALPHA = { min: 1, max: 1 };
// Fraction of life spent fading in; short so sparks flash on at full brightness
export const WISP_FADE_IN = 0.01;

const between = (rand: () => number, range: { min: number; max: number }) =>
	range.min + (range.max - range.min) * rand();

/** Rolls `count` motes spread evenly across the shed window, each with its own wobble. */
export const wispSeeds = (
	count: number,
	rand: () => number = Math.random,
): Array<WispSeed> => {
	const seeds: Array<WispSeed> = [];
	for (let i = 0; i < count; i++) {
		const startScale = between(rand, SCALE_START);
		seeds.push({
			delayMs: count > 1 ? (WISP_SHED_MS * i) / (count - 1) : 0,
			lifeMs: between(rand, LIFE_MS),
			drift: between(rand, DRIFT),
			rise: between(rand, RISE),
			spread: between(rand, SPREAD),
			amplitude: between(rand, AMPLITUDE),
			cycles: between(rand, CYCLES),
			phase: rand() * Math.PI * 2,
			startScale,
			endScale: startScale * between(rand, SCALE_FALLOFF),
			peakAlpha: between(rand, PEAK_ALPHA),
		});
	}
	return seeds;
};

/**
 * Where a mote is `t` (0..1) through its life, for a dash in direction `dir`. It eases backward,
 * opposite the dash, and curls: a sine wobble across the drift plus a smaller one along it, both
 * growing from zero so every mote leaves the orb on the same point.
 */
export const wispFrame = (
	seed: WispSeed,
	t: number,
	dir: 1 | -1,
): WispFrame => {
	const u = Math.min(Math.max(Number.isFinite(t) ? t : 1, 0), 1);
	// Quartic ease-out: sparks blast out almost instantly, then hang and burn out
	const travel = 1 - (1 - u) ** 4;
	const angle = seed.phase + seed.cycles * Math.PI * 2 * u;
	const wobble = seed.amplitude * u;
	const alpha =
		u < WISP_FADE_IN
			? seed.peakAlpha * (u / WISP_FADE_IN)
			: seed.peakAlpha * (1 - (u - WISP_FADE_IN) / (1 - WISP_FADE_IN)) ** 2;
	return {
		x:
			-dir *
			(seed.drift * travel +
				wobble * 0.5 * (Math.cos(angle) - Math.cos(seed.phase))),
		y:
			seed.spread * seed.drift * travel +
			seed.rise * u +
			wobble * (Math.sin(angle) - Math.sin(seed.phase)),
		scale: seed.startScale + (seed.endScale - seed.startScale) * travel,
		alpha,
	};
};
