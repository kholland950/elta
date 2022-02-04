/**
 * General event/callback listener holder used for connecting Phaser to Svelte
 * NOTE: Maybe a better name for this? 'events' is pretty overloaded here
 *
 * @see Room.svelte
 */
class Events {
  private events: { [key: string]: Function }

  constructor() {
    this.events = {}
  }

  add(name: string, callback: Function) {
    this.events[name] = callback
  }

  send(name: string, ...args: any[]) {
    this.events[name](...args)
  }
}

const events = new Events()

export default events
