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

// Synthetic package/installer fault injection. Real package installation is tested separately.
const {runMacOSUpdateTransaction} = require('./macos_update_worker.js');
const {MacUpdateTransactionStore, atomicWriteJson} = require('./macos_update_transaction.js');
const PYTHON = process.env.APPRAISAL_TEST_LOCK_PYTHON || '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14';
const LOCK_ENV = process.env.DYLD_FRAMEWORK_PATH ? {DYLD_FRAMEWORK_PATH: process.env.DYLD_FRAMEWORK_PATH} : {};
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function workerFixture(t, custom = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-worker-fixture-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const homeDir = path.join(root, 'home'); fs.mkdirSync(homeDir);
  const info = fixturePackage(root);
  const pythonPath = path.join(homeDir, '.appraisal-toolbox/python/bin/python3');
  const installRoot = legacyInstall(homeDir, info, pythonPath);
  fs.rmSync(pythonPath); fs.symlinkSync(PYTHON, pythonPath);
  const updatesRoot = path.join(homeDir, '.appraisal-toolbox-updates');
  const bytes = Buffer.from('synthetic verified archive bytes');
  const targetSha = hash(bytes);
  const latest = {
    ok: true, releasePublished: true, updateAvailable: true, repairRequired: false,
    platform: 'macos-arm64', latestVersion: info.productVersion, latestBuildNumber: info.buildNumber,
    latestRuntimeBuildId: info.runtimeBuildId, latestRuntimeBuildKind: 'release',
    asset: {url: ASSET_URL, size: bytes.length, sha256: targetSha},
    downloadCandidates: [{url: ASSET_URL, size: bytes.length, sha256: targetSha}],
  };
  let installs = 0, downloads = 0, recoveries = 0;
  const receipts = [];
  const store = new MacUpdateTransactionStore({homeDir, installRoot, updatesRoot, pythonBin: PYTHON, lockEnvironment: LOCK_ENV});
  const runFileSync = (command, args, options) => {
    if (args.includes('--self-test')) return JSON.stringify({ok: true, pythonSkillImportSmoke: {ok: true}});
    return execFileSync(command, args, options);
  };
  const options = {
    homeDir, pythonBin: PYTHON, requirePinnedPython: false, lockEnvironment: LOCK_ENV,
    execFileSync: runFileSync, store, heartbeatMs: 1000,
    checkUpdate: async () => latest,
    downloadAsset: async (_url, target) => { downloads++; fs.writeFileSync(target, bytes); },
    extractZip: async (_zip, extractRoot) => { fs.cpSync(info.packageRoot, path.join(extractRoot, 'candidate'), {recursive: true}); },
    installPackage: async ({onStarted}) => { installs++; onStarted({pid: 2147483647, exitCode: 0}); },
    verifyInstalled: () => ({productVersion: info.productVersion, buildNumber: info.buildNumber}),
    installerTransaction: {
      readInstallerJournal: (_file, binding) => ({...binding, originalFingerprint: 'a'.repeat(64), manifestPaths: {chrome: path.join(homeDir, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.appraisal.toolbox.helper.json'), edge: path.join(homeDir, 'Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.appraisal.toolbox.helper.json')}, snapshotRoot: '/synthetic/snapshot', manifestBackupRoot: '/synthetic/manifests', backupRoot: '/synthetic/backup', stagingRoot: '/synthetic/stage', installerPid: 2147483647}),
      recoverInstallation: async () => { recoveries++; return {state: 'rolled_back', verified: true}; },
    },
    onAccepted: receipt => receipts.push(receipt),
    ...custom,
  };
  const request = () => ({schemaVersion: 1, nonce: crypto.randomUUID(), installRoot, updatesRoot,
    update: {url: ASSET_URL, sha256: targetSha, assetName: 'candidate.zip', sizeBytes: bytes.length}});
  return {root, homeDir, installRoot, updatesRoot, info, latest, bytes, receipts, store, options, request,
    counts: () => ({installs, downloads, recoveries})};
}

test('worker accepts only after durable journal, retries a transient download and exposes verified completion', async t => {
  const f = workerFixture(t); let attempts = 0;
  const result = await runMacOSUpdateTransaction(f.request(), {...f.options,
    onAccepted: receipt => { f.receipts.push(receipt); assert.equal(f.store.readJournal().nonce, receipt.transactionId); assert.equal(receipt.verified, false); },
    sleep: async () => {},
    downloadAsset: async (_url, target) => { if (++attempts === 1) throw new Error('UPDATE_DOWNLOAD_NETWORK_FAILED'); fs.writeFileSync(target, f.bytes); },
  });
  assert.equal(attempts, 2); assert.equal(result.state, 'complete', JSON.stringify(result));
  assert.equal(result.verified, true); assert.equal(f.receipts.length, 1);
  const status = await f.store.getStatus(); assert.equal(status.state, 'complete'); assert.equal(status.verified, true);
  assert.equal(f.counts().installs, 1);
});

test('concurrent workers share a stable inode and the loser cannot replace the active journal', async t => {
  const f = workerFixture(t), entered = deferred(), release = deferred();
  const firstRequest = f.request();
  const first = runMacOSUpdateTransaction(firstRequest, {...f.options,
    downloadAsset: async (_url, target) => { entered.resolve(); await release.promise; fs.writeFileSync(target, f.bytes); },
  });
  await entered.promise;
  const inode = fs.statSync(f.store.lockPath).ino;
  const second = await runMacOSUpdateTransaction(f.request(), f.options);
  assert.equal(second.state, 'busy', JSON.stringify(second));
  assert.equal(f.store.readJournal().nonce, firstRequest.nonce);
  release.resolve(); assert.equal((await first).state, 'complete');
  assert.equal(fs.statSync(f.store.lockPath).ino, inode); assert.equal(f.counts().installs, 1);
});

test('official SHA/size target changes and downgrades reject before installer and permit verified safe retry', async t => {
  for (const mutation of ['sha', 'size', 'downgrade']) {
    const f = workerFixture(t), request = f.request();
    if (mutation === 'sha') request.update.sha256 = 'c'.repeat(64);
    if (mutation === 'size') request.update.sizeBytes++;
    if (mutation === 'downgrade') f.latest.latestVersion = '0.2.0';
    const result = await runMacOSUpdateTransaction(request, f.options);
    assert.equal(result.state, 'failed_safe', JSON.stringify(result));
    assert.equal(result.verified, true); assert.equal(result.currentVersionUnchanged, true);
    assert.equal(f.counts().installs, 0); assert.equal(f.counts().downloads, 0);
  }
});

test('corrupt downloaded archive and changed internal payload are rejected before installation', async t => {
  for (const failure of ['archive', 'payload']) {
    const f = workerFixture(t);
    const options = {...f.options};
    if (failure === 'archive') options.downloadAsset = async (_url, target) => fs.writeFileSync(target, Buffer.alloc(f.bytes.length, 0));
    else options.extractZip = async (_zip, extractRoot) => {
      const destination = path.join(extractRoot, 'candidate');
      fs.cpSync(f.info.packageRoot, destination, {recursive: true});
      fs.appendFileSync(path.join(destination, 'native-helper/native_host.js'), 'changed payload');
    };
    const result = await runMacOSUpdateTransaction(f.request(), options);
    assert.equal(result.state, 'failed_safe', JSON.stringify(result));
    assert.equal(result.verified, true); assert.equal(f.counts().installs, 0);
  }
});

for (const failure of ['UPDATE_INSTALLER_EXIT_1', 'UPDATE_PROCESS_TIMEOUT']) {
  test(`${failure} permits retry only after adapter rollback and baseline self-test proof`, async t => {
    const f = workerFixture(t);
    const result = await runMacOSUpdateTransaction(f.request(), {...f.options,
      installPackage: async ({onStarted}) => { onStarted({pid: 2147483647, exitCode: 1}); throw new Error(failure); },
    });
    assert.equal(result.state, 'rolled_back', JSON.stringify(result)); assert.equal(result.verified, true);
    assert.equal(result.currentVersionUnchanged, true); assert.equal(result.recoveryBlocked, false);
    assert.equal(f.counts().recoveries, 1);
    assert.equal((await f.store.getStatus()).state, 'rolled_back');
    assert.equal((await runMacOSUpdateTransaction(f.request(), f.options)).state, 'complete');
  });
}

test('unconfirmed rollback preserves evidence and prevents a later worker from entering installation', async t => {
  const f = workerFixture(t);
  const result = await runMacOSUpdateTransaction(f.request(), {...f.options,
    installPackage: async ({onStarted}) => { onStarted({pid: 2147483647, exitCode: 1}); throw new Error('UPDATE_INSTALLER_EXIT_1'); },
    installerTransaction: {...f.options.installerTransaction, recoverInstallation: async () => ({state: 'unknown', verified: false})},
  });
  assert.equal(result.state, 'unknown'); assert.equal(result.verified, false); assert.equal(result.recoveryBlocked, true);
  assert.equal(fs.existsSync(path.join(f.updatesRoot, result.transactionId, 'extracted')), true);
  const next = await runMacOSUpdateTransaction(f.request(), f.options);
  assert.equal(next.state, 'unknown'); assert.equal(f.counts().installs, 0);
});

test('successful installer followed by failed installed-state verification invokes rollback', async t => {
  const f = workerFixture(t);
  const result = await runMacOSUpdateTransaction(f.request(), {...f.options,
    verifyInstalled: () => { throw new Error('UPDATE_COMPLETION_STATUS_MISSING'); },
  });
  assert.equal(result.state, 'rolled_back', JSON.stringify(result)); assert.equal(result.verified, true);
  assert.equal(f.counts().installs, 1); assert.equal(f.counts().recoveries, 1);
});

test('journal failure before acceptance never starts an installer or claims acceptance', async t => {
  const f = workerFixture(t), store = new MacUpdateTransactionStore({
    homeDir: f.homeDir, installRoot: f.installRoot, updatesRoot: f.updatesRoot, pythonBin: PYTHON, lockEnvironment: LOCK_ENV,
    writeState: () => { throw new Error('synthetic full disk'); },
  });
  const result = await runMacOSUpdateTransaction(f.request(), {...f.options, store});
  assert.equal(result.state, 'unknown'); assert.equal(f.receipts.some(x => x.accepted), false);
  assert.equal(f.counts().installs, 0); assert.equal(fs.existsSync(store.journalPath), false);
});

test('unconfirmed lock release cannot publish a verified completion', async t => {
  const f = workerFixture(t), acquire = f.store.acquire.bind(f.store);
  f.store.acquire = async () => {
    const lock = await acquire();
    return {...lock, release: async () => { await lock.release(); return false; }};
  };
  const result = await runMacOSUpdateTransaction(f.request(), f.options);
  assert.equal(result.state, 'unknown'); assert.equal(result.reason, 'UPDATE_LOCK_RELEASE_FAILED');
  assert.equal(result.verified, false); assert.equal((await f.store.getStatus()).state, 'unknown');
});

test('heartbeat journal failure halts before installer and leaves an unverified status', async t => {
  const f = workerFixture(t); let writes = 0;
  const store = new MacUpdateTransactionStore({
    homeDir: f.homeDir, installRoot: f.installRoot, updatesRoot: f.updatesRoot, pythonBin: PYTHON, lockEnvironment: LOCK_ENV,
    writeState: (file, value) => { if (++writes > 2) throw new Error('synthetic journal unavailable'); atomicWriteJson(file, value); },
  });
  const result = await runMacOSUpdateTransaction(f.request(), {...f.options, store, heartbeatMs: 10,
    downloadAsset: async (_url, target) => { await new Promise(done => setTimeout(done, 60)); fs.writeFileSync(target, f.bytes); },
  });
  assert.equal(result.state, 'unknown', JSON.stringify(result)); assert.equal(result.verified, false);
  assert.equal(f.counts().installs, 0); assert.equal((await store.getStatus()).state, 'unknown');
});

test('installer journal for another nonce or root never authorizes success or recovery', async t => {
  for (const wrongField of ['nonce', 'canonicalRoot']) {
    const f = workerFixture(t);
    const baseRead = f.options.installerTransaction.readInstallerJournal;
    const result = await runMacOSUpdateTransaction(f.request(), {...f.options,
      installerTransaction: {...f.options.installerTransaction,
        readInstallerJournal: (file, binding) => ({...baseRead(file, binding), [wrongField]: wrongField === 'nonce' ? crypto.randomUUID() : `${f.installRoot}-other`}),
      },
    });
    assert.equal(result.state, 'unknown', JSON.stringify(result)); assert.equal(result.verified, false);
    assert.equal(f.counts().recoveries, 0);
  }
});

test('real installer process timeout ends the owned process group with TERM', async t => {
  const {runProcess} = require('./update_engine_macos.js');
  const {spawn} = require('node:child_process'); let childPid;
  t.after(() => { if (childPid) { try { process.kill(-childPid, 'SIGKILL'); } catch {} } });
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    {stdio: 'ignore'}, 100, spawn, child => { childPid = child.pid; }), {message: 'UPDATE_PROCESS_TIMEOUT'});
  assert.throws(() => process.kill(childPid, 0), error => error.code === 'ESRCH');
});
