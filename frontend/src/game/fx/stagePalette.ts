/** Neon colours for stage pieces (rock, tunnels, pads, the energy sea and the finish). */
export const STAGE_PALETTE = {
  solidFill: 0x040914,
  solidFillAlpha: 0.94,
  tunnelFill: 0x0d4d66,
  tunnelFillAlpha: 0.32,
  solidEdge: 0x00e5ff,
  padFill: 0x5a0f5e,
  padEdge: 0xff3df0,
  seaFill: 0x0090b0,
  seaFillAlpha: 0.38,
  seaEdge: 0x5ff6ff,
  finish: 0xf4ff6b,
  /** Start-bay gate barrier: hot orange-red (a stop light), with a near-white core. */
  gate: 0xff6a3d,
  gateCore: 0xffe2d6,
} as const

/** Glow passes for a neon edge, widest and faintest first; the last is the crisp core line. */
export const GLOW_PASSES: ReadonlyArray<{ width: number; alpha: number }> = [
  { width: 14, alpha: 0.08 },
  { width: 7, alpha: 0.2 },
  { width: 2, alpha: 1 },
]
