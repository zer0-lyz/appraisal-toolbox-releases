'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  acquireUpdateLock,
  finishUpdateLock,
  readWindowsProcessStartTime,
  writeUpdateLockState,
} = require('../../native-helper/update_engine.js');

const ENGINE_PATH = path.resolve(__dirname, '../../native-helper/update_engine.js');
const TEMP_ROOT_PREFIX = 'appraisal-update-lock-';
const WINDOWS_ONLY = { skip: process.platform !== 'win32' };

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function spawnNode(code, args, cwd) {
  return spawn(process.execPath, ['-e', code, ...args], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function watchChild(child) {
  const events = [];
  const emitter = new EventEmitter();
  let stdoutRemainder = '';
  let rawStdout = '';
  let stderr = '';
  let spawnError = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    rawStdout += chunk;
    stdoutRemainder += chunk;
    let newline;
    while ((newline = stdoutRemainder.indexOf('\n')) >= 0) {
      const line = stdoutRemainder.slice(0, newline).trim();
      stdoutRemainder = stdoutRemainder.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (event && typeof event.event === 'string') emitter.emit(event.event, event);
      } catch { /* plain-text child output is captured separately */ }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  child.once('error', error => { spawnError = error; });

  const done = new Promise(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal, spawnError, stderr, stdout: rawStdout, events }));
  });

  function waitFor(eventName, timeoutMs = 15000) {
    const found = events.find(event => event.event === eventName);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emitter.removeListener(eventName, handler);
        reject(new Error('CHILD_EVENT_TIMEOUT:' + eventName));
      }, timeoutMs);
      function handler(event) {
        clearTimeout(timer);
        resolve(event);
      }
      emitter.once(eventName, handler);
    });
  }

  return { events, done, waitFor };
}

async function waitForSpawn(child) {
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  try { child.kill(); } catch { /* only test-owned children are passed here */ }
  await Promise.race([
    closed,
    delay(10000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(); } catch { /* retain the original test result */ }
      }
    }),
  ]);
}

async function startDummyProcess() {
  const child = spawnNode('setInterval(function () {}, 1000);', [], os.tmpdir());
  const watcher = watchChild(child);
  await waitForSpawn(child);

  let startedAtUtc = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    startedAtUtc = await readWindowsProcessStartTime(child.pid);
    if (typeof startedAtUtc === 'string' && Number.isFinite(Date.parse(startedAtUtc))) break;
    await delay(50);
  }
  assert.ok(Number.isFinite(Date.parse(startedAtUtc || '')), 'dummy process start time must be observable');
  return { child, watcher, startedAtUtc };
}

async function stopDummyProcess(dummy) {
  await terminateChild(dummy.child);
  const processStatus = await readWindowsProcessStartTime(dummy.child.pid);
  assert.equal(processStatus, 'PROCESS_MISSING', 'test-owned dummy process must be confirmed dead');
}

async function createConfirmedDeadOwner() {
  const dummy = await startDummyProcess();
  const owner = {
    schemaVersion: 2,
    pid: dummy.child.pid,
    nonce: 'stale-' + crypto.randomUUID(),
    startedAtUtc: dummy.startedAtUtc,
  };
  await stopDummyProcess(dummy);
  return owner;
}

function baseState(owner) {
  return {
    schemaVersion: 2,
    ownerPid: owner.pid,
    nonce: owner.nonce,
    ownerStartedAtUtc: owner.startedAtUtc,
    phase: 'downloading',
    installerStarted: false,
    installerStartPending: false,
    installerProcess: null,
    workerStartPending: false,
    workerProcess: null,
    recoveryStartPending: false,
    recoveryProcess: null,
    recoveryRequired: false,
    terminalOutcome: null,
    updatedAtUtc: new Date().toISOString(),
  };
}

function writeLock(lockPath, owner, state) {
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner, null, 2));
  fs.writeFileSync(path.join(lockPath, 'transaction.json'), JSON.stringify(state, null, 2));
}

