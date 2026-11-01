"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const {
  MacUpdateTransactionStore,
  acquirePosixFileLock,
  atomicWriteJson,
  resolveLockPython,
} = require("./macos_update_transaction.js");

const PYTHON_3146 = process.env.APPRAISAL_TEST_LOCK_PYTHON || "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const PYTHON = process.env.APPRAISAL_TEST_LOCK_PYTHON || PYTHON_3146;
const LOCK_ENV = process.env.DYLD_FRAMEWORK_PATH ? {DYLD_FRAMEWORK_PATH: process.env.DYLD_FRAMEWORK_PATH} : {};
const PYTHON_OK = (() => {
  try { execFileSync(PYTHON, ["-c", "import fcntl"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();
const PYTHON_3146_OK = (() => {
  try { return execFileSync(PYTHON_3146, ["--version"], { encoding: "utf8" }).trim() === "Python 3.14.6"; }
  catch { return false; }
})();

assert(PYTHON_OK && PYTHON_3146_OK, "Exact Python 3.14.6 with fcntl must be available; no skipped runtime checks");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "appraisal-mac-transaction-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const installRoot = path.join(homeDir, ".appraisal-toolbox");
  fs.mkdirSync(installRoot, { recursive: true });
  const store = new MacUpdateTransactionStore({
    homeDir, installRoot, updatesRoot: path.join(homeDir, ".appraisal-toolbox-updates"),
    pythonBin: PYTHON, lockEnvironment: LOCK_ENV, ...overrides,
  });
  return { root, homeDir, installRoot, store };
}

test("transaction lock requires the packaged Python bootstrap to resolve to Python.org 3.14.6 with fcntl", (t) => {
  const { installRoot } = fixture(t);
  const bootstrap = path.join(installRoot, "python/bin/python3");
  fs.mkdirSync(path.dirname(bootstrap), { recursive: true });
  fs.symlinkSync(PYTHON_3146, bootstrap);
  assert.equal(resolveLockPython(installRoot, bootstrap, execFileSync, process.env.APPRAISAL_TEST_FRAMEWORK_PATH), fs.realpathSync(PYTHON_3146));
  assert.throws(() => resolveLockPython(installRoot, "/usr/bin/python3", execFileSync), { message: "UPDATE_LOCK_RUNTIME_UNAVAILABLE" });
});

test("journal binds strict nonce and canonical root and exposes only verified terminal states", async (t) => {
  const { store } = fixture(t);
  const nonce = require("node:crypto").randomUUID();
  assert.throws(() => store.write("bad-nonce", {}, { create: true }), { message: "UPDATE_LOCK_STATE_INVALID" });
  const created = store.write(nonce, { phase: "preflight", percent: 1 }, { create: true });
  assert.equal(created.state, "starting");
  assert.equal(created.canonicalInstallRoot, store.installRoot);
  assert.throws(() => store.write(require("node:crypto").randomUUID(), { phase: "installing" }), { message: "UPDATE_LOCK_OWNERSHIP_CHANGED" });
  store.write(nonce, { state: "installing", phase: "installing" });
  store.write(nonce, { state: "complete", phase: "complete", verified: true });
  const complete = await store.getStatus();
  assert.equal(complete.state, "complete");
  assert.equal(complete.verified, true);
  assert.equal(complete.ok, true);
  assert.equal(complete.recoveryBlocked, false);
  const nextNonce = require("node:crypto").randomUUID();
  store.write(nextNonce, { phase: "preflight" }, { create: true });
  store.write(nextNonce, { state: "rolled_back", phase: "rolled_back", verified: true });
  const rollback = await store.getStatus();
  assert.equal(rollback.state, "rolled_back");
  assert.equal(rollback.ok, true);
  assert.notEqual(rollback.state, "complete");
  const failedNonce = require("node:crypto").randomUUID();
  store.write(failedNonce, { phase: "preflight" }, { create: true });
  store.write(failedNonce, { state: "failed_safe", phase: "failed", verified: true });
  const safelyFailed = await store.getStatus();
  assert.equal(safelyFailed.ok, false);
  assert.equal(safelyFailed.recoveryBlocked, false);
  store.write(require("node:crypto").randomUUID(), { phase: "preflight" }, { create: true });
  const altered = { ...store.readJournal(), canonicalInstallRoot: `${store.installRoot}-other` };
  atomicWriteJson(store.journalPath, altered);
  const invalid = await store.getStatus();
  assert.equal(invalid.state, "unknown");
  assert.equal(invalid.reason, "UPDATE_LOCK_STATE_INVALID");
  assert.equal(invalid.recoveryBlocked, true);
});

test("an initial journal write failure leaves no transaction record for an installer to consume", (t) => {
  const { homeDir, installRoot } = fixture(t);
  const store = new MacUpdateTransactionStore({
    homeDir, installRoot, updatesRoot: path.join(homeDir, ".appraisal-toolbox-updates"),
    pythonBin: PYTHON, writeState: () => { throw new Error("simulated journal failure"); },
  });
  assert.throws(() => store.write(require("node:crypto").randomUUID(), {}, { create: true }), /simulated journal failure/);
  assert.equal(fs.existsSync(store.journalPath), false);
});

test("four independent processes serialize on one stable lock inode", async (t) => {
  const { homeDir, installRoot } = fixture(t);
  const updatesRoot = path.join(homeDir, ".appraisal-toolbox-updates");
  const modulePath = path.join(__dirname, "macos_update_transaction.js");
  const source = [
    "const { MacUpdateTransactionStore } = require(process.argv[1]);",
    "const [homeDir, installRoot, updatesRoot, pythonBin] = process.argv.slice(2);",
    "const store = new MacUpdateTransactionStore({ homeDir, installRoot, updatesRoot, pythonBin, lockEnvironment: process.env.DYLD_FRAMEWORK_PATH ? {DYLD_FRAMEWORK_PATH:process.env.DYLD_FRAMEWORK_PATH}:{} });",
    "process.stdout.write('READY\\n');",
    "process.stdin.once('data', async () => { try { const lock = await store.acquire(); process.stdout.write('LOCKED\\n'); await new Promise(r => setTimeout(r, 500)); if (!await lock.release()) process.exitCode = 4; }",
    "catch (error) { if (error.message === 'UPDATE_ALREADY_RUNNING') process.stdout.write('BUSY\\n'); else { process.stderr.write(String(error)); process.exitCode = 3; } } });",
  ].join("\n");
  const workers = Array.from({ length: 4 }, () => {
    let readyResolve;
    let readySeen = false;
    let stdout = "";
    let stderr = "";
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    let child;
    const done = new Promise((resolve, reject) => {
      child = spawn(process.execPath, ["-e", source, modulePath, homeDir, installRoot, updatesRoot, PYTHON], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
        if (!readySeen && stdout.includes("READY\n")) { readySeen = true; readyResolve(); }
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (!readySeen) readyResolve();
        if (code !== 0) reject(new Error(`worker exit ${code}: ${stderr}`));
        else resolve(stdout.trim().split(/\r?\n/).at(-1));
      });
    });
    return { child, ready, done };
  });
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.child.stdin.end("go\n");
  const results = await Promise.all(workers.map((worker) => worker.done));
  assert.equal(results.filter((result) => result === "LOCKED").length, 1, JSON.stringify(results));
  assert.equal(results.filter((result) => result === "BUSY").length, 3, JSON.stringify(results));
});

test("active journal is busy only while the worker lock is held; abandoned or unreleasable locks become unknown", async (t) => {
  const { store } = fixture(t);
  const lock = await store.acquire();
  const nonce = require("node:crypto").randomUUID();
  store.write(nonce, { phase: "installing", percent: 80, message: "正在安装" }, { create: true });
  assert.equal((await store.getStatus()).state, "busy");
  assert.equal((await store.getStatus({ probeLock: false })).state, "busy");
  assert.equal(await lock.release(), true);
  const abandoned = await store.getStatus();
  assert.equal(abandoned.state, "unknown");
  assert.equal(abandoned.reason, "UPDATE_LOCK_ARBITRATION_ABANDONED");
  assert.equal(abandoned.recoveryBlocked, true);
});

test("a lock release timeout is returned as an unconfirmed release", async (t) => {
  const { homeDir, installRoot } = fixture(t);
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.pid = 456;
    child.stdout = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.kill = () => { setImmediate(() => child.emit("exit", null, "SIGKILL")); return true; };
    setImmediate(() => child.stdout.write("LOCKED\n"));
    return child;
  };
  const store = new MacUpdateTransactionStore({
    homeDir, installRoot, updatesRoot: path.join(homeDir, ".appraisal-toolbox-updates"),
    pythonBin: "/isolated/test/python3.14", spawnProcess: fakeSpawn, releaseTimeoutMs: 5,
  });
  const lock = await store.acquire();
  assert.equal(await lock.release(), false);
});

test("a legacy update lock blocks recovery rather than being deleted", async (t) => {
  const { homeDir, store } = fixture(t);
  fs.mkdirSync(path.join(homeDir, ".appraisal-toolbox-update.lock"));
  const status = await store.getStatus();
  assert.equal(status.state, "unknown");
  assert.equal(status.reason, "UPDATE_LOCK_OWNER_UNVERIFIED");
  assert.equal(fs.statSync(path.join(homeDir, ".appraisal-toolbox-update.lock")).isDirectory(), true);
});


test("unconfirmed finalization stays busy during the unlocked confirmation window", async (t) => {
  const { store } = fixture(t, { isProcessAlive: (pid) => pid === process.pid });
  const lock = await store.acquire();
  const nonce = require("node:crypto").randomUUID();
  store.write(nonce, { phase: "preflight", percent: 1 }, { create: true });
  store.write(nonce, { state: "complete", phase: "finalizing", percent: 100, verified: false });

  let releaseLock;
  let confirmLockFree;
  const confirmationGate = new Promise((resolve) => { releaseLock = resolve; });
  const lockFree = new Promise((resolve) => { confirmLockFree = resolve; });
  const finalizer = (async () => {
    assert.equal(await lock.release(), true);
    confirmLockFree();
    await confirmationGate;
    store.write(nonce, { state: "complete", phase: "complete", verified: true, recoveryBlocked: false });
  })();

  await lockFree;
  try {
    const statuses = await Promise.all(Array.from({ length: 3 }, () => store.getStatus()));
    assert.deepEqual(statuses.map((status) => [status.state, status.phase, status.verified]), [
      ["busy", "finalizing", false], ["busy", "finalizing", false], ["busy", "finalizing", false],
    ]);
    assert.equal(store.isBusySync(execFileSync), true);
  } finally {
    releaseLock();
  }
  await finalizer;
  const complete = await store.getStatus();
  assert.equal(complete.state, "complete");
  assert.equal(complete.verified, true);
  assert.equal(complete.ok, true);
});

test("finalization becomes unknown when its worker is dead or its grace window expires", async (t) => {
  let workerAlive = false;
  const { store } = fixture(t, { isProcessAlive: () => workerAlive, finalizationGraceMs: 1000 });
  const nonce = require("node:crypto").randomUUID();
  store.write(nonce, { phase: "preflight", percent: 1 }, { create: true });
  store.write(nonce, { state: "complete", phase: "finalizing", verified: false });
  const deadWorker = await store.getStatus({ probeLock: false });
  assert.equal(deadWorker.state, "unknown");
  assert.equal(deadWorker.reason, "UPDATE_FINALIZATION_ABANDONED");

  workerAlive = true;
  const stale = { ...store.readJournal(), workerPid: process.pid, updatedAt: new Date(Date.now() - 2000).toISOString() };
  atomicWriteJson(store.journalPath, stale);
  const expired = await store.getStatus({ probeLock: false });
  assert.equal(expired.state, "unknown");
  assert.equal(expired.reason, "UPDATE_FINALIZATION_ABANDONED");
});

test("read-only status remains busy while the installer atomically replaces the installation root", async t => {
  const {store, homeDir, installRoot} = fixture(t);
  const python = fs.realpathSync(PYTHON);
  fs.mkdirSync(path.join(installRoot, 'python/bin'), {recursive:true});
  fs.symlinkSync(python, path.join(installRoot, 'python/bin/python3'));
  const engine = require('./update_engine_macos.js').createMacOSUpdateEngine({
    homeDir, installRoot, frameworkRoot: path.dirname(path.dirname(python)),
    lockEnvironment: LOCK_ENV,
  });
  const lock = await store.acquire();
  const nonce = require('node:crypto').randomUUID();
  store.write(nonce, {phase:'installing', verified:false}, {create:true});
  const moved = installRoot + '.replacing';
  fs.renameSync(installRoot, moved);
  try {
    assert.equal((await engine.getUpdateStatus()).state, 'busy');
    await lock.release();
    assert.equal((await engine.getUpdateStatus()).state, 'unknown');
  } finally {
    fs.renameSync(moved, installRoot);
    await lock.release();
  }
});
