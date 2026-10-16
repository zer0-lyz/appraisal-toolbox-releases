"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  createMacOSUpdateEngine,
  extensionIdFromKey,
} = require("./update_engine_macos.js");

const EXTENSION_ID = "aamfmhcbjgofhmannejoiilkkpchfkgm";
const NATIVE_HOST = "com.appraisal.toolbox.helper";
const REPOSITORY = "zer0-lyz/appraisal-toolbox-releases";
const ASSET_URL = "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.2/appraisal-toolbox-macos-arm64.zip";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

function fixturePackage(root) {
  const packageRoot = path.join(root, "candidate");
  const productVersion = "0.2.2";
  const buildNumber = 2026101601;
  const buildId = "sync-update-20261016";
  const runtimeBuildId = "a".repeat(64);
  const manifestKey = require("../manifest.json").key;
  fs.mkdirSync(path.join(packageRoot, "extension"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "native-helper"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "runtime/node/bin"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "skills/fixture"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "extension/version.json"), JSON.stringify({
    productVersion, buildNumber, platformBuildId: buildId,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(packageRoot, "extension/manifest.json"), JSON.stringify({
    manifest_version: 3, version: productVersion, version_name: productVersion, key: manifestKey,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(packageRoot, "extension/runtime-compat.json"), JSON.stringify({
    extensionVersion: productVersion, buildId, runtimeBuildKind: "release", runtimeBuildId,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(packageRoot, "native-helper/native_host.js"), "// synthetic Native Host\n");
  fs.writeFileSync(path.join(packageRoot, "runtime/node/bin/node"), "synthetic-node-runtime\n");
  fs.writeFileSync(path.join(packageRoot, "skills/fixture/module.py"), "VALUE = 1\n");
  fs.writeFileSync(path.join(packageRoot, "安装.command"), `#!/bin/bash\nINSTALLER_BUILD="macos-update-test.1"\n`);
  fs.chmodSync(path.join(packageRoot, "安装.command"), 0o755);
  fs.writeFileSync(path.join(packageRoot, "release-inputs.lock.json"), "{}\n");
  fs.writeFileSync(path.join(packageRoot, "SOURCE-INVENTORY.json"), "[]\n");
  writeJson(path.join(packageRoot, "BUILD-PROVENANCE.json"), {
    target: "macos-arm64", sourceDirty: false, sourceCommit: "f".repeat(40),
    productVersion, buildId, buildNumber, installerBuild: "macos-update-test.1",
    lockSha256: hash(fs.readFileSync(path.join(packageRoot, "release-inputs.lock.json"))),
    sourceInventorySha256: hash(fs.readFileSync(path.join(packageRoot, "SOURCE-INVENTORY.json"))),
  });
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(path.relative(packageRoot, file).split(path.sep).join("/"));
    }
  }
  walk(packageRoot);
  fs.writeFileSync(path.join(packageRoot, "SHA256SUMS"), files.sort()
    .map((file) => `${hash(fs.readFileSync(path.join(packageRoot, file)))}  ${file}`).join("\n") + "\n");
  return { packageRoot, productVersion, buildNumber, buildId, runtimeBuildId };
}

function legacyInstall(root, packageInfo, pythonPath) {
  const installRoot = path.join(root, ".appraisal-toolbox");
  const extension = path.join(installRoot, "extension");
  fs.mkdirSync(extension, { recursive: true });
  const currentManifest = require("../manifest.json");
  writeJson(path.join(extension, "manifest.json"), currentManifest);
  writeJson(path.join(extension, "version.json"), {
    productVersion: "0.2.1", buildNumber: 2026101101, platformBuildId: "previous-build",
  });
  writeJson(path.join(extension, "runtime-compat.json"), {
    runtimeBuildKind: "release", runtimeBuildId: "b".repeat(64),
  });
  writeJson(path.join(installRoot, "native-helper/runtime-config.json"), {
    toolboxExtensionId: EXTENSION_ID, nativeHostName: NATIVE_HOST, pythonBin: pythonPath,
  });
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, "synthetic-python\n");
  fs.mkdirSync(path.join(installRoot, "history"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "history/preserved.txt"), "synthetic user data\n");
  return installRoot;
}

test("packaged public key retains the installed Chrome extension ID", () => {
  assert.equal(extensionIdFromKey(require("../manifest.json").key), EXTENSION_ID);
});

test("Mac updater rechecks the official target, verifies SHA, and installs/configures in an isolated home", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "appraisal-macos-update-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  fs.mkdirSync(homeDir, { recursive: true });
  const packageInfo = fixturePackage(root);
  const zipBytes = Buffer.from("synthetic signed-by-release-hash package bytes");
  const targetSha = hash(zipBytes);
  const pythonPath = path.join(homeDir, ".appraisal-toolbox/python/bin/python3");
  const installRoot = legacyInstall(homeDir, packageInfo, pythonPath);
  const latest = {
    ok: true, releasePublished: true, updateAvailable: true, repairRequired: false,
    platform: "macos-arm64", latestVersion: packageInfo.productVersion,
    latestBuildNumber: packageInfo.buildNumber, latestRuntimeBuildId: packageInfo.runtimeBuildId,
    latestRuntimeBuildKind: "release",
    asset: { name: "appraisal-toolbox-macos-arm64.zip", url: ASSET_URL, size: zipBytes.length, sha256: targetSha },
    downloadCandidates: [{ source: "github-release", url: ASSET_URL, size: zipBytes.length, sha256: targetSha }],
  };
  let downloadCalls = 0;
  const progress = [];
  let failInstaller = false;
  const runFileSync = (command, args, options) => {
    if (command === pythonPath && args[0] === "--version") return "Python 3.14.6\n";
    if (command === pythonPath && args[0] === "-c") return "";
    if (command.endsWith("/runtime/node/bin/node") && args.includes("--self-test")) {
      return JSON.stringify({ ok: true, pythonSkillImportSmoke: { ok: true } });
    }
    return execFileSync(command, args, options);
  };
  const engine = createMacOSUpdateEngine({
    platform: "darwin", architecture: "arm64", homeDir, installRoot,
    execFileSync: runFileSync,
    downloadAttempts: 3,
    retryDelayMs: 0,
    downloadAsset: async (_url, targetPath) => {
      downloadCalls += 1;
      if (downloadCalls === 1) throw new Error("UPDATE_DOWNLOAD_NETWORK_FAILED");
      fs.writeFileSync(targetPath, zipBytes, { mode: 0o600 });
      return { size: zipBytes.length, sha256: targetSha };
    },
    extractZip: async (_zipPath, extractRoot) => {
      fs.cpSync(packageInfo.packageRoot, path.join(extractRoot, "candidate"), { recursive: true });
    },
    installPackage: async ({ packageRoot, logPath }) => {
      fs.writeFileSync(logPath, "synthetic installer log\n");
      if (failInstaller) throw new Error("UPDATE_INSTALLER_EXIT_1");
      for (const component of ["extension", "native-helper", "skills", "runtime/node"]) {
        fs.rmSync(path.join(installRoot, component), { recursive: true, force: true });
        fs.cpSync(path.join(packageRoot, component), path.join(installRoot, component), { recursive: true });
      }
      writeJson(path.join(installRoot, "native-helper/runtime-config.json"), {
        pythonBin: pythonPath, printSkillsDir: path.join(installRoot, "skills"),
        toolboxExtensionId: EXTENSION_ID, nativeHostName: NATIVE_HOST,
      });
      const launcher = path.join(installRoot, "native-helper/native_host_launcher.sh");
      fs.writeFileSync(launcher, "#!/bin/bash\n", { mode: 0o700 });
      for (const browser of ["Google/Chrome", "Microsoft Edge"]) {
        const manifestPath = path.join(homeDir, "Library/Application Support", browser, "NativeMessagingHosts", `${NATIVE_HOST}.json`);
        writeJson(manifestPath, {
          name: NATIVE_HOST, path: launcher, type: "stdio",
          allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
        });
      }
      fs.writeFileSync(path.join(installRoot, "安装检查结果.txt"), [
        "安装状态：成功", `版本：${packageInfo.productVersion}`,
        `源码：${"f".repeat(40)}`, `扩展 ID：${EXTENSION_ID}`, `Native Host：${NATIVE_HOST}`,
      ].join("\n") + "\n");
    },
  });
  const checkUpdate = async (input) => {
    assert.equal(input.repository, REPOSITORY);
    assert.equal(input.platform, "darwin");
    assert.equal(input.architecture, "arm64");
    return latest;
  };
  const request = { url: ASSET_URL, sha256: "c".repeat(64) };
  const rejected = await engine.downloadAndInstallUpdate(request, (frame) => progress.push(frame), checkUpdate);
  assert.equal(rejected.reason, "UPDATE_TARGET_CHANGED");
  assert.equal(rejected.currentVersionUnchanged, true);
  assert.equal(downloadCalls, 0);
  const lockPath = path.join(homeDir, ".appraisal-toolbox-update.lock");
  fs.mkdirSync(lockPath);
  writeJson(path.join(lockPath, "owner.json"), { pid: 2147483647, installerPid: process.pid, nonce: "active", startedAt: new Date().toISOString() });
  const busy = await engine.downloadAndInstallUpdate({ ...request, sha256: targetSha }, (frame) => progress.push(frame), checkUpdate);
  assert.equal(busy.reason, "UPDATE_ALREADY_RUNNING");
  assert.equal(fs.existsSync(lockPath), true);
  fs.rmSync(lockPath, { recursive: true, force: true });
  fs.mkdirSync(lockPath);
  writeJson(path.join(lockPath, "owner.json"), { pid: 2147483647, nonce: "stale", startedAt: "2000-01-01T00:00:00.000Z" });
  const installed = await engine.downloadAndInstallUpdate({ ...request, sha256: targetSha }, (frame) => progress.push(frame), checkUpdate);
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(installed.platform, "macos-arm64");
  assert.equal(installed.latestVersion, packageInfo.productVersion);
  assert.equal(installed.latestBuildNumber, packageInfo.buildNumber);
  assert.equal(progress.filter((frame) => frame.event === "progress").length > 0, true);
  assert.equal(downloadCalls, 2, "transient network failure should be retried once");
  assert.equal(fs.existsSync(lockPath), false, "a dead updater lock should be recovered and released");
  assert.equal(JSON.parse(fs.readFileSync(path.join(installRoot, "extension/version.json"), "utf8")).productVersion, "0.2.2");
  assert.equal(fs.readFileSync(path.join(installRoot, "history/preserved.txt"), "utf8"), "synthetic user data\n");
  failInstaller = true;
  const failed = await engine.downloadAndInstallUpdate({ ...request, sha256: targetSha }, (frame) => progress.push(frame), checkUpdate);
  assert.equal(failed.reason, "UPDATE_INSTALLER_EXIT_1");
  assert.equal(failed.currentVersionUnchanged, true);
  assert.equal(fs.existsSync(lockPath), false, "a completed installer failure must release its lock");
});
