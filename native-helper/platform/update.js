"use strict";

// Shared update protocol with independently loaded Windows and macOS installers.
const windows = process.platform === "win32" && process.arch === "x64"
  ? require("../update_engine.js")
  : null;
const macOS = process.platform === "darwin"
  ? require("../update_engine_macos.js").createMacOSUpdateEngine()
  : null;

const STATUS_FIELDS = Object.freeze([
  "state", "phase", "percent", "message", "reason", "transactionId", "verified",
  "recoveryBlocked", "currentVersionUnchanged", "platform", "latestVersion", "latestBuildNumber",
]);
const STATUS_STATES = new Set([
  "idle", "starting", "busy", "installing", "recovering", "complete", "rolled_back", "failed_safe", "unknown",
]);

function platformName() {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  return `${process.platform}-${process.arch}`.slice(0, 40);
}

function capabilities() {
  const macCapabilities = macOS?.capabilities?.() || {};
  return {
    ...macCapabilities,
    autoUpdateSupported: Boolean(windows || macCapabilities.autoUpdateSupported),
    updateStatusSupported: macCapabilities.updateStatusSupported === true,
  };
}

function safeStatus(value, supported) {
  const out = {
    ok: value?.ok === true,
    action: "get_update_status",
    updateStatusSupported: supported,
  };
  for (const key of STATUS_FIELDS) {
    const item = value?.[key];
    if (item === undefined) continue;
    if (key === "state") out.state = STATUS_STATES.has(item) ? item : "unknown";
    else if (key === "phase") out.phase = String(item).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    else if (key === "percent") out.percent = Number.isFinite(Number(item)) ? Math.max(0, Math.min(100, Number(item))) : 0;
    else if (key === "message") out.message = String(item).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
    else if (key === "reason") out.reason = /^[A-Z0-9_]{1,80}$/.test(String(item)) ? String(item) : "UPDATE_STATUS_INVALID";
    else if (key === "transactionId") out.transactionId = /^[a-f0-9-]{36}$/i.test(String(item)) ? String(item) : "";
    else if (["verified", "recoveryBlocked"].includes(key)) out[key] = item === true;
    else if (key === "currentVersionUnchanged") out[key] = item === true ? true : (item === false ? false : null);
    else if (key === "platform") out.platform = /^[a-z0-9-]{1,40}$/i.test(String(item)) ? String(item) : platformName();
    else if (key === "latestVersion") out.latestVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(item)) ? String(item) : "";
    else if (key === "latestBuildNumber") out.latestBuildNumber = Number.isSafeInteger(Number(item)) && Number(item) >= 0 ? Number(item) : 0;
  }
  if (value?.diagnostics && typeof value.diagnostics === "object") {
    out.diagnostics = {
      installerStarted: value.diagnostics.installerStarted === true,
      failureStage: String(value.diagnostics.failureStage || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40),
    };
  }
  return out;
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

async function getUpdateStatus() {
  const supported = capabilities().updateStatusSupported;
  if (!supported || typeof macOS?.getUpdateStatus !== "function") {
    return safeStatus({
      ok: true,
      state: "idle",
      phase: "idle",
      percent: 0,
      verified: false,
      recoveryBlocked: false,
      platform: platformName(),
    }, false);
  }
  try {
    return safeStatus(await macOS.getUpdateStatus(), true);
  } catch {
    return safeStatus({
      ok: false,
      state: "unknown",
      phase: "unknown",
      reason: "UPDATE_STATUS_READ_FAILED",
      message: "更新状态暂不可读取，已阻止重复安装。",
      verified: false,
      recoveryBlocked: true,
      platform: platformName(),
    }, true);
  }
}

module.exports = {
  capabilities,
  downloadAndInstallUpdate,
  getUpdateStatus,
  isUpdating: () => Boolean(windows?.isUpdating() || macOS?.isUpdating()),
};