function makeTempRoot(label) {
  const tempBase = fs.realpathSync.native(os.tmpdir());
  return fs.mkdtempSync(path.join(tempBase, TEMP_ROOT_PREFIX + label + '-'));
}

function normalizeSafetyPath(value) {
  return path.resolve(value)
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLocaleLowerCase('en-US');
}

function cleanupTempRoot(tempRoot) {
  const rootPath = path.resolve(tempRoot);
  const expectedParent = fs.realpathSync.native(os.tmpdir());
  if (path.basename(rootPath).startsWith(TEMP_ROOT_PREFIX) !== true) {
    throw new Error('TEMP_CLEANUP_PREFIX_CHECK_FAILED');
  }
  if (normalizeSafetyPath(path.dirname(rootPath)) !== normalizeSafetyPath(expectedParent)) {
    throw new Error('TEMP_CLEANUP_PARENT_CHECK_FAILED');
  }
  const rootStat = fs.lstatSync(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('TEMP_CLEANUP_ROOT_TYPE_CHECK_FAILED');
  }
  const realRoot = fs.realpathSync.native(rootPath);
  if (normalizeSafetyPath(realRoot) !== normalizeSafetyPath(rootPath)) {
    throw new Error('TEMP_CLEANUP_REPARSE_CHECK_FAILED');
  }
  if (normalizeSafetyPath(path.dirname(realRoot)) !== normalizeSafetyPath(expectedParent)) {
    throw new Error('TEMP_CLEANUP_RESOLVED_PARENT_CHECK_FAILED');
  }
  fs.rmSync(realRoot, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
}

function makeConcurrentWorkerSource() {
  return [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const engine = require(process.argv[1]);",
    "const lockPath = process.argv[2];",
    "const nonce = process.argv[3];",
    "const gatePath = process.argv[4];",
    "const markerDirectory = process.argv[5];",
    "const holdMs = Number(process.argv[6]);",
    "const sharedActiveMarkerPath = path.join(markerDirectory, 'active.marker');",
    "const delay = ms => new Promise(resolve => setTimeout(resolve, ms));",
    "const report = (event, extra) => process.stdout.write(JSON.stringify({ event, pid: process.pid, nonce, highResolutionTime: process.hrtime.bigint().toString(), ...(extra || {}) }) + '\\n');",
    "let lock = null;",
    "let markerPath = null;",
    "(async () => {",
    "  report('ready');",
    "  const gateDeadline = Date.now() + 20000;",
    "  while (!fs.existsSync(gatePath)) {",
    "    if (Date.now() >= gateDeadline) throw Object.assign(new Error('WORKER_GATE_TIMEOUT'), { code: 'WORKER_GATE_TIMEOUT' });",
    "    await delay(5);",
    "  }",
    "  const acquireDeadline = Date.now() + 25000;",
    "  let busyRetries = 0;",
    "  while (!lock && Date.now() < acquireDeadline) {",
    "    try {",
    "      lock = await engine.acquireUpdateLock(lockPath, nonce);",
    "    } catch (error) {",
    "      if (error && error.code === 'UPDATE_ALREADY_RUNNING') {",
    "        busyRetries += 1;",
    "        report('busy', { code: error.code, busyRetries });",
    "        await delay(25);",
    "        continue;",
    "      }",
    "      throw error;",
    "    }",
    "  }",
    "  if (!lock) throw Object.assign(new Error('WORKER_ACQUIRE_TIMEOUT'), { code: 'WORKER_ACQUIRE_TIMEOUT' });",
    "  const diskOwner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));",
    "  if (diskOwner.nonce !== nonce || Number(diskOwner.pid) !== process.pid) throw Object.assign(new Error('WORKER_OWNER_MISMATCH'), { code: 'WORKER_OWNER_MISMATCH' });",
    "  markerPath = path.join(markerDirectory, nonce + '.json');",
    "  fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, nonce, recovered: lock.recovered }), { flag: 'wx' });",
    "  const realRelease = lock.mutex.release.bind(lock.mutex);",
    "  let sharedMarkerFd = null;",
    "  let ownsSharedMarker = false;",
    "  lock.mutex.release = async function () {",
    "    if (sharedMarkerFd !== null) { try { fs.closeSync(sharedMarkerFd); } catch { /* the guard is already closing */ } sharedMarkerFd = null; }",
    "    if (ownsSharedMarker) { try { fs.unlinkSync(sharedActiveMarkerPath); } catch { /* cleanup remains inside the test root */ } ownsSharedMarker = false; }",
    "    try { fs.unlinkSync(markerPath); } catch { /* cleanup remains confined to the test root */ }",
    "    return realRelease();",
    "  };",
    "  try {",
    "    sharedMarkerFd = fs.openSync(sharedActiveMarkerPath, 'wx');",
    "    ownsSharedMarker = true;",
    "    fs.writeSync(sharedMarkerFd, JSON.stringify({ pid: process.pid, nonce }));",
    "  } catch (error) {",
    "    if (error && error.code === 'EEXIST') throw Object.assign(new Error('CONCURRENT_OWNER_MARKER_ALREADY_EXISTS'), { code: 'CONCURRENT_OWNER_MARKER_ALREADY_EXISTS' });",
    "    throw error;",
    "  }",
    "  report('acquired', { recovered: lock.recovered === true, busyRetries, ownerMatchesDisk: true });",
    "  await delay(holdMs);",
    "  await engine.finishUpdateLock(lock, 'failed_before_install');",
    "  report('released', { busyRetries });",
    "  lock = null;",
    "})().catch(async error => {",
    "  report('error', { code: error && error.code ? error.code : 'WORKER_FAILED' });",
    "  if (lock && lock.mutex && lock.mutex.active) {",
    "    try { await engine.finishUpdateLock(lock, 'failed_before_install'); }",
    "    catch { try { await engine.abandonUpdateLock(lock); } catch { /* test process is exiting */ } }",
    "  }",
    "  process.exitCode = 1;",
    "});",
  ].join('\n');
}

function startMarkerMonitor(markerDirectory, lockPath) {
  let maxObservedOwners = 0;
  let violations = 0;
  let firstViolation = null;
  const sample = () => {
    let markers = [];
    try {
      markers = fs.readdirSync(markerDirectory).filter(name => name.endsWith('.json'));
    } catch { return; }
    maxObservedOwners = Math.max(maxObservedOwners, markers.length);
    if (markers.length > 1 && firstViolation === null) {
      violations += 1;
      firstViolation = { markerCount: markers.length };
    }
    if (markers.length === 1) {
      try {
        const marker = JSON.parse(fs.readFileSync(path.join(markerDirectory, markers[0]), 'utf8'));
        const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
        if (Number(owner.pid) !== Number(marker.pid) || owner.nonce !== marker.nonce) {
          violations += 1;
          if (firstViolation === null) firstViolation = { markerCount: 1, ownerMatchesMarker: false };
        }
      } catch {
        // A sample can coincide with the atomic active-lock rename; the next sample is authoritative.
      }
    }
  };
  const timer = setInterval(sample, 3);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      sample();
      return { maxObservedOwners, violations, firstViolation };
    },
  };
}

