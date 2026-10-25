/** The browser's code → printed character map for the user's layout (Chromium only). */
export type LayoutMap = ReadonlyMap<string, string>

const NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Mouse0: 'Left Click',
  Mouse1: 'Middle Click',
  Mouse2: 'Right Click',
  Mouse3: 'Mouse Back',
  Mouse4: 'Mouse Forward',
}

/**
 * A readable name for a key code: the layout's own character where the browser tells us
 * (so KeyQ reads "A" on AZERTY), otherwise a fixed name from the US layout.
 */
export const keyLabel = (code: string, layout?: LayoutMap): string => {
  const printed = layout?.get(code)
  if (printed && printed.trim()) return printed.length === 1 ? printed.toUpperCase() : printed
  if (NAMES[code]) return NAMES[code]
  const mouse = /^Mouse(\d+)$/.exec(code)
  if (mouse) return `Mouse ${Number(mouse[1]) + 1}`
  const match = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(.+)$/.exec(code)
  if (match) return code.startsWith('Numpad') ? `Num ${match[1]}` : match[1]
  return code
}

/** The user's keyboard layout, or undefined where the browser won't say. */
export const loadLayoutMap = async (): Promise<LayoutMap | undefined> => {
  try {
    const keyboard = (navigator as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard
    return await keyboard?.getLayoutMap?.()
  } catch {
    return undefined
  }
}
