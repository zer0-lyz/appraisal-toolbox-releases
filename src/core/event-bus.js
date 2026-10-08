export class EventBus {
  #listeners = new Map();

  subscribe(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(listener);
    return () => this.#listeners.get(type)?.delete(listener);
  }

  publish(type, payload) {
    for (const listener of this.#listeners.get(type) || []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Event listener failed: ${type}`, error);
      }
    }
  }

  clear() {
    this.#listeners.clear();
  }
}
