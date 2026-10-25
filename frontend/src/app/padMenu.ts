import { onMount } from 'svelte'
import { gamepadHub, type PadMenuHandler } from 'game/input/gamepadHub'

/** Gives the calling menu component the pad while it is the top screen, from mount to destroy. */
export const usePadMenu = (handler: PadMenuHandler) => onMount(() => gamepadHub.pushMenu(handler))
