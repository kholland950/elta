import '../css/global.css'
import { startGame } from './game/Game'

import { mount } from 'svelte'
import App from './app/App.svelte'

const app = mount(App, {
  target: document.body,
  props: {
    name: 'world',
  },
})

if (window.location.hash) {
  startGame()
}

export default app
