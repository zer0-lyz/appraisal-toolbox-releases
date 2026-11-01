"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const platformSource = fs.readFileSync(path.join(__dirname, "platform/update.js"), "utf8");
const nativeHostSource = fs.readFileSync(path.join(__dirname, "native_host.js"), "utf8");
const checkerSource = fs.readFileSync(path.join(__dirname, "update_checker.js"), "utf8");

function loadPlatform(platform, architecture, { macCapabilities, macStatus, winEngine } = {}) {
  let macLoadCount = 0;
  const module = { exports: {} };
  const fakeProcess = { platform, arch: architecture };
  const requireStub = (request) => {
    if (request === "../update_engine_macos.js") {
      macLoadCount++;
      return { createMacOSUpdateEngine: () => ({ capabilities: () => macCapabilities, getUpdateStatus: async () => macStatus }) };
    }
    if (request === "../update_engine.js") return winEngine;
    throw new Error(`unexpected require: ${request}`);
  };
  vm.runInNewContext(platformSource, { process: fakeProcess, require: requireStub, module }, { filename: "platform/update.js" });
  return { api: module.exports, macLoadCount };
}

(async () => {
  const macStatus = {
    ok: true, action: "wrong-action", state: "complete", phase: "complete", percent: 100,
    message: "verified", reason: "UPDATE_DONE", transactionId: "11111111-1111-4111-8111-111111111111",
    verified: true, recoveryBlocked: false, currentVersionUnchanged: null, platform: "macos-arm64",
    latestVersion: "0.2.3", latestBuildNumber: 2026102101,
    diagnostics: { installerStarted: true, failureStage: "verify", journalPath: "/private/secret", nonce: "secret" },
    journal: { env: { token: "secret" } }, env: { secret: true }, runtimeConfig: { secret: true },
  };
  const mac = loadPlatform("darwin", "arm64", {
    macCapabilities: { autoUpdateSupported: true, updateStatusSupported: true, extraMacCapability: "preserved" },
    macStatus,
  });
  const macCapabilities = mac.api.capabilities();
  assert.equal(macCapabilities.updateStatusSupported, true);
  assert.equal(macCapabilities.extraMacCapability, "preserved");
  const status = await mac.api.getUpdateStatus();
  assert.equal(status.action, "get_update_status");
  assert.equal(status.updateStatusSupported, true);
  assert.equal(status.currentVersionUnchanged, null, "unknown proof remains null");
  assert.deepEqual(Object.keys(status).sort(), [
    "action", "currentVersionUnchanged", "diagnostics", "latestBuildNumber", "latestVersion", "message",
    "ok", "percent", "phase", "platform", "reason", "recoveryBlocked", "state", "transactionId",
    "updateStatusSupported", "verified",
  ].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(status.diagnostics)), { installerStarted: true, failureStage: "verify" });
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.equal(mac.macLoadCount, 1);

  const windows = loadPlatform("win32", "x64", {
    macCapabilities: { updateStatusSupported: true },
    winEngine: { downloadAndInstallUpdate() {}, isUpdating: () => false },
  });
  assert.equal(windows.api.capabilities().autoUpdateSupported, true);
  assert.equal(windows.api.capabilities().updateStatusSupported, false);
  assert.deepEqual(JSON.parse(JSON.stringify(await windows.api.getUpdateStatus())), {
    ok: true, action: "get_update_status", updateStatusSupported: false, state: "idle", phase: "idle",
    percent: 0, verified: false, recoveryBlocked: false, platform: "windows-x64",
  });
  assert.equal(windows.macLoadCount, 0, "Windows must not load the Mac engine");

  const unsupported = loadPlatform("linux", "x64");
  assert.equal(unsupported.api.capabilities().updateStatusSupported, false);
  assert.equal((await unsupported.api.getUpdateStatus()).state, "idle");
  assert.equal(unsupported.macLoadCount, 0);

  assert.match(checkerSource, /function getUpdateStatus\(\)\s*\{\s*return platformUpdate\.getUpdateStatus\(\);/);
  assert.match(checkerSource, /module\.exports\s*=\s*\{[\s\S]*?getUpdateStatus,/);
  const allowlistSource = nativeHostSource.match(/const TOOLBOX_NATIVE_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert(allowlistSource, "Native allowlist is discoverable");
  const allowedActions = [...allowlistSource[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert(allowedActions.includes("get_update_status"));
  for (const action of ["install_workbench_update", "test_workbench_update", "get_workbench_update_status", "start_connector_bridge", "connector_action"]) {
    assert.equal(allowedActions.includes(action), false, `${action} remains blocked`);
  }
  assert.match(nativeHostSource, /if \(message\?\.action === "get_update_status"\)\s*\{\s*return await updateChecker\.getUpdateStatus\(\);/);
  assert.match(nativeHostSource, /if \(updateChecker\.isUpdateInProgress\(\)[\s\S]{0,200}&& message\?\.action !== "get_update_status"\)/);
  assert.match(nativeHostSource, /return handle\(message\)\s*\.then\(\(payload\)\s*=>\s*\{\s*writeMessage\(payload\);/);

  console.log(JSON.stringify({
    ok: true,
    evidenceType: "native-update-status-protocol-fixture",
    macStatusWhitelisted: true,
    unknownProofPreserved: true,
    windowsUnsupportedIdle: true,
    inheritedActionsBlocked: true,
    normalReplyFraming: true,
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
