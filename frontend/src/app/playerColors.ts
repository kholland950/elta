/** CSS colors for the player color names the server accepts (Room.kt). */
export const PLAYER_COLORS: Readonly<Record<string, string>> = {
  Blue: '#3d7bff',
  Green: '#3dff7b',
  Orange: '#ff9a3d',
  Red: '#ff4d4d',
  Violet: '#a46bff',
  Yellow: '#ffe83d',
}

export const cssColor = (name: string): string => PLAYER_COLORS[name] ?? name.toLowerCase()
