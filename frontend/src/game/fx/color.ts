/** Mixes a 0xRRGGBB colour toward white; `amount` 0 keeps it, 1 gives white. */
export const lighten = (color: number, amount: number): number => {
  const t = Math.min(1, Math.max(0, amount))
  const mix = (shift: number) => {
    const v = (color >> shift) & 0xff
    return Math.round(v + (255 - v) * t) << shift
  }
  return mix(16) | mix(8) | mix(0)
}