async function acquireAfterGuardianExit(lockPath, nonce, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await acquireUpdateLock(lockPath, nonce);
    } catch (error) {
      lastError = error;
      if (!['UPDATE_ALREADY_RUNNING', 'UPDATE_LOCK_ARBITRATION_FAILED', 'UPDATE_LOCK_ARBITRATION_ABANDONED'].includes(error && error.code)) throw error;
      await delay(75);
    }
  }
  throw lastError || new Error('LOCK_RETRY_TIMEOUT');
}

test('real Windows Node workers contend on one temporary disk lock and serialize stale isolation plus creation', WINDOWS_ONLY, async () => {
  const root = makeTempRoot('multi-process');
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const markerDirectory = path.join(root, 'active-workers');
  const gatePath = path.join(root, 'start-workers.gate');
  fs.mkdirSync(markerDirectory);
  const oldOwner = await createConfirmedDeadOwner();
  writeLock(lockPath, oldOwner, { ...baseState(oldOwner), bytesReceived: 23 });

  const workerCount = 4;
  const workers = [];
  const monitor = startMarkerMonitor(markerDirectory, lockPath);
  try {
    for (let index = 0; index < workerCount; index += 1) {
      const nonce = 'worker-' + index + '-' + crypto.randomUUID();
      const child = spawnNode(makeConcurrentWorkerSource(), [
        ENGINE_PATH,
        lockPath,
        nonce,
        gatePath,
        markerDirectory,
        String(240 + index * 10),
      ], root);
      workers.push({ child, watcher: watchChild(child), nonce });
    }

    await Promise.all(workers.map(worker => worker.watcher.waitFor('ready')));
    fs.writeFileSync(gatePath, 'start', { flag: 'wx' });
    const completions = await Promise.all(workers.map(worker => worker.watcher.done));
    const measured = monitor.stop();
    for (const completion of completions) {
      assert.equal(completion.code, 0, [
        'worker process failed',
        'signal: ' + String(completion.signal),
        'spawnError: ' + (completion.spawnError ? (completion.spawnError.stack || completion.spawnError.message) : '<none>'),
        'stderr: ' + (completion.stderr || '<empty>'),
        'stdout: ' + (completion.stdout || '<empty>'),
        'events: ' + JSON.stringify(completion.events),
      ].join('\n'));
      assert.equal(completion.spawnError, null);
      assert.ok(!completion.events.some(event => event.event === 'error'), 'worker must not report an acquisition error');
    }

    const events = workers.flatMap(worker => worker.watcher.events);
    const acquired = events.filter(event => event.event === 'acquired');
    const released = events.filter(event => event.event === 'released');
    assert.equal(acquired.length, workerCount);
    assert.equal(released.length, workerCount);
    assert.equal(new Set(acquired.map(event => event.pid)).size, workerCount, 'each owner must be a separate Node process');
    assert.ok(acquired.every(event => event.ownerMatchesDisk === true));
    assert.equal(acquired.filter(event => event.recovered === true).length, 1, 'one contender must isolate the confirmed dead preinstall owner');
    assert.equal(measured.violations, 0, JSON.stringify(measured.firstViolation));
    assert.equal(measured.maxObservedOwners, 1, 'at most one worker may own the live lock at a time');

    const staleArchives = fs.readdirSync(root).filter(name => name.startsWith(path.basename(lockPath) + '.stale-'));
    assert.equal(staleArchives.length, 1);
    const archivedOwner = JSON.parse(fs.readFileSync(path.join(root, staleArchives[0], 'owner.json'), 'utf8'));
    assert.equal(archivedOwner.nonce, oldOwner.nonce, 'stale evidence must be isolated and preserved');
    assert.equal(fs.existsSync(lockPath), false, 'all dummy transactions must leave the active path clear');
    assert.equal(fs.existsSync(path.join(markerDirectory, 'active.marker')), false, 'the wx exclusive ownership marker must be released');

    const proof = {
      type: 'real-windows-multi-process-disk-lock',
      workerCount,
      distinctWorkerPids: acquired.map(event => event.pid),
      maxObservedOwners: measured.maxObservedOwners,
      staleOwnerPidConfirmedMissingBeforeRace: oldOwner.pid,
      staleArchiveCount: staleArchives.length,
      staleOwnerPreserved: archivedOwner.nonce === oldOwner.nonce,
      staleIsolationWinnerCount: acquired.filter(event => event.recovered === true).length,
      busyRetryCount: events.filter(event => event.event === 'busy').length,
      exclusiveSharedMarkerUsed: true,
    };
    console.log('LOCK_PROCESS_EVIDENCE ' + JSON.stringify(proof));
  } finally {
    for (const worker of workers) await terminateChild(worker.child);
    monitor.stop();
    cleanupTempRoot(root);
  }
});

