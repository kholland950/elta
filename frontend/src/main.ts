import '../css/global.css'

import { mount } from 'svelte'
import App from './app/App.svelte'

const app = mount(App, {
  target: document.body,
  props: {
    name: 'world',
  },
})

export default app
