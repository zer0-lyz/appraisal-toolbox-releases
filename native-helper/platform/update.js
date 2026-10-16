"use strict";
// Shared update protocol; only Windows x64 loads its installer implementation.
// macOS keeps the existing manual download/install flow and path policy.
const windows = process.platform === "win32" && process.arch === "x64"
  ? require("../update_engine.js") : null;
function capabilities() {
  return { autoUpdateSupported: Boolean(windows) };
}
function downloadAndInstallUpdate(message, emit, checkUpdate) {
  if (windows) return windows.downloadAndInstallUpdate(message, emit, checkUpdate);
  const result = {
    ok: false, event: "complete", action: "download_and_install_update",
    phase: "failed", percent: 0, reason: "PLATFORM_UPDATE_UNSUPPORTED",
    autoUpdateSupported: false, security: { credentialsReturned: false },
  };
  emit(result);
  return Promise.resolve(result);
}
module.exports = { capabilities, downloadAndInstallUpdate, isUpdating: () => windows?.isUpdating() || false };