test('dead owners with live installer or extractor children, start-pending, or unknown rollback remain locked', WINDOWS_ONLY, async () => {
  const scenarios = [
    {
      name: 'installer-child-live',
      childRole: 'installer',
      state: (owner, child) => ({
        ...baseState(owner),
        phase: 'installer_running',
        installerStarted: true,
        installerProcess: { role: 'installer', pid: child.child.pid, spawnedAtUtc: child.startedAtUtc, exitObserved: false },
        recoveryRequired: true,
      }),
    },
    {
      name: 'extractor-child-live',
      childRole: 'extraction',
      state: (owner, child) => ({
        ...baseState(owner),
        phase: 'extracting',
        workerProcess: { role: 'extraction', pid: child.child.pid, spawnedAtUtc: child.startedAtUtc, exitObserved: false },
      }),
    },
    {
      name: 'installer-start-pending',
      state: owner => ({
        ...baseState(owner),
        phase: 'installer_start_pending',
        installerStartPending: true,
        recoveryRequired: true,
      }),
    },
    {
      name: 'rollback-unknown',
      state: owner => ({
        ...baseState(owner),
        phase: 'installer_exit_observed',
        installerStarted: true,
        installerProcess: { role: 'installer', pid: owner.pid, spawnedAtUtc: owner.startedAtUtc, exitObserved: true, exitCode: 1 },
        recoveryRequired: true,
      }),
    },
  ];

  const outcomes = [];
  for (const scenario of scenarios) {
    const root = makeTempRoot(scenario.name);
    const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
    let liveChild = null;
    try {
      const owner = await createConfirmedDeadOwner();
      if (scenario.childRole) liveChild = await startDummyProcess();
      const state = scenario.state(owner, liveChild);
      writeLock(lockPath, owner, state);
      if (liveChild) assert.notEqual(await readWindowsProcessStartTime(liveChild.child.pid), 'PROCESS_MISSING');

      await assert.rejects(
        acquireUpdateLock(lockPath, 'must-not-install-' + scenario.name),
        error => error.code === 'UPDATE_RECOVERY_REQUIRED',
        scenario.name + ' must refuse a second installer',
      );

      const ownerAfter = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
      const stateAfter = JSON.parse(fs.readFileSync(path.join(lockPath, 'transaction.json'), 'utf8'));
      assert.equal(ownerAfter.nonce, owner.nonce, scenario.name + ' must leave the original owner record in place');
      assert.equal(stateAfter.phase, state.phase, scenario.name + ' must leave the transaction journal in place');
      assert.equal(fs.readdirSync(root).some(name => name.includes('.stale-')), false);
      outcomes.push({ scenario: scenario.name, result: 'UPDATE_RECOVERY_REQUIRED', childWasAlive: Boolean(liveChild) });
    } finally {
      if (liveChild) await stopDummyProcess(liveChild);
      cleanupTempRoot(root);
    }
  }

  console.log('LOCK_PROCESS_FAIL_CLOSED_EVIDENCE ' + JSON.stringify({
    type: 'confirmed-dead-owner-unsafe-transaction-states',
    outcomes,
    allRejected: outcomes.length === scenarios.length && outcomes.every(item => item.result === 'UPDATE_RECOVERY_REQUIRED'),
  }));
});

