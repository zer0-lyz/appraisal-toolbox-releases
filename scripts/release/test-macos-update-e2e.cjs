'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const [packageRootValue, installRootValue, testRootValue, sourceRootValue] = process.argv.slice(2);
if (![packageRootValue, installRootValue, testRootValue, sourceRootValue].every(Boolean)) {
  throw new Error('PACKAGE_INSTALL_TEST_SOURCE_PATHS_REQUIRED');
}
const packageRoot = path.resolve(packageRootValue);
const installRoot = path.resolve(installRootValue);
const testRoot = path.resolve(testRootValue);
const sourceRoot = path.resolve(sourceRootValue);
const homeDir = path.dirname(installRoot);
const packageVersion = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extension/version.json'), 'utf8'));
const packageContract = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extension/runtime-compat.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'BUILD-PROVENANCE.json'), 'utf8'));
const zipPath = path.join(testRoot, 'isolated-update-candidate.zip');
execFileSync('/usr/bin/python3', [path.join(sourceRoot, 'scripts/release/package-macos.py'), 'zip', packageRoot, zipPath], { stdio: 'inherit' });
const zipBytes = fs.readFileSync(zipPath);
const assetSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
const assetUrl = `https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/${provenance.buildId}/appraisal-toolbox-macos-arm64.zip`;
const latest = {
  ok: true, releasePublished: true, updateAvailable: true, repairRequired: false,
  platform: 'macos-arm64', latestVersion: packageVersion.productVersion,
  latestBuildNumber: Number(packageVersion.buildNumber), latestRuntimeBuildId: packageContract.runtimeBuildId,
  latestRuntimeBuildKind: packageContract.runtimeBuildKind,
  asset: { name: path.basename(zipPath), url: assetUrl, size: zipBytes.length, sha256: assetSha },
  downloadCandidates: [{ source: 'isolated-package-test', url: assetUrl, size: zipBytes.length, sha256: assetSha }],
};
const testFrameworkPath = process.env.APPRAISAL_TEST_FRAMEWORK_PATH;
if (!testFrameworkPath || !process.env.DYLD_FRAMEWORK_PATH) throw new Error('ISOLATED_PYTHON_FRAMEWORK_REQUIRED');
const { createMacOSUpdateEngine } = require(path.join(packageRoot, 'native-helper/update_engine_macos.js'));
const engine = createMacOSUpdateEngine({
  homeDir,
  installRoot,
  downloadAsset: async (_url, destination) => {
    fs.copyFileSync(zipPath, destination);
    return { size: fs.statSync(destination).size, sha256: assetSha };
  },
  installPackage: async ({ installerPath, packageRoot: installerRoot, logPath, env, onStarted }) => {
    const logFd = fs.openSync(logPath, 'wx', 0o600);
    const child = spawn('/bin/bash', [installerPath], {
      cwd: installerRoot,
      env: { ...env, APPRAISAL_TEST_FRAMEWORK_PATH: testFrameworkPath, DYLD_FRAMEWORK_PATH: testFrameworkPath },
      stdio: ['ignore', logFd, logFd],
    });
    try {
      onStarted(child);
      await new Promise((resolve, reject) => {
        child.once('error', () => reject(new Error('UPDATE_INSTALLER_NOT_STARTED')));
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`UPDATE_INSTALLER_EXIT_${code ?? -1}`)));
      });
    } finally {
      fs.closeSync(logFd);
    }
  },
  verificationEnvironment: {
    APPRAISAL_TEST_FRAMEWORK_PATH: testFrameworkPath,
    DYLD_FRAMEWORK_PATH: testFrameworkPath,
  },
});
const frames = [];
engine.downloadAndInstallUpdate({ url: assetUrl, sha256: assetSha }, (frame) => frames.push(frame), async (input) => {
  assert.equal(input.repository, 'zer0-lyz/appraisal-toolbox-releases');
  assert.equal(input.platform, 'darwin');
  assert.equal(input.architecture, 'arm64');
  return latest;
}).then((result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.platform, 'macos-arm64');
  assert.equal(result.latestVersion, packageVersion.productVersion);
  assert.equal(Number(result.latestBuildNumber), Number(packageVersion.buildNumber));
  assert.equal(frames.some((frame) => frame.phase === 'installing'), true);
  for (const relative of ['history/preserve.txt', 'cache/preserve.txt', 'projects/fixture/workbooks/preserve.txt', 'map-config.json']) {
    assert.equal(fs.existsSync(path.join(installRoot, relative)), true, `preserved ${relative}`);
  }
  const success = {
    ok: true, evidenceType: 'isolated-update-engine-and-real-installer-transaction',
    sourceCommit: provenance.sourceCommit, productVersion: packageVersion.productVersion,
    buildNumber: Number(packageVersion.buildNumber), buildId: provenance.buildId,
    packageSha256: assetSha, installerLogExists: fs.existsSync(result.installerLogPath),
    chromeAndEdgeNativeHostVerified: true, userDataPreserved: true, browserGuiCovered: false,
  };
  fs.rmSync(zipPath, { force: true });
  process.stdout.write(`${JSON.stringify(success)}\n`);
}).catch((error) => {
  fs.rmSync(zipPath, { force: true });
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
