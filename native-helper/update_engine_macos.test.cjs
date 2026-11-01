"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { MacUpdateTransactionStore } = require("./macos_update_transaction.js");
const { createMacOSUpdateEngine, extensionIdFromKey } = require("./update_engine_macos.js");

const EXTENSION_ID = "aamfmhcbjgofhmannejoiilkkpchfkgm";
const NATIVE_HOST = "com.appraisal.toolbox.helper";
const ASSET_URL = "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.3/fixture.zip";
const PYTHON_CANDIDATE = process.env.APPRAISAL_TEST_LOCK_PYTHON
  || "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const LOCK_PYTHON = (() => {
  try {
    const realPath = fs.realpathSync(PYTHON_CANDIDATE);
    const version = execFileSync(realPath, ["--version"], { encoding: "utf8" }).trim();
    return version === "Python 3.14.6" ? realPath : "";
  } catch {
    return "";
  }
})();
function frameworkPathsForPython(pythonPath) {
  const realPath = fs.realpathSync(pythonPath);
  let frameworkPath = path.dirname(realPath);
  while (path.basename(frameworkPath) !== "Python.framework") {
    const parent = path.dirname(frameworkPath);
    if (parent === frameworkPath) throw new Error("Python.framework not found for lock runtime");
    frameworkPath = parent;
  }
  return {
    frameworkPath,
    frameworkRoot: path.join(frameworkPath, "Versions", "3.14"),
    dyldFrameworkPath: path.dirname(frameworkPath),
  };
}
const PYTHON_PATHS = LOCK_PYTHON ? frameworkPathsForPython(LOCK_PYTHON) : null;
const PYTHON_FRAMEWORK_ROOT = PYTHON_PATHS?.frameworkRoot || "";
const DYLD_FRAMEWORK_PATH = PYTHON_PATHS?.dyldFrameworkPath || "";
const PYTHON_AVAILABLE = Boolean(LOCK_PYTHON && (() => {
  try {
    execFileSync(LOCK_PYTHON, ["-c", "import fcntl, ensurepip, venv; assert __import__('sys').version_info[:3] == (3,14,6)"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})());
if (!PYTHON_AVAILABLE) {
  throw new Error(`Python.org 3.14.6 with fcntl, ensurepip, and venv is required for update engine tests (candidate: ${PYTHON_CANDIDATE})`);
}
assert.equal(path.basename(PYTHON_PATHS.frameworkPath), "Python.framework");
assert.equal(path.basename(PYTHON_FRAMEWORK_ROOT), "3.14");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
};
const validMessage = {
  url: ASSET_URL,
  sha256: "a".repeat(64),
  assetName: "fixture.zip",
  sizeBytes: 1,
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "appraisal-macos-engine-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const installRoot = path.join(homeDir, ".appraisal-toolbox");
  const updatesRoot = path.join(homeDir, ".appraisal-toolbox-updates");
  const extensionRoot = path.join(installRoot, "extension");
  const helperRoot = path.join(installRoot, "native-helper");
  const pythonBootstrap = path.join(installRoot, "python", "bin", "python3");
  const nodeRuntime = path.join(installRoot, "runtime", "node", "bin", "node");
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.mkdirSync(helperRoot, { recursive: true });
  fs.mkdirSync(path.dirname(pythonBootstrap), { recursive: true });
  fs.mkdirSync(path.dirname(nodeRuntime), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  writeJson(path.join(extensionRoot, "manifest.json"), require("../manifest.json"));
  writeJson(path.join(helperRoot, "runtime-config.json"), {
    toolboxExtensionId: EXTENSION_ID,
    nativeHostName: NATIVE_HOST,
  });
  fs.writeFileSync(path.join(helperRoot, "native_host.js"), "// synthetic fixture host\n");
  if (LOCK_PYTHON) fs.symlinkSync(LOCK_PYTHON, pythonBootstrap);
  fs.writeFileSync(nodeRuntime, "synthetic ordinary Node runtime file\n", { mode: 0o600 });
  return { root, homeDir, installRoot, updatesRoot, pythonBootstrap, nodeRuntime, frameworkRoot: PYTHON_FRAMEWORK_ROOT, dyldFrameworkPath: DYLD_FRAMEWORK_PATH };
}

function makeEngine(f, overrides = {}) {
  return createMacOSUpdateEngine({
    platform: "darwin",
    architecture: "arm64",
    homeDir: f.homeDir,
    installRoot: f.installRoot,
    updatesRoot: f.updatesRoot,
    frameworkRoot: f.frameworkRoot,
    lockEnvironment: { DYLD_FRAMEWORK_PATH: f.dyldFrameworkPath },
    ...overrides,
  });
}

function makeStore(f, pythonBin = LOCK_PYTHON) {
  return new MacUpdateTransactionStore({
    homeDir: f.homeDir,
    installRoot: f.installRoot,
    updatesRoot: f.updatesRoot,
    pythonBin,
    lockEnvironment: { DYLD_FRAMEWORK_PATH: frameworkPathsForPython(pythonBin).dyldFrameworkPath },
  });
}

function checkUpdate() {
  return {
    ok: true,
    releasePublished: true,
    updateAvailable: true,
    platform: "macos-arm64",
    latestVersion: "0.2.3",
    latestBuildNumber: 2026102101,
    asset: { url: ASSET_URL, sha256: validMessage.sha256, size: validMessage.sizeBytes },
  };
}

function assertOneTerminal(reply, frames) {
  assert.equal(reply?.event, "complete");
  assert.equal(reply?.action, "download_and_install_update");
  assert.equal(frames.length, 1, "each start request must emit exactly one terminal frame");
  assert.deepEqual(frames[0], reply);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function writeStartingJournal(input, f) {
  assert.equal(typeof input.checkUpdate, "function");
  assert.equal(fs.realpathSync(input.lockPython), LOCK_PYTHON);
  assert.equal(fs.existsSync(input.requestPath), true);
  const request = JSON.parse(fs.readFileSync(input.requestPath, "utf8"));
  assert.equal(request.nonce, input.request.nonce);
  assert.equal(request.update.url, ASSET_URL);
  assert.equal((fs.statSync(input.requestPath).mode & 0o077), 0, "worker request must remain private");
  const store = makeStore(f, input.lockPython);
  const lock = await store.acquire();
  store.write(request.nonce, {
    state: "starting", phase: "preflight", percent: 1, message: "fixture worker accepted",
  }, { create: true });
  await input.onAccepted({ accepted: true, state: "starting", transactionId: request.nonce });
  return { store, lock, nonce: request.nonce };
}

async function completeJournal(worker) {
  worker.store.write(worker.nonce, {
    state: "complete", phase: "complete", percent: 100, verified: true,
    recoveryBlocked: false, currentVersionUnchanged: false,
  });
  assert.equal(await worker.lock.release(), true);
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(predicate(), "timed out waiting for detached worker fixture");
}

test("packaged public key retains the installed Chrome extension ID", () => {
  assert.equal(extensionIdFromKey(require("../manifest.json").key), EXTENSION_ID);
});

test("unsupported, invalid, and busy early exits each emit one terminal reply", async (t) => {
  const f = fixture(t);
  const unsupportedFrames = [];
  const unsupported = await makeEngine(f, { platform: "win32", architecture: "x64" })
    .downloadAndInstallUpdate(validMessage, (frame) => unsupportedFrames.push(frame), checkUpdate);
  assertOneTerminal(unsupported, unsupportedFrames);
  assert.equal(unsupported.reason, "PLATFORM_UPDATE_UNSUPPORTED");

  const invalidUrlFrames = [];
  const invalidUrl = await makeEngine(f).downloadAndInstallUpdate({
    ...validMessage, url: "https://example.invalid/package.zip",
  }, (frame) => invalidUrlFrames.push(frame), checkUpdate);
  assertOneTerminal(invalidUrl, invalidUrlFrames);
  assert.equal(invalidUrl.reason, "UPDATE_URL_HOST_NOT_ALLOWED");

  const invalidShaFrames = [];
  const invalidSha = await makeEngine(f).downloadAndInstallUpdate({
    ...validMessage, sha256: "not-a-sha256",
  }, (frame) => invalidShaFrames.push(frame), checkUpdate);
  assertOneTerminal(invalidSha, invalidShaFrames);
  assert.equal(invalidSha.reason, "UPDATE_SHA256_REQUIRED");

  const store = makeStore(f);
  const lock = await store.acquire();
  store.write(crypto.randomUUID(), { state: "starting", phase: "preflight", percent: 1 }, { create: true });
  const busyFrames = [];
  const busy = await makeEngine(f).downloadAndInstallUpdate(validMessage, (frame) => busyFrames.push(frame), checkUpdate);
  assertOneTerminal(busy, busyFrames);
  assert.equal(busy.state, "busy");
  assert.equal(busy.reason, "UPDATE_ALREADY_RUNNING");
  assert.equal(await lock.release(), true);
});

test("accepted starting receipt follows a persisted journal and is not installation success", async (t) => {
  const f = fixture(t);
  const finishWorker = deferred();
  const workerFinished = deferred();
  let worker;
  let workerError;
  const engine = makeEngine(f, {
    workerExecutor: async (input) => {
      try {
        worker = await writeStartingJournal(input, f);
        await finishWorker.promise;
        await completeJournal(worker);
      } catch (error) {
        workerError = error;
        throw error;
      } finally {
        workerFinished.resolve();
      }
    },
  });
  const frames = [];
  const reply = await engine.downloadAndInstallUpdate(validMessage, (frame) => frames.push(frame), checkUpdate);
  assertOneTerminal(reply, frames);
  assert.equal(reply.ok, true);
  assert.equal(reply.accepted, true);
  assert.equal(reply.state, "starting");
  assert.equal(reply.verified, false);
  assert.notEqual(reply.state, "complete");

  const active = await engine.getUpdateStatus();
  assert.equal(active.state, "busy");
  assert.equal(active.verified, false);
  assert.equal(active.transactionId, reply.transactionId);
  finishWorker.resolve();
  await workerFinished.promise;
  assert.equal(workerError, undefined);
  const completed = await engine.getUpdateStatus();
  assert.equal(completed.state, "complete");
  assert.equal(completed.verified, true);
  assert.equal(completed.recoveryBlocked, false);
});

test("a second and third request cannot clear the first request localStart gate", async (t) => {
  const f = fixture(t);
  const executorEntered = deferred();
  const allowAck = deferred();
  const finishWorker = deferred();
  const workerFinished = deferred();
  let executorCalls = 0;
  let worker;
  const engine = makeEngine(f, {
    workerExecutor: async (input) => {
      executorCalls += 1;
      executorEntered.resolve();
      try {
        await allowAck.promise;
        worker = await writeStartingJournal(input, f);
        await finishWorker.promise;
        await completeJournal(worker);
      } finally {
        workerFinished.resolve();
      }
    },
  });
  const firstFrames = [];
  const firstPromise = engine.downloadAndInstallUpdate(validMessage, (frame) => firstFrames.push(frame), checkUpdate);
  await executorEntered.promise;
  const secondFrames = [];
  const second = await engine.downloadAndInstallUpdate(validMessage, (frame) => secondFrames.push(frame), checkUpdate);
  const thirdFrames = [];
  const third = await engine.downloadAndInstallUpdate(validMessage, (frame) => thirdFrames.push(frame), checkUpdate);
  assertOneTerminal(second, secondFrames);
  assertOneTerminal(third, thirdFrames);
  assert.equal(second.state, "busy");
  assert.equal(third.state, "busy");
  assert.equal(executorCalls, 1);

  allowAck.resolve();
  const first = await firstPromise;
  assertOneTerminal(first, firstFrames);
  assert.equal(first.accepted, true);
  assert.equal(first.state, "starting");
  finishWorker.resolve();
  await workerFinished.promise;
  assert.equal((await engine.getUpdateStatus()).state, "complete");
});

test("ack timeout leaves an unknown pending request and prevents a restart", async (t) => {
  const f = fixture(t);
  const never = new Promise(() => {});
  let executorCalls = 0;
  const engine = makeEngine(f, {
    startAckTimeoutMs: 1000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 25))),
    workerExecutor: async () => { executorCalls += 1; await never; },
  });
  const firstFrames = [];
  const first = await engine.downloadAndInstallUpdate(validMessage, (frame) => firstFrames.push(frame), checkUpdate);
  assertOneTerminal(first, firstFrames);
  assert.equal(first.state, "unknown");
  assert.equal(first.verified, false);
  assert.equal(first.recoveryBlocked, true);

  const retryFrames = [];
  const retry = await engine.downloadAndInstallUpdate(validMessage, (frame) => retryFrames.push(frame), checkUpdate);
  assertOneTerminal(retry, retryFrames);
  assert.equal(retry.state, "unknown");
  assert.equal(retry.recoveryBlocked, true);
  assert.equal(executorCalls, 1, "uncertain worker start must block a second executor launch");
});

test("wrong nonce acknowledgement is rejected as unknown", async (t) => {
  const f = fixture(t);
  const engine = makeEngine(f, {
    workerExecutor: async (input) => input.onAccepted({
      accepted: true,
      state: "starting",
      transactionId: "00000000-0000-4000-8000-000000000001",
    }),
  });
  const frames = [];
  const reply = await engine.downloadAndInstallUpdate(validMessage, (frame) => frames.push(frame), checkUpdate);
  assertOneTerminal(reply, frames);
  assert.equal(reply.state, "unknown");
  assert.equal(reply.verified, false);
  assert.equal(reply.recoveryBlocked, true);
  assert.equal(reply.reason, "UPDATE_WORKER_START_UNCONFIRMED");
});

test("a missing journal after accepted start never becomes a fabricated completion", async (t) => {
  const f = fixture(t);
  const finishWorker = deferred();
  const workerFinished = deferred();
  let worker;
  const engine = makeEngine(f, {
    workerExecutor: async (input) => {
      try {
        worker = await writeStartingJournal(input, f);
        await finishWorker.promise;
      } finally {
        workerFinished.resolve();
      }
    },
  });
  const frames = [];
  const reply = await engine.downloadAndInstallUpdate(validMessage, (frame) => frames.push(frame), checkUpdate);
  assertOneTerminal(reply, frames);
  assert.equal(reply.state, "starting");
  fs.rmSync(path.join(f.updatesRoot, "transaction.json"), { force: true });
  const status = await engine.getUpdateStatus();
  assert.equal(status.state, "idle");
  assert.equal(status.verified, false);
  assert.notEqual(status.state, "complete");
  finishWorker.resolve();
  await worker.lock.release();
  await workerFinished.promise;
});

test("detached worker fixture continues after its Native parent exits", async (t) => {
  const f = fixture(t);
  fs.copyFileSync(process.execPath, f.nodeRuntime);
  fs.chmodSync(f.nodeRuntime, 0o700);
  const workerPath = path.join(f.root, "detached-worker-fixture.cjs");
  const driverPath = path.join(f.root, "native-parent-fixture.cjs");
  const transactionModule = path.join(__dirname, "macos_update_transaction.js");
  const engineModule = path.join(__dirname, "update_engine_macos.js");
  const workerSource = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const { MacUpdateTransactionStore, atomicWriteJson } = require(' + JSON.stringify(transactionModule) + ');',
    'const requestIndex = process.argv.indexOf("--request");',
    'const requestPath = process.argv[requestIndex + 1];',
    'const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));',
    'const homeDir = process.env.HOME;',
    'const lockPython = process.env.APPRAISAL_UPDATE_LOCK_PYTHON;',
    'const dyldFrameworkPath = process.env.DYLD_FRAMEWORK_PATH;',
    'const frameworkRoot = path.join(dyldFrameworkPath, "Python.framework", "Versions", "3.14");',
    'const store = new MacUpdateTransactionStore({',
    '  homeDir, installRoot: request.installRoot, updatesRoot: request.updatesRoot,',
    '  pythonBin: lockPython, lockEnvironment: { DYLD_FRAMEWORK_PATH: dyldFrameworkPath },',
    '});',
    'const marker = path.join(homeDir, "detached-worker-continued.json");',
    'const completed = path.join(homeDir, "detached-worker-complete.json");',
    '(async () => {',
    '  let lock;',
    '  try {',
    '    lock = await store.acquire();',
    '    store.write(request.nonce, { state: "starting", phase: "preflight", percent: 1, message: "detached fixture" }, { create: true });',
    '    atomicWriteJson(requestPath + ".ack.json", { accepted: true, state: "starting", transactionId: request.nonce });',
    '    await new Promise((resolve) => setTimeout(resolve, 500));',
    '    fs.writeFileSync(marker, JSON.stringify({ lockPython, frameworkRoot, dyldFrameworkPath, pid: process.pid }));',
    '    await new Promise((resolve) => setTimeout(resolve, 300));',
    '    store.write(request.nonce, { state: "complete", phase: "complete", percent: 100, verified: true, recoveryBlocked: false });',
    '    if (!await lock.release()) throw new Error("fixture lock release failed");',
    '    fs.writeFileSync(completed, "done\\n");',
    '  } catch (error) {',
    '    fs.writeFileSync(path.join(homeDir, "detached-worker-error.txt"), String(error && error.stack || error));',
    '    if (lock) { try { await lock.release(); } catch { /* test records the original failure */ } }',
    '    process.exitCode = 1;',
    '  }',
    '})();',
  ].join("\n");
  const driverSource = [
    '"use strict";',
    'const { createMacOSUpdateEngine } = require(process.argv[2]);',
    'const args = process.argv.slice(3);',
    'const [homeDir, installRoot, updatesRoot, workerPath, frameworkRoot, dyldFrameworkPath] = args;',
    'const engine = createMacOSUpdateEngine({ platform: "darwin", architecture: "arm64", homeDir, installRoot, updatesRoot, workerPath, frameworkRoot, lockEnvironment: { DYLD_FRAMEWORK_PATH: dyldFrameworkPath }, startAckTimeoutMs: 5000 });',
    'const frames = [];',
    'engine.downloadAndInstallUpdate(' + JSON.stringify(validMessage) + ', (frame) => frames.push(frame), async () => { throw new Error("fixture worker owns source check"); })',
    '  .then((reply) => process.stdout.write(JSON.stringify({ reply, frames }) + "\\n"))',
    '  .catch((error) => { process.stderr.write(String(error && error.stack || error)); process.exitCode = 1; });',
  ].join("\n");
  fs.writeFileSync(workerPath, workerSource, { mode: 0o600 });
  fs.writeFileSync(driverPath, driverSource, { mode: 0o600 });

  const child = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const processChild = spawn(process.execPath, [
      driverPath, engineModule, f.homeDir, f.installRoot, f.updatesRoot, workerPath, f.frameworkRoot, f.dyldFrameworkPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => processChild.kill("SIGKILL"), 15000);
    processChild.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    processChild.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    processChild.once("error", (error) => { clearTimeout(timer); reject(error); });
    processChild.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Native parent fixture exited " + code + ": " + stderr));
      else resolve(JSON.parse(stdout.trim()));
    });
  });
  assertOneTerminal(child.reply, child.frames);
  assert.equal(child.reply.accepted, true);
  assert.equal(child.reply.state, "starting");
  assert.equal(child.reply.verified, false);

  const markerPath = path.join(f.homeDir, "detached-worker-continued.json");
  const completedPath = path.join(f.homeDir, "detached-worker-complete.json");
  await waitFor(() => fs.existsSync(markerPath));
  assert.equal(fs.existsSync(path.join(f.homeDir, "detached-worker-error.txt")), false);
  const workerEnvironment = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.equal(workerEnvironment.lockPython, LOCK_PYTHON);
  assert.equal(workerEnvironment.frameworkRoot, f.frameworkRoot);
  assert.equal(workerEnvironment.dyldFrameworkPath, f.dyldFrameworkPath);
  const observer = makeEngine(f, { workerPath });
  const active = await observer.getUpdateStatus();
  assert.equal(active.state, "busy");
  assert.equal(active.verified, false);

  await waitFor(() => fs.existsSync(completedPath));
  const completed = await observer.getUpdateStatus();
  assert.equal(completed.state, "complete");
  assert.equal(completed.verified, true);
});