test('a terminated updater leaves a readable journal that a later owner can quarantine', WINDOWS_ONLY, async () => {
  const root = makeTempRoot('interrupted-owner');
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const nonce = 'interrupted-' + crypto.randomUUID();
  const source = [
    "'use strict';",
    "const engine = require(process.argv[1]);",
    "const lockPath = process.argv[2];",
    "const nonce = process.argv[3];",
    "(async () => {",
    "  const lock = await engine.acquireUpdateLock(lockPath, nonce);",
    "  engine.writeUpdateLockState(lock, { phase: 'downloading', bytesReceived: 41, installerStarted: false, recoveryRequired: false });",
    "  process.stdout.write(JSON.stringify({ event: 'journal-ready', pid: process.pid, nonce }) + '\\n');",
    "  setInterval(function () {}, 1000);",
    "})().catch(error => { process.stdout.write(JSON.stringify({ event: 'error', code: error && error.code ? error.code : 'WORKER_FAILED' }) + '\\n'); process.exitCode = 1; });",
  ].join('\n');
  const child = spawnNode(source, [ENGINE_PATH, lockPath, nonce], root);
  const watcher = watchChild(child);
  let recoveredLock = null;
  try {
    const ready = await watcher.waitFor('journal-ready');
    assert.equal(ready.nonce, nonce);
    await terminateChild(child);
    assert.equal(await readWindowsProcessStartTime(ready.pid), 'PROCESS_MISSING');

    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    const journal = JSON.parse(fs.readFileSync(path.join(lockPath, 'transaction.json'), 'utf8'));
    assert.equal(owner.pid, ready.pid);
    assert.equal(owner.nonce, nonce);
    assert.equal(journal.ownerPid, ready.pid);
    assert.equal(journal.nonce, nonce);
    assert.equal(journal.phase, 'downloading');
    assert.equal(journal.bytesReceived, 41);
    assert.equal(journal.recoveryRequired, false);

    recoveredLock = await acquireAfterGuardianExit(lockPath, 'after-interruption-' + crypto.randomUUID());
    assert.equal(recoveredLock.recovered, true);
    const staleArchives = fs.readdirSync(root).filter(name => name.startsWith(path.basename(lockPath) + '.stale-'));
    assert.equal(staleArchives.length, 1);
    const preserved = JSON.parse(fs.readFileSync(path.join(root, staleArchives[0], 'transaction.json'), 'utf8'));
    assert.equal(preserved.nonce, nonce);
    assert.equal(preserved.phase, 'downloading');
    await finishUpdateLock(recoveredLock, 'failed_before_install');
    recoveredLock = null;

    console.log('LOCK_PROCESS_INTERRUPTION_EVIDENCE ' + JSON.stringify({
      type: 'process-interrupted-journal-readable',
      terminatedOwnerPid: ready.pid,
      confirmedDead: true,
      journalPhase: journal.phase,
      journalBytesReceived: journal.bytesReceived,
      staleJournalPreserved: true,
      laterOwnerRecovered: true,
    }));
  } finally {
    await terminateChild(child);
    if (recoveredLock && recoveredLock.mutex && recoveredLock.mutex.active) {
      try { await finishUpdateLock(recoveredLock, 'failed_before_install'); } catch { /* preserve test failure */ }
    }
    cleanupTempRoot(root);
  }
});

