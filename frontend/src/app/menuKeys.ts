import type { MenuAction } from './menuNav'

const MOVES: Record<string, MenuAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
}

const PRESSES: Record<string, MenuAction> = {
  Space: 'confirm',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Escape: 'back',
}

type KeyLike = Pick<KeyboardEvent, 'code' | 'repeat' | 'shiftKey'>

/**
 * The menu action for a key, by physical position so WASD holds on any layout. Moves repeat while
 * held; confirm and back need a fresh press, so a key held from play can't act on the menu.
 */
export const menuActionForKey = (event: KeyLike): MenuAction | null => {
  if (event.code === 'Tab') return event.shiftKey ? 'prev' : 'next'
  if (MOVES[event.code]) return MOVES[event.code]
  if (PRESSES[event.code]) return event.repeat ? null : PRESSES[event.code]
  return null
}
