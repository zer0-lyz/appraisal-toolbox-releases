"use strict";

// Shared update protocol with independently loaded Windows and macOS installers.
const windows = process.platform === "win32" && process.arch === "x64"
  ? require("../update_engine.js")
  : null;
const macOS = process.platform === "darwin"
  ? require("../update_engine_macos.js").createMacOSUpdateEngine()
  : null;

function capabilities() {
  return { autoUpdateSupported: Boolean(windows || macOS?.capabilities().autoUpdateSupported) };
}

function downloadAndInstallUpdate(message, emit, checkUpdate) {
  if (windows) return windows.downloadAndInstallUpdate(message, emit, checkUpdate);
  if (macOS) return macOS.downloadAndInstallUpdate(message, emit, checkUpdate);
  const result = {
    ok: false,
    event: "complete",
    action: "download_and_install_update",
    phase: "failed",
    percent: 0,
    reason: "PLATFORM_UPDATE_UNSUPPORTED",
    autoUpdateSupported: false,
    security: { credentialsReturned: false },
  };
  emit(result);
  return Promise.resolve(result);
}

module.exports = {
  capabilities,
  downloadAndInstallUpdate,
  isUpdating: () => Boolean(windows?.isUpdating() || macOS?.isUpdating()),
};
