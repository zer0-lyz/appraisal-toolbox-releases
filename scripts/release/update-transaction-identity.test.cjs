'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 60_000 };

test('installer transaction identity fixtures pass under system Windows PowerShell 5.1', WINDOWS_ONLY, async () => {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const systemDirectory = process.arch === 'ia32' ? 'Sysnative' : 'System32';
  const powershellPath = path.join(systemRoot, systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fixturePath = path.join(ROOT, 'windows', 'tests', 'update-transaction-identity.test.ps1');
  const result = spawnSync(powershellPath, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixturePath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.error, undefined, result.error && result.error.message);
  assert.equal(result.status, 0, `PowerShell fixture failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const evidenceLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('{"ok":true,"fixtureOnly":true,'));
  assert.ok(evidenceLine, `PowerShell fixture did not report scoped evidence.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const evidence = JSON.parse(evidenceLine);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.fixtureOnly, true);
  assert.equal(evidence.realDesktopCovered, false);
  assert.ok(evidence.coverage.some(item => item.includes('ordinary-shell nonce')));
  assert.ok(evidence.coverage.some(item => item.includes('junction journal path')));
  console.log('INSTALLER_IDENTITY_FIXTURE_EVIDENCE ' + JSON.stringify(evidence));
});
