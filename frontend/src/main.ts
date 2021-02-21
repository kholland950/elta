import '../css/global.css'
import 'phaser'
import { startGame } from './game/Game'

import App from './app/App.svelte'

const app = new App({
    target: document.body,
    props: {
        name: 'world'
    }
});

if (window.location.hash) {
    startGame()
}

export default app
