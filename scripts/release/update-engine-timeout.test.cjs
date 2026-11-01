'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { abandonUpdateLock, acquireUpdateLock, classifyUpdateLockOwner, compareSemver, createShortExtractionRoot, emitInstallerVerificationProgress, finishUpdateLock, findInstallerFailureReport, installerFailureDiagnostics, packageMatchesReleaseTarget, readInstallerDiagnosticTail, recoverTimedOutInstaller, runProcess, writeUpdateLockState } = require('../../native-helper/update_engine.js');

function fakeMutex() {
  return {
    active: true,
    released: false,
    async release() { this.active = false; this.released = true; },
  };
}

function priorLock(root, stateOverrides = {}, ownerOverrides = {}) {
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const startedAtUtc = '2026-10-19T00:00:00.000Z';
  const owner = { schemaVersion: 2, pid: 12345, nonce: 'old-attempt', startedAtUtc, ...ownerOverrides };
  const state = {
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
    ...stateOverrides,
  };
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner));
  fs.writeFileSync(path.join(lockPath, 'transaction.json'), JSON.stringify(state));
  return { lockPath, owner, state };
}

test('stale update lock is reclaimed only after confirmed owner exit or PID reuse', async () => {
  const now = Date.parse('2026-10-19T00:00:00.000Z');
  const startedAtUtc = new Date(now).toISOString();
  const owner = { pid: 12345, nonce: 'owner-nonce', startedAtUtc };
  assert.deepEqual(classifyUpdateLockOwner({ owner, processStartTimeUtc: 'PROCESS_MISSING', nowMs: now + 1000 }), {
    stale: true, classification: 'owner_process_exited',
  });
  assert.deepEqual(classifyUpdateLockOwner({ owner, processStartTimeUtc: new Date(now + 10000).toISOString(), nowMs: now + 10000 }), {
    stale: true, classification: 'owner_pid_reused',
  });
  assert.deepEqual(classifyUpdateLockOwner({ owner, processStartTimeUtc: new Date(now - 60000).toISOString(), nowMs: now + 10000 }), {
    stale: false, classification: 'owner_process_active',
  });
  assert.deepEqual(classifyUpdateLockOwner({ owner, processStartTimeUtc: null, nowMs: now + 10000 }), {
    stale: false, classification: 'owner_unverified',
  });
});

