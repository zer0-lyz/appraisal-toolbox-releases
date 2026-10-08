import { ModuleScope } from "./module-scope.js";

function validateManifest(manifest) {
  if (!manifest?.id || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    throw new Error("MODULE_ID_INVALID");
  }
  if (!manifest.route || !manifest.displayName) {
    throw new Error(`MODULE_MANIFEST_INCOMPLETE:${manifest.id}`);
  }
  if (
    !manifest.messageNamespace
    || !manifest.messageNamespace.startsWith(manifest.id)
  ) {
    throw new Error(`MODULE_MESSAGE_NAMESPACE_INVALID:${manifest.id}`);
  }
}

export class ModuleRegistry {
  constructor({ featureFlags, eventBus, storageFactory, documentRef = document }) {
    this.featureFlags = featureFlags;
    this.eventBus = eventBus;
    this.storageFactory = storageFactory;
    this.document = documentRef;
    this.entries = new Map();
    this.routes = new Map();
    this.activeEntry = null;
  }

  register(definition) {
    validateManifest(definition?.manifest);
    const { manifest } = definition;
    if (this.entries.has(manifest.id) || this.routes.has(manifest.route)) {
      throw new Error(`MODULE_ALREADY_REGISTERED:${manifest.id}`);
    }
    const entry = {
      definition,
      manifest: Object.freeze({ ...manifest }),
      enabled: false,
      initialized: false,
      scope: null,
      instance: null,
    };
    this.entries.set(manifest.id, entry);
    this.routes.set(manifest.route, entry);
    return entry;
  }

  async initialize(sharedContext) {
    await this.featureFlags.load();
    const initializeEntry = async (entry) => {
      entry.enabled = this.featureFlags.isEnabled(entry.manifest);
      this.#applyAvailability(entry);
      if (!entry.enabled) return;
      entry.scope = new ModuleScope();
      entry.instance = entry.definition.create
        ? entry.definition.create()
        : entry.definition;
      const context = Object.freeze({
        ...sharedContext,
        manifest: entry.manifest,
        eventBus: this.eventBus,
        scope: entry.scope,
        storage: this.storageFactory(
          entry.manifest.id,
          entry.manifest.storageVersion || 1,
        ),
      });
      try {
        await entry.instance.initialize?.(context);
        entry.initialized = true;
      } catch (error) {
        // A feature must not take down the whole side panel during startup.
        entry.initializationError = error;
        entry.enabled = false;
        entry.initialized = false;
        entry.scope?.dispose();
        this.#applyAvailability(entry);
        console.error(`Module initialization failed: ${entry.manifest.id}`, error);
        this.eventBus.publish("module.initializationFailed", {
          id: entry.manifest.id,
          route: entry.manifest.route,
          message: error?.message || String(error),
        });
      }
    };

    // Modules are independent. Initialize them concurrently so a slow module
    // cannot delay the rest of the workbench or leave the remembered route blank.
    await Promise.all([...this.entries.values()].map(initializeEntry));
    this.#renderModuleCount();
  }

  getByRoute(route) {
    return this.routes.get(route) || null;
  }

  routeExists(route) {
    const entry = this.getByRoute(route);
    return Boolean(entry?.enabled);
  }

  routeLabel(route) {
    return this.getByRoute(route)?.manifest?.displayName || "";
  }

  async activateRoute(route) {
    const next = this.getByRoute(route);
    if (this.activeEntry && this.activeEntry !== next) {
      await this.activeEntry.instance?.deactivate?.();
      this.eventBus.publish("module.deactivated", {
        id: this.activeEntry.manifest.id,
        route: this.activeEntry.manifest.route,
      });
      this.activeEntry = null;
    }
    if (!next?.enabled || !next.initialized) return;
    if (this.activeEntry !== next) {
      await next.instance?.activate?.();
      this.activeEntry = next;
      this.eventBus.publish("module.activated", {
        id: next.manifest.id,
        route: next.manifest.route,
      });
    }
  }

  async dispose() {
    for (const entry of [...this.entries.values()].reverse()) {
      await entry.instance?.dispose?.();
      entry.scope?.dispose();
    }
    this.entries.clear();
    this.routes.clear();
    this.eventBus.clear();
  }

  #applyAvailability(entry) {
    const { entryElementId, pageElementId, controlElementIds = [] } = entry.manifest;
    for (const elementId of [
      entryElementId,
      pageElementId,
      ...controlElementIds,
    ]) {
      const element = elementId ? this.document.getElementById(elementId) : null;
      if (!element) continue;
      element.classList.toggle("feature-disabled", !entry.enabled);
      element.toggleAttribute("hidden", !entry.enabled);
      element.dataset.moduleId = entry.manifest.id;
      element.dataset.moduleStage = entry.manifest.stage || "stable";
    }
  }

  #renderModuleCount() {
    const count = [...this.entries.values()].filter((entry) => entry.enabled && entry.manifest.countInModuleBadge !== false).length;
    const badge = this.document.getElementById("moduleCountBadge");
    if (badge) badge.textContent = count === 1 ? "1 个业务工具" : `${count} 个业务工具`;
  }
}
