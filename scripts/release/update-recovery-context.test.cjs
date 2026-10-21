'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const CONTEXT_PATH = path.join(ROOT, 'windows', 'installer', 'registration-context.ps1');
const FIXTURE_PATH = path.join(__dirname, 'update-recovery-context.fixture.ps1');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' };

function findPowerShell() {
  const candidates = [
    process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    process.env.WINDIR && path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || 'powershell.exe';
}

test('Windows registration context accepts only the exact recovery and verifier process chains', WINDOWS_ONLY, () => {
  const result = spawnSync(findPowerShell(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FIXTURE_PATH,
    '-RegistrationContextPath', CONTEXT_PATH,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summaryLine = result.stdout.trim().split(/\r?\n/).at(-1);
  const summary = JSON.parse(summaryLine);
  assert.equal(summary.fixtureOnly, true, 'synthetic process-chain evidence must be labeled fixture-only');
  assert.equal(summary.astParse, 'passed');

  for (const name of [
    'normalInstallWrapper', 'directRecovery', 'directRecoveryWithNativeHostCmdWrapper',
    'verifyTreeChild', 'verifyRegistryChild',
  ]) {
    assert.equal(summary.accepts[name], true, `${name} must be accepted`);
  }
  for (const name of [
    'wrongFile', 'wrongFlags', 'wrongNonce', 'wrongJournal', 'wrongRoot', 'wrongParentChild',
    'nativeHostCmdWrapperWrongBrowserParent',
    'ordinaryPowerShell', 'arbitraryAncestor', 'arbitraryRegistrationKey', 'arbitraryTree',
    'arbitrarySnapshot', 'differentPackageVerifier', 'verifierParentChild', 'verifierArbitraryAncestor',
    'journalNonceMismatch', 'journalRootMismatch',
  ]) {
    assert.equal(summary.rejects[name], true, `${name} must be rejected`);
  }
});
