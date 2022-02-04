// NOTE: Rename this at some point?
// The intent of this object is to allow Phaser events to set
// data and cause renders in svelte.
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
