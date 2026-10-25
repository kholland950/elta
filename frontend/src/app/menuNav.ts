/** What any input device (keyboard now, gamepad later) asks a menu to do. */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev' | 'confirm' | 'back'

/** Item count per row, top to bottom. */
export type MenuGrid = number[]

export interface Selection {
  row: number
  col: number
}

const wrap = (n: number, size: number) => ((n % size) + size) % size

const clampCol = (grid: MenuGrid, row: number, col: number) => Math.min(col, grid[row] - 1)

/**
 * Up/Down wrap between rows and keep the column (clamped to the row's width); Left/Right stop at
 * the row's ends; Next/Prev walk every item in reading order and wrap. Other actions don't move.
 */
export const move = (grid: MenuGrid, sel: Selection, action: MenuAction): Selection => {
  switch (action) {
    case 'up':
    case 'down': {
      const row = wrap(sel.row + (action === 'down' ? 1 : -1), grid.length)
      return { row, col: clampCol(grid, row, sel.col) }
    }
    case 'left':
      return { row: sel.row, col: Math.max(sel.col - 1, 0) }
    case 'right':
      return { row: sel.row, col: clampCol(grid, sel.row, sel.col + 1) }
    case 'next':
    case 'prev': {
      const total = grid.reduce((sum, n) => sum + n, 0)
      const index = grid.slice(0, sel.row).reduce((sum, n) => sum + n, 0) + sel.col
      let rest = wrap(index + (action === 'next' ? 1 : -1), total)
      let row = 0
      while (rest >= grid[row]) rest -= grid[row++]
      return { row, col: rest }
    }
    default:
      return sel
  }
}