test('a stale caller nonce cannot release a later owner under the real Windows mutex', WINDOWS_ONLY, async () => {
  const root = makeTempRoot('nonce-replacement');
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const oldNonce = 'old-' + crypto.randomUUID();
  const newNonce = 'new-' + crypto.randomUUID();
  let newLock = null;
  try {
    const oldLock = await acquireUpdateLock(lockPath, oldNonce);
    await finishUpdateLock(oldLock, 'failed_before_install');
    newLock = await acquireUpdateLock(lockPath, newNonce);

    // Simulate a delayed stale caller retaining an in-memory lease object after
    // its original transaction released. The disk identity must still win.
    oldLock.mutex.active = true;
    await assert.rejects(
      finishUpdateLock(oldLock, 'failed_before_install'),
      error => error.code === 'UPDATE_LOCK_OWNERSHIP_CHANGED',
    );
    oldLock.mutex.active = false;

    const currentOwner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    assert.equal(currentOwner.nonce, newNonce);
    assert.equal(newLock.mutex.active, true, 'the rejected stale caller must not release the new mutex lease');
    await finishUpdateLock(newLock, 'failed_before_install');
    newLock = null;

    console.log('LOCK_PROCESS_NONCE_EVIDENCE ' + JSON.stringify({
      type: 'old-nonce-cannot-release-new-owner',
      staleCallerRejected: true,
      currentOwnerPreserved: true,
      newMutexLeasePreserved: true,
    }));
  } finally {
    if (newLock && newLock.mutex && newLock.mutex.active) {
      try { await finishUpdateLock(newLock, 'failed_before_install'); } catch { /* preserve test failure */ }
    }
    cleanupTempRoot(root);
  }
});

