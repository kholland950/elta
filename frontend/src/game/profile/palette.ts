export interface OrbColor {
  name: string
  hex: number
}

/**
 * The orb colors a player can pick: 32 neon hues, evenly spaced around the wheel
 * (hsl(i × 11.25°, 100%, 62%)). The names are what goes on the wire and must match
 * `ORB_COLORS` in `src/race/Palette.kt`.
 */
export const ORB_PALETTE: readonly OrbColor[] = [
  { name: 'Red', hex: 0xff3d3d },
  { name: 'Scarlet', hex: 0xff623d },
  { name: 'Vermilion', hex: 0xff863d },
  { name: 'Orange', hex: 0xffaa3d },
  { name: 'Amber', hex: 0xffcf3d },
  { name: 'Yellow', hex: 0xfff33d },
  { name: 'Citrine', hex: 0xe7ff3d },
  { name: 'Lime', hex: 0xc2ff3d },
  { name: 'Chartreuse', hex: 0x9eff3d },
  { name: 'Leaf', hex: 0x7aff3d },
  { name: 'Clover', hex: 0x55ff3d },
  { name: 'Emerald', hex: 0x3dff49 },
  { name: 'Jade', hex: 0x3dff6e },
  { name: 'Green', hex: 0x3dff92 },
  { name: 'Mint', hex: 0x3dffb6 },
  { name: 'Seafoam', hex: 0x3dffdb },
  { name: 'Aqua', hex: 0x3dffff },
  { name: 'Cyan', hex: 0x3ddbff },
  { name: 'Sky', hex: 0x3db6ff },
  { name: 'Blue', hex: 0x3d92ff },
  { name: 'Cobalt', hex: 0x3d6eff },
  { name: 'Sapphire', hex: 0x3d49ff },
  { name: 'Indigo', hex: 0x553dff },
  { name: 'Iris', hex: 0x7a3dff },
  { name: 'Violet', hex: 0x9e3dff },
  { name: 'Amethyst', hex: 0xc23dff },
  { name: 'Purple', hex: 0xe73dff },
  { name: 'Orchid', hex: 0xff3df3 },
  { name: 'Magenta', hex: 0xff3dcf },
  { name: 'Fuchsia', hex: 0xff3daa },
  { name: 'Rose', hex: 0xff3d86 },
  { name: 'Crimson', hex: 0xff3d62 },
]

const byName = new Map(ORB_PALETTE.map((c) => [c.name, c.hex]))

// Unknown names (an older or newer build) still draw, in white
const FALLBACK_HEX = 0xffffff

export const isPaletteColor = (name: unknown): name is string =>
  typeof name === 'string' && byName.has(name)

/** Phaser tint for a color name. */
export const colorHex = (name: string): number => byName.get(name) ?? FALLBACK_HEX

/** CSS color for a color name. */
export const colorCss = (name: string): string => `#${colorHex(name).toString(16).padStart(6, '0')}`

/** A palette color picked with `rng` (0 ≤ rng() < 1). */
export const randomColor = (rng: () => number): string =>
  ORB_PALETTE[Math.min(ORB_PALETTE.length - 1, Math.floor(rng() * ORB_PALETTE.length))].name
