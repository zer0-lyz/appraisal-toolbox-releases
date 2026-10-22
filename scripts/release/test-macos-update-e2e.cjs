'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [packageRootValue, installRootValue, testRootValue, sourceRootValue] = process.argv.slice(2);
if (![packageRootValue, installRootValue, testRootValue, sourceRootValue].every(Boolean)) {
  throw new Error('PACKAGE_INSTALL_TEST_SOURCE_PATHS_REQUIRED');
}
const packageRoot = path.resolve(packageRootValue);
const installRoot = path.resolve(installRootValue);
const testRoot = path.resolve(testRootValue);
const sourceRoot = path.resolve(sourceRootValue);
const homeDir = path.dirname(installRoot);
const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extension/version.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extension/runtime-compat.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'BUILD-PROVENANCE.json'), 'utf8'));
const pythonBin = process.env.APPRAISAL_TEST_LOCK_PYTHON || process.env.APPRAISAL_PYTHON_BOOTSTRAP;
const frameworkPath = process.env.APPRAISAL_TEST_FRAMEWORK_PATH;
if (!pythonBin || !frameworkPath || process.env.DYLD_FRAMEWORK_PATH !== frameworkPath) {
  throw new Error('ISOLATED_PINNED_PYTHON_FRAMEWORK_REQUIRED');
}
assert.equal(execFileSync(pythonBin, ['--version'], {encoding: 'utf8'}).trim(), 'Python 3.14.6');
const zipPath = path.join(testRoot, 'isolated-update-candidate.zip');
execFileSync(pythonBin, [path.join(sourceRoot, 'scripts/release/package-macos.py'), 'zip', packageRoot, zipPath], {stdio: 'ignore'});
const assetSha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const assetSize = fs.statSync(zipPath).size;
const assetUrl = `https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/${provenance.buildId}/appraisal-toolbox-macos-arm64.zip`;
const latest = {
  ok: true, releasePublished: true, updateAvailable: true, repairRequired: false,
  platform: 'macos-arm64', latestVersion: version.productVersion,
  latestBuildNumber: Number(version.buildNumber), latestRuntimeBuildId: contract.runtimeBuildId,
  latestRuntimeBuildKind: contract.runtimeBuildKind,
  asset: {name: path.basename(zipPath), url: assetUrl, size: assetSize, sha256: assetSha},
  downloadCandidates: [{source: 'isolated-package-fixture', url: assetUrl, size: assetSize, sha256: assetSha}],
};
const {runMacOSUpdateTransaction} = require(path.join(packageRoot, 'native-helper/macos_update_worker.js'));
const {MacUpdateTransactionStore} = require(path.join(packageRoot, 'native-helper/macos_update_transaction.js'));
const updatesRoot = path.join(homeDir, '.appraisal-toolbox-updates');
const nonce = crypto.randomUUID();
const verificationEnvironment = {
  APPRAISAL_TEST_FRAMEWORK_PATH: frameworkPath,
  DYLD_FRAMEWORK_PATH: frameworkPath,
};
const preserved = ['history/preserve.txt', 'cache/preserve.txt', 'projects/fixture/workbooks/preserve.txt', 'map-config.json'];
const originalBytes = new Map(preserved.map(relative => [relative, fs.readFileSync(path.join(installRoot, relative))]));
const receipts = [];
(async () => {
  try {
    const result = await runMacOSUpdateTransaction({
      schemaVersion: 1, nonce, installRoot, updatesRoot,
      update: {url: assetUrl, sha256: assetSha, assetName: path.basename(zipPath), sizeBytes: assetSize},
    }, {
      homeDir, pythonBin, requirePinnedPython: false,
      lockEnvironment: {DYLD_FRAMEWORK_PATH: frameworkPath},
      checkUpdate: async input => {
        assert.equal(input.repository, 'zer0-lyz/appraisal-toolbox-releases');
        assert.equal(input.platform, 'darwin');
        assert.equal(input.architecture, 'arm64');
        return latest;
      },
      downloadAsset: async (_url, destination) => {
        fs.copyFileSync(zipPath, destination);
        return {size: assetSize, sha256: assetSha};
      },
      testInstallerEnvironment: verificationEnvironment,
      verificationEnvironment,
      onAccepted: receipt => receipts.push(receipt),
    });
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].accepted, true);
    assert.equal(receipts[0].verified, false);
    assert.equal(receipts[0].state, 'starting');
    assert.equal(result.state, 'complete', JSON.stringify(result));
    assert.equal(result.verified, true, JSON.stringify(result));
    assert.equal(result.latestVersion, version.productVersion);
    assert.equal(Number(result.latestBuildNumber), Number(version.buildNumber));
    const store = new MacUpdateTransactionStore({homeDir, installRoot, updatesRoot, pythonBin,
      lockEnvironment: {DYLD_FRAMEWORK_PATH: frameworkPath}});
    const persisted = await store.getStatus();
    assert.equal(persisted.state, 'complete');
    assert.equal(persisted.verified, true);
    assert.equal(persisted.nonce, nonce);
    for (const relative of preserved) assert.deepEqual(fs.readFileSync(path.join(installRoot, relative)), originalBytes.get(relative));
    process.stdout.write(JSON.stringify({
      ok: true, evidenceType: 'isolated-worker-with-real-package-and-installer',
      sourceCommit: provenance.sourceCommit, productVersion: version.productVersion,
      buildNumber: Number(version.buildNumber), buildId: provenance.buildId,
      packageSha256: assetSha, installerJournalPresent: fs.existsSync(path.join(updatesRoot, nonce, 'installer-transaction.json')),
      persistedVerifiedCompletion: true, chromeAndEdgeNativeHostVerified: true,
      syntheticUserDataBytePreserved: true, officialReleaseNetworkCovered: false,
      detachedHostLifetimeCoveredHere: false, browserGuiCovered: false,
    }) + '\n');
  } finally { fs.rmSync(zipPath, {force: true}); }
})().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });
