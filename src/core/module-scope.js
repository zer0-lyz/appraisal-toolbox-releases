export class ModuleScope {
  #cleanups = [];
  #disposed = false;

  add(cleanup) {
    if (typeof cleanup !== "function") return cleanup;
    if (this.#disposed) {
      cleanup();
      return cleanup;
    }
    this.#cleanups.push(cleanup);
    return cleanup;
  }

  on(target, eventName, listener, options) {
    if (!target?.addEventListener) return listener;
    target.addEventListener(eventName, listener, options);
    this.add(() => target.removeEventListener(eventName, listener, options));
    return listener;
  }

  subscribe(eventBus, type, listener) {
    this.add(eventBus.subscribe(type, listener));
    return listener;
  }

  interval(callback, delay) {
    const timer = window.setInterval(callback, delay);
    this.add(() => window.clearInterval(timer));
    return timer;
  }

  timeout(callback, delay = 0) {
    const timer = window.setTimeout(callback, delay);
    this.add(() => window.clearTimeout(timer));
    return timer;
  }

  abortController() {
    const controller = new AbortController();
    this.add(() => controller.abort());
    return controller;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const cleanup of this.#cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error("Module cleanup failed", error);
      }
    }
    this.#cleanups = [];
  }
}