test('update lock recovery quarantines dead-owner download evidence before acquiring a new lock', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-stale-lock-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const now = Date.parse('2026-10-19T00:00:00.000Z');
  try {
    priorLock(root, { phase: 'downloading' }, { startedAtUtc: new Date(now).toISOString() });
    const result = await acquireUpdateLock(lockPath, 'new-attempt', {
      now: () => now + 1000,
      readProcessStartTime: async () => 'PROCESS_MISSING',
      acquireMutex: async () => fakeMutex(),
    });
    assert.equal(result.recovered, true);
    assert.ok(fs.existsSync(path.join(lockPath, 'owner.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).nonce, 'new-attempt');
    const archived = fs.readdirSync(root).find(name => name.startsWith('.AppraisalToolbox-update.lock.stale-'));
    assert.ok(archived, 'stale lock should be renamed, not deleted');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, archived, 'owner.json'), 'utf8')).nonce, 'old-attempt');
    await abandonUpdateLock(result);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('active or unverifiable update locks remain untouched', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-live-lock-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const now = Date.now();
  try {
    priorLock(root, {}, { nonce: 'active-attempt', startedAtUtc: new Date(now).toISOString() });
    await assert.rejects(acquireUpdateLock(lockPath, 'retry-active', {
      readProcessStartTime: async () => new Date(now - 60000).toISOString(),
      acquireMutex: async () => fakeMutex(),
    }), error => error.code === 'UPDATE_ALREADY_RUNNING');
    await assert.rejects(acquireUpdateLock(lockPath, 'retry-unknown', {
      readProcessStartTime: async () => null,
      acquireMutex: async () => fakeMutex(),
    }), error => error.code === 'UPDATE_LOCK_OWNER_UNVERIFIED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).nonce, 'active-attempt');
    assert.equal(fs.readdirSync(root).some(name => name.includes('.stale-')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy lock without an owner-bound transaction journal is never reclaimed by age', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-ownerless-lock-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const now = Date.now();
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: 12345, nonce: 'legacy', startedAtUtc: new Date(now - 60000).toISOString() }));
    await assert.rejects(acquireUpdateLock(lockPath, 'retry-too-soon', {
      now: () => now,
      readProcessStartTime: async () => 'PROCESS_MISSING',
      acquireMutex: async () => fakeMutex(),
    }), error => error.code === 'UPDATE_LOCK_OWNER_UNVERIFIED');
    fs.utimesSync(lockPath, new Date(now - 60000), new Date(now - 60000));
    await assert.rejects(acquireUpdateLock(lockPath, 'retry-old-empty-lock', {
      now: () => now,
      readProcessStartTime: async () => 'PROCESS_MISSING',
      acquireMutex: async () => fakeMutex(),
    }), error => error.code === 'UPDATE_LOCK_OWNER_UNVERIFIED');
    assert.equal(fs.existsSync(path.join(lockPath, 'owner.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.AppraisalToolbox-update.lock.stale-0')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixtureSpawn({ killerExitCode = 0, childDelayMs = 25, childExitCode = 0 } = {}) {
  return (command) => {
    const child = new EventEmitter();
    if (String(command).toLowerCase().includes('taskkill.exe')) {
      setTimeout(() => child.emit('close', killerExitCode), 1);
      return child;
    }
    child.pid = 12345;
    setTimeout(() => child.emit('close', childExitCode), childDelayMs);
    return child;
  };
}

test('dead owner with installer start pending or recovery required cannot be reclaimed', async () => {
  for (const state of [
    { phase: 'installer_start_pending', installerStartPending: true, recoveryRequired: true },
    { phase: 'installer_running', installerStarted: true, recoveryRequired: true },
    { phase: 'recovery_running', recoveryStartPending: true, recoveryRequired: true },
  ]) {
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-recovery-required-lock-test-'));
    const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
    try {
      priorLock(root, state);
      await assert.rejects(acquireUpdateLock(lockPath, 'retry-must-not-install', {
        readProcessStartTime: async () => 'PROCESS_MISSING',
        acquireMutex: async () => fakeMutex(),
      }), error => error.code === 'UPDATE_RECOVERY_REQUIRED');
      assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).nonce, 'old-attempt');
      assert.equal(fs.readdirSync(root).some(name => name.includes('.stale-')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('dead owner with a still-running extraction process cannot be reclaimed', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-extraction-lock-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  const spawnedAtUtc = '2026-10-19T00:00:00.000Z';
  try {
    priorLock(root, {
      phase: 'extracting',
      workerProcess: { role: 'extraction', pid: 67890, spawnedAtUtc, exitObserved: false },
    });
    await assert.rejects(acquireUpdateLock(lockPath, 'retry-must-not-install', {
      readProcessStartTime: async pid => pid === 12345 ? 'PROCESS_MISSING' : spawnedAtUtc,
      acquireMutex: async () => fakeMutex(),
    }), error => error.code === 'UPDATE_RECOVERY_REQUIRED');
    assert.equal(fs.existsSync(lockPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable installer start write failure prevents child process creation', async () => {
  let spawnCount = 0;
  const spawnProcess = () => { spawnCount += 1; return fixtureSpawn()('fixture-installer'); };
  await assert.rejects(runProcess('fixture-installer', [], {}, 100, spawnProcess, {
    beforeSpawn() { throw Object.assign(new Error('journal flush failed'), { code: 'UPDATE_LOCK_STATE_WRITE_FAILED' }); },
  }), error => error.code === 'UPDATE_LOCK_STATE_WRITE_FAILED');
  assert.equal(spawnCount, 0);
});

test('verified rollback writes terminal nonce state and archives the active lock for old helpers', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-terminal-lock-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  let mutex;
  try {
    const lock = await acquireUpdateLock(lockPath, 'verified-rollback', {
      acquireMutex: async () => (mutex = fakeMutex()),
    });
    writeUpdateLockState(lock, {
      phase: 'installer_exit_observed',
      installerStarted: true,
      installerStartPending: false,
      installerProcess: { role: 'installer', pid: process.pid, spawnedAtUtc: new Date().toISOString(), exitObserved: true, exitCode: 1 },
      recoveryRequired: true,
    });
    await finishUpdateLock(lock, 'rolled_back');
    assert.equal(fs.existsSync(lockPath), false, 'the active lock directory is removed from the path old helpers inspect');
    assert.equal(mutex.released, true);
    const archived = fs.readdirSync(root).find(name => name.startsWith('.AppraisalToolbox-update.lock.rolled_back-'));
    assert.ok(archived, 'the terminal lock directory remains archived');
    const journal = JSON.parse(fs.readFileSync(path.join(root, archived, 'transaction.json'), 'utf8'));
    assert.equal(journal.nonce, 'verified-rollback');
    assert.equal(journal.terminalOutcome, 'rolled_back');
    fs.mkdirSync(lockPath);
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.rmSync(path.join(root, archived), { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed terminal archive is not reported retryable, and next helper can finish archive after a crash window', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-terminal-archive-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  let lock;
  try {
    lock = await acquireUpdateLock(lockPath, 'archive-retry', { acquireMutex: async () => fakeMutex() });
    writeUpdateLockState(lock, {
      phase: 'installer_exit_observed', installerStarted: true, installerStartPending: false,
      installerProcess: { role: 'installer', pid: process.pid, spawnedAtUtc: new Date().toISOString(), exitObserved: true, exitCode: 1 },
      recoveryRequired: true,
    });
    await assert.rejects(finishUpdateLock(lock, 'rolled_back', {}, { renameDirectory() { throw new Error('rename denied'); } }), error => error.code === 'UPDATE_LOCK_RELEASE_FAILED');
    const onDisk = JSON.parse(fs.readFileSync(path.join(lockPath, 'transaction.json'), 'utf8'));
    assert.equal(onDisk.terminalOutcome, 'rolled_back');
    assert.equal(fs.existsSync(lockPath), true, 'failed archive keeps the old-helper blocking directory');
    await abandonUpdateLock(lock);
    const next = await acquireUpdateLock(lockPath, 'after-archive-crash', {
      readProcessStartTime: async () => 'PROCESS_MISSING',
      acquireMutex: async () => fakeMutex(),
    });
    assert.equal(next.recovered, true);
    const archived = fs.readdirSync(root).find(name => name.startsWith('.AppraisalToolbox-update.lock.stale-'));
    assert.ok(archived);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, archived, 'transaction.json'), 'utf8')).terminalOutcome, 'rolled_back');
    await abandonUpdateLock(next);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('old lock owner nonce cannot release or archive another owner state', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-owner-nonce-test-'));
  const lockPath = path.join(root, '.AppraisalToolbox-update.lock');
  let lock;
  try {
    lock = await acquireUpdateLock(lockPath, 'owner-nonce-one', { acquireMutex: async () => fakeMutex() });
    const ownerPath = path.join(lockPath, 'owner.json');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    owner.nonce = 'owner-nonce-two';
    fs.writeFileSync(ownerPath, JSON.stringify(owner));
    await assert.rejects(finishUpdateLock(lock, 'failed_before_install'), error => error.code === 'UPDATE_LOCK_OWNERSHIP_CHANGED');
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(lock.mutex.released, false);
  } finally {
    if (lock?.mutex?.active) await abandonUpdateLock(lock);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer timeout waits for confirmed process-tree termination before rollback', async () => {
  await assert.rejects(
    runProcess('fixture-installer', [], {}, 5, fixtureSpawn()),
    error => error.code === 'UPDATE_PROCESS_TIMEOUT' && error.terminationConfirmed === true,
  );
});

test('installer timeout with an unconfirmed taskkill result refuses recovery', async () => {
  await assert.rejects(
    runProcess('fixture-installer', [], {}, 5, fixtureSpawn({ killerExitCode: 128 })),
    error => error.code === 'UPDATE_PROCESS_TERMINATION_UNCONFIRMED' && error.terminationConfirmed !== true,
  );
});

test('transaction journal is durable before destructive install and recovery verifies old files and registry', () => {
  const sourceRoot = path.resolve(__dirname, '../..');
  const installer = fs.readFileSync(path.join(sourceRoot, 'windows/installer/install.ps1'), 'utf8');
  const journalBeforeMove = installer.indexOf('Write-UpdateTransactionJournal "previous-root-snapshotted"');
  const moveOldRoot = installer.indexOf('Move-Item -LiteralPath $InstallRoot -Destination $BackupRoot');
  assert(journalBeforeMove >= 0 && moveOldRoot > journalBeforeMove);
  assert.match(installer, /function Invoke-UpdateTransactionRecovery/);
  assert.match(installer, /Verify-ExternalTree \$BackupPath \$InstallSnapshotPath/);
  assert.match(installer, /Restore-RegistrySnapshot \$RegistryPath \$Snapshots\[\$RegistryPath\]/);
  assert.match(installer, /Assert-RegistrationContext \$RegistrationExecutionContext/);
  assert.match(installer, /updateNonce = \$UpdateNonce/);
  assert.match(installer, /updaterOwnerPid = \[int\]\$Identity\.ownerPid/);
  assert.match(installer, /updaterOwnerStartedAtUtc = \[string\]\$Identity\.ownerStartedAtUtc/);
  assert.match(installer, /FileOptions\]::WriteThrough/);
  assert.match(installer, /Flush\(\$true\)/);
  assert.match(installer, /Journal\.updaterOwnerStartedAtUtc -cne \[string\]\$RecoveryIdentity\.ownerStartedAtUtc/);
  assert.match(installer, /Previous installation snapshot retained for recovery/);
});

test('update lock journal binds owner and phase with a forced file flush', () => {
  const sourceRoot = path.resolve(__dirname, '../..');
  const updater = fs.readFileSync(path.join(sourceRoot, 'native-helper/update_engine.js'), 'utf8');
  const recovery = updater.slice(updater.indexOf('async function recoverTimedOutInstaller'), updater.indexOf('async function downloadAndInstallUpdate'));
  assert.match(updater, /fs\.fsyncSync\(fd\)/);
  assert.match(updater, /ownerStartedAtUtc/);
  assert.match(updater, /installerStartPending/);
  assert.match(updater, /writeUpdateLockState\(lock, \{[\s\S]*?phase: "package_verified"/);
  assert.match(updater, /await finishUpdateLock\(lock, terminalOutcome\)/);
  assert.match(recovery, /lock\.ownerPid/);
  assert.match(recovery, /TB_UPDATE_EXTENSION_PATH: extensionRoot/);
  assert.match(recovery, /TB_UPDATE_JOURNAL_PATH: journalPath/);
  assert.match(recovery, /TB_UPDATE_OWNER_PID: String\(lock\.ownerPid\)/);
  assert.match(recovery, /TB_UPDATE_OWNER_STARTED_AT_UTC: lock\.ownerStartedAtUtc/);
  assert.match(recovery, /TB_UPDATE_LOCK_PATH: lock\.lockPath/);
  assert.match(recovery, /TB_UPDATE_LOCK_STATE_PATH: path\.join\(lock\.lockPath, "transaction\.json"\)/);
});

test('missing transaction journal cannot claim registry rollback from file fingerprints alone', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-recovery-test-'));
  try {
    await assert.rejects(
      recoverTimedOutInstaller({
        packageRoot: root,
        installRoot: path.join(root, 'AppraisalToolbox'),
        extensionRoot: path.join(root, 'extension'),
        journalPath: path.join(root, 'missing', 'update-transaction.json'),
        nonce: '11111111-1111-4111-8111-111111111111',
        nativeExeSha256: 'a'.repeat(64),
        extensionVersionSha256: 'b'.repeat(64),
      }),
      error => error.code === 'UPDATE_PROCESS_RECOVERY_FAILED' && /cannot prove registry rollback/.test(error.recoveryDetail),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer failure report is bound to this install path and update nonce', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-failure-report-test-'));
  const installRoot = path.join(root, 'AppraisalToolbox');
  const nonce = '22222222-2222-4222-8222-222222222222';
  const reportPath = `${installRoot}.installation-failure-42-${'c'.repeat(32)}.json`;
  const report = { status: 'failed', rollbackVerified: true, updateNonce: nonce, installRoot };
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report));
    assert.equal(findInstallerFailureReport({ installRoot, nonce }).report.rollbackVerified, true);
    assert.equal(findInstallerFailureReport({ installRoot, nonce: '33333333-3333-4333-8333-333333333333' }), null);
    fs.writeFileSync(`${installRoot}.installation-failure-43-${'d'.repeat(32)}.json`, JSON.stringify(report));
    assert.equal(findInstallerFailureReport({ installRoot, nonce }), null, 'ambiguous reports must not attest rollback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('non-zero installer exit never emits successful-install verification progress', () => {
  const frames = [];
  assert.equal(emitInstallerVerificationProgress(1, (...args) => frames.push(args)), false);
  assert.deepEqual(frames, []);
  assert.equal(emitInstallerVerificationProgress(0, (...args) => frames.push(args)), true);
  assert.deepEqual(frames, [[96, 'verifying_install', '正在核对本次安装结果…']]);
});

test('installer failure diagnostics include bounded sanitized tail and context classification', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolbox-installer-log-test-'));
  const logPath = path.join(root, 'installer-log.txt');
  try {
    fs.writeFileSync(logPath, Array.from({ length: 24 }, (_, i) => `line-${i + 1}`).concat('token=secret-value').join('\n'));
    const tail = readInstallerDiagnosticTail(logPath);
    assert.equal(tail.length, 20);
    assert.equal(tail.at(-1), 'token=[redacted]');
    const details = installerFailureDiagnostics({
      file: path.join(root, 'failure.json'),
      report: {
        error: 'REGISTRATION_VERIFICATION_INVALID: parent-pid-reused',
        executionContext: { reasons: ['parent-pid-reused', 'desktop-boundary-unattested'] },
      },
    }, logPath);
    assert.equal(details.failureCategory, 'registration_context_rejected');
    assert.deepEqual(details.contextReasons, ['parent-pid-reused', 'desktop-boundary-unattested']);
    assert.equal(details.failureReportPath, path.join(root, 'failure.json'));
    assert.equal(details.installerLogPath, logPath);
    assert.deepEqual(details.installerLogTail, tail);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('short extraction root uses a user-owned path and is disposable', () => {
  const root = createShortExtractionRoot();
  try {
    assert.match(path.basename(root), /^ATU-/);
    assert.ok(path.isAbsolute(root));
    const allowedBases = [process.env.USERPROFILE, process.env.LOCALAPPDATA].filter(Boolean).map(value => path.resolve(value));
    assert.ok(allowedBases.some(base => root.toLowerCase().startsWith(`${base.toLowerCase()}${path.sep}`)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing GitHub API build number is accepted only for strict version upgrades', () => {
  const target = { productVersion: '0.2.3', buildNumber: 2026101805 };
  const apiUpgrade = { source: 'github-api', updateAvailable: true, latestVersion: '0.2.3', latestBuildNumber: 0 };
  assert.equal(packageMatchesReleaseTarget(target, apiUpgrade, { productVersion: '0.2.2' }), true);
  assert.equal(packageMatchesReleaseTarget(target, { ...apiUpgrade, latestBuildNumber: 2026101805 }, { productVersion: '0.2.2' }), true);
  assert.equal(packageMatchesReleaseTarget(target, { ...apiUpgrade, latestBuildNumber: 2026101806 }, { productVersion: '0.2.2' }), false);
  assert.equal(packageMatchesReleaseTarget(target, apiUpgrade, { productVersion: '0.2.3' }), false);
  assert.equal(packageMatchesReleaseTarget(target, apiUpgrade, { productVersion: '0.2.4' }), false);
  assert.equal(packageMatchesReleaseTarget(target, { ...apiUpgrade, source: 'manifest' }, { productVersion: '0.2.2' }), false);
  assert.equal(packageMatchesReleaseTarget({ ...target, productVersion: '0.2.4' }, apiUpgrade, { productVersion: '0.2.2' }), false);
  assert.equal(compareSemver('0.2.3', '0.2.2'), 1);
  assert.equal(compareSemver('0.2.3-rc.1', '0.2.3'), -1);
});
