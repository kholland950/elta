import '../css/global.css'

import { mount } from 'svelte'
import App from './app/App.svelte'
import Gallery from './app/Gallery.svelte'

// The stage gallery is a dev tool: only dev/watch builds (or an undefined build id) mount it
const devBuild = typeof __BUILD_ID__ === 'undefined' || __BUILD_ID__ === 'dev'
const params = new URLSearchParams(window.location.search)
const gallery = devBuild && params.has('gallery')

const app = gallery
  ? mount(Gallery, { target: document.body })
  : mount(App, {
      target: document.body,
      props: {
        name: 'world',
      },
    })

export default app