test('verified terminal archive leaves the active path free for an old mkdir caller', WINDOWS_ONLY, async () => {
  const root = makeTempRoot('legacy-mkdir');
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const nonce = 'verified-rollback-' + crypto.randomUUID();
  let lock = null;
  try {
    lock = await acquireUpdateLock(lockPath, nonce);
    writeUpdateLockState(lock, {
      phase: 'installer_exit_observed',
      installerStarted: true,
      installerStartPending: false,
      installerProcess: {
        role: 'installer',
        pid: process.pid,
        spawnedAtUtc: new Date().toISOString(),
        exitObserved: true,
        exitCode: 1,
      },
      recoveryRequired: true,
    });
    await finishUpdateLock(lock, 'rolled_back', { rollbackVerified: true });
    lock = null;

    assert.equal(fs.existsSync(lockPath), false);
    const archives = fs.readdirSync(root).filter(name => name.startsWith(path.basename(lockPath) + '.rolled_back-'));
    assert.equal(archives.length, 1);
    const terminal = JSON.parse(fs.readFileSync(path.join(root, archives[0], 'transaction.json'), 'utf8'));
    assert.equal(terminal.nonce, nonce);
    assert.equal(terminal.terminalOutcome, 'rolled_back');
    assert.equal(terminal.rollbackVerified, true);

    const legacyCallerSource = [
      "'use strict';",
      "const fs = require('node:fs');",
      "const lockPath = process.argv[1];",
      "try {",
      "  fs.mkdirSync(lockPath);",
      "  fs.rmdirSync(lockPath);",
      "  process.stdout.write('LEGACY_MKDIR_ACQUIRED\\n');",
      "} catch (error) {",
      "  process.stdout.write(error && error.code === 'EEXIST' ? 'LEGACY_MKDIR_BUSY\\n' : 'LEGACY_MKDIR_FAILED\\n');",
      "  process.exitCode = 2;",
      "}",
    ].join('\n');
    const legacyCaller = spawnNode(legacyCallerSource, [lockPath], root);
    const legacyWatch = watchChild(legacyCaller);
    const result = await legacyWatch.done;
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.events.length === 0, 'legacy caller writes its marker as plain text');
    assert.equal(fs.existsSync(lockPath), false, 'legacy dummy caller removes only its empty temporary directory');
    const terminalAfterLegacyCall = JSON.parse(fs.readFileSync(path.join(root, archives[0], 'transaction.json'), 'utf8'));
    assert.equal(terminalAfterLegacyCall.nonce, nonce);

    const stdout = await capturePlainChildOutput(legacyCaller, legacyWatch);
    assert.match(stdout, /LEGACY_MKDIR_ACQUIRED/);
    console.log('LOCK_PROCESS_LEGACY_EVIDENCE ' + JSON.stringify({
      type: 'old-mkdir-caller-after-terminal-archive',
      legacyMkdirAcquired: true,
      terminalArchivePreserved: true,
      archivedNoncePreserved: true,
    }));
  } finally {
    if (lock && lock.mutex && lock.mutex.active) {
      try { await finishUpdateLock(lock, 'failed_before_install'); } catch { /* preserve test failure */ }
    }
    cleanupTempRoot(root);
  }
});

async function capturePlainChildOutput(child, watcher) {
  const result = await watcher.done;
  return result.stdout;
}
