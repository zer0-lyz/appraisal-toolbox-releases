function getStorageValue(chromeApi, key) {
  return new Promise((resolve) => {
    chromeApi.storage.local.get([key], (values) => resolve(values?.[key]));
  });
}

function setStorageValue(chromeApi, values) {
  return new Promise((resolve) => chromeApi.storage.local.set(values, resolve));
}

function removeStorageValue(chromeApi, key) {
  return new Promise((resolve) => chromeApi.storage.local.remove([key], resolve));
}

export class ModuleStorage {
  constructor(chromeApi, moduleId, schemaVersion = 1) {
    this.chrome = chromeApi;
    this.moduleId = moduleId;
    this.schemaVersion = schemaVersion;
    this.key = `appraisalToolboxModule:${moduleId}:v${schemaVersion}`;
  }

  async load(fallback = null) {
    const value = await getStorageValue(this.chrome, this.key);
    return value === undefined ? fallback : value;
  }

  async save(value) {
    await setStorageValue(this.chrome, { [this.key]: value });
    return value;
  }

  async clear() {
    await removeStorageValue(this.chrome, this.key);
  }

  async migrateLegacy(legacyKey, fallback = null) {
    const current = await this.load(undefined);
    if (current !== undefined) return current;
    const legacy = await getStorageValue(this.chrome, legacyKey);
    if (legacy === undefined) return fallback;
    await this.save(legacy);
    return legacy;
  }
}

export function createModuleStorageFactory(chromeApi) {
  return (moduleId, schemaVersion = 1) =>
    new ModuleStorage(chromeApi, moduleId, schemaVersion);
}
