"use strict";

const os = require("node:os");
const path = require("node:path");
const common = require("./common.js");

function createUnsupportedAdapter(options = {}) {
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const runtimeRoot = path.join(homeDir, ".appraisal-toolbox");

  function unsupportedPicker() {
    return Promise.resolve({
      ok: false,
      cancelled: false,
      reason: "PLATFORM_FILE_PICKER_UNSUPPORTED",
      security: common.security(),
    });
  }

  return {
    id: "unsupported",
    platform,
    isWindows: false,
    isMacOS: false,
    runtimeRoot,
    defaultPythonBin: "python3",
    defaultPrintSkillsDir: path.join(runtimeRoot, "skills"),
    cliCandidates: [],
    cliFallback: "tycpv",
    chooseDirectory: unsupportedPicker,
    openPath: async () => ({
      ok: false,
      reason: "PLATFORM_OPEN_PATH_UNSUPPORTED",
      security: common.security(),
    }),
    chooseWorkbookFiles: unsupportedPicker,
    chooseWordFiles: unsupportedPicker,
    chooseXlsxFile: unsupportedPicker,
    inspectActiveConversation: async () => ({
      ok: false,
      available: false,
      reason: "ACCESSIBILITY_CONVERSATION_UNSUPPORTED_PLATFORM",
      security: common.security(),
    }),
    createCredentialReference({ fallbackPath, key, secret }) {
      return common.createFileCredentialReference({ fallbackPath, key, secret });
    },
    diagnostics() {
      return {
        id: "unsupported",
        platform,
        supported: false,
        runtimeRoot,
        filePicker: "unsupported",
        credentialStore: "restricted-file",
        processControl: "unsupported",
        dependencies: {},
      };
    },
    async listenerPids() {
      return [];
    },
    async extractZip() {
      throw new Error("PLATFORM_UPDATE_UNSUPPORTED");
    },
    launchWorkbenchInstaller() {
      throw new Error("PLATFORM_UPDATE_UNSUPPORTED");
    },
    resolveCredentialReference(reference) {
      return common.resolveFileCredentialReference(reference);
    },
    async terminateProcess() {
      return false;
    },
  };
}

module.exports = { createUnsupportedAdapter };
