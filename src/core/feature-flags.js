const STORAGE_KEY = "appraisalToolboxFeatureFlags";

export class FeatureFlagService {
  constructor(chromeApi) {
    this.chrome = chromeApi;
    this.flags = {};
  }

  async load() {
    this.flags = await new Promise((resolve) => {
      this.chrome.storage.local.get([STORAGE_KEY], (values) => {
        const flags = values?.[STORAGE_KEY];
        resolve(flags && typeof flags === "object" ? flags : {});
      });
    });
    return this.flags;
  }

  isEnabled(manifest) {
    const value = this.flags[manifest.id];
    if (value === false || value === "disabled") return false;
    if (manifest.stage === "beta") return value === true || value === "enabled";
    return true;
  }
}
