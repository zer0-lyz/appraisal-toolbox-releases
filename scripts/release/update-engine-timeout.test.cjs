'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { findInstallerFailureReport, recoverTimedOutInstaller, runProcess } = require('../../native-helper/update_engine.js');

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
  assert.match(installer, /Previous installation snapshot retained for recovery/);
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
