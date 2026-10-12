// Reproducible Windows full package: verified release runtime + current source + rebuilt SEA.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [baseArchive, outputDirectory, toolsDirectory] = process.argv.slice(2).map(p => path.resolve(p));
if (!baseArchive || !outputDirectory || !toolsDirectory) throw new Error('Arguments: base ZIP, new output directory, tools directory');
const source = path.resolve(__dirname, '..');
const buildSuffix = process.argv[5];
if (!buildSuffix) throw new Error('Explicit build suffix required; use unified scripts/release/build.cjs');
const sourceState = require('../scripts/release/build-common.cjs').sourceState();
const productVersion = process.env.APPRAISAL_PRODUCT_VERSION || '0.2.1';
const installerBuild = require('../scripts/release/build-common.cjs').installerBuild('windows-x64');
if (!['fix2', 'fix3', 'fix4', 'inplace', 'layout', 'amap', 'mapui', 'round2'].includes(buildSuffix)) throw new Error('Unknown build suffix');
const buildId = process.env.APPRAISAL_BUILD_ID || (buildSuffix === 'round2' ? 'windows-e2e-round2.1' : buildSuffix === 'mapui' ? 'windows-map-ui.8' : buildSuffix === 'amap' ? 'windows-amap-only.7' : buildSuffix === 'layout' ? 'windows-responsive-map.6' : buildSuffix === 'inplace' ? 'windows-original-directory.5' : buildSuffix === 'fix4' ? 'windows-result-buttons.4' : buildSuffix === 'fix3' ? 'windows-current-browser.3' : 'windows-seven-fixes.2');
const reuseBuildResult = process.argv[6] ? path.resolve(process.argv[6]) : '';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expectedBaseHash = 'a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28';
if (hash(baseArchive) !== expectedBaseHash) throw new Error('Original release SHA-256 mismatch');
if (fs.existsSync(outputDirectory)) throw new Error('Use a new output directory');
fs.mkdirSync(outputDirectory, { recursive: true });
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const psQuote = text => "'" + text.replace(/'/g, "''") + "'";
function powerShell(code) { return execFileSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';" + code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }); }
const extraction = path.join(outputDirectory, 'verified-base');
powerShell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(baseArchive)} -DestinationPath ${psQuote(extraction)}`);
const original = path.join(extraction, 'appraisal-toolbox-v0.2.1-windows-x64');
require('../scripts/release/build-common.cjs').verifyRuntime(original, require('../release-inputs.lock.json').targets['windows-x64']);
const basePackageFiles = new Set(fs.readFileSync(path.join(original, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).map(line => {
  const match = line.match(/^[a-f0-9]{64}  (.+)$/);
  if (!match) throw new Error(`Malformed verified base checksum: ${line}`);
  return match[1].replaceAll('\\', '/');
}));
const packageName = `appraisal-toolbox-v${productVersion}-windows-x64-${buildId}`;
const packageRoot = path.join(outputDirectory, packageName);
fs.cpSync(original, packageRoot, { recursive: true });
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]).sort();
}
function copySourceTree(from, to) {
  fs.cpSync(from, to, { recursive: true, force: true, filter: item => !/(?:^|[\\/])(?:__pycache__|node_modules|\.git)(?:[\\/]|$)|\.py[co]$/.test(item) });
}
// Discard old extension/skills/native code directories only in the freshly created build package.
for (const directory of ['extension', 'native-helper', 'skills']) {
  const target = path.resolve(packageRoot, directory);
  if (!target.startsWith(packageRoot + path.sep)) throw new Error('Unsafe build target');
  fs.rmSync(target, { recursive: true, force: true });
}
fs.mkdirSync(path.join(packageRoot, 'extension'), { recursive: true });
for (const name of ['manifest.json', 'version.json', 'runtime-compat.json', 'README.md', 'LICENSE']) fs.copyFileSync(path.join(source, name), path.join(packageRoot, 'extension', name));
copySourceTree(path.join(source, 'src'), path.join(packageRoot, 'extension', 'src'));
copySourceTree(path.join(source, 'native-helper'), path.join(packageRoot, 'native-helper'));
copySourceTree(path.join(source, 'skills'), path.join(packageRoot, 'skills'));
for (const file of fs.readdirSync(path.join(source, 'windows', 'installer'))) fs.copyFileSync(path.join(source, 'windows', 'installer', file), path.join(packageRoot, file));
const nativeRoot = path.join(packageRoot, 'native-helper');
const exe = path.join(nativeRoot, 'native_host.exe');
require('../scripts/release/verify-tools.cjs').verifyTools(toolsDirectory, require('../release-inputs.lock.json').targets['windows-x64']);
const esbuild = require(path.join(toolsDirectory, 'node_modules', 'esbuild'));
const postject = require(path.join(toolsDirectory, 'node_modules', 'postject'));
const bundle = path.join(outputDirectory, 'native-host-bundle.cjs');
const meta = path.join(outputDirectory, 'native-host-bundle.meta.json');
async function build() {
  const result = await esbuild.build({ entryPoints: [path.join(source, 'native-helper', 'native_host.js')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', metafile: true, charset: 'utf8', logLevel: 'warning' });
  fs.writeFileSync(meta, JSON.stringify(result.metafile, null, 2));
  const external = Object.values(result.metafile.outputs).flatMap(value => value.imports).filter(value => value.external);
  if (external.some(value => value.path.startsWith('.'))) throw new Error('Unbundled relative native dependency');
  let reuse = null;
  if (reuseBuildResult) {
    reuse = JSON.parse(fs.readFileSync(reuseBuildResult, 'utf8'));
    if (hash(reuse.archive) !== reuse.archiveSha256 || hash(reuse.exe) !== reuse.provenance.nativeExeSha256 || hash(bundle) !== reuse.provenance.nativeBundleSha256) throw new Error('Native executable reuse requires matching bundle and verified prior package');
    const prior=JSON.parse(fs.readFileSync(path.join(path.dirname(reuseBuildResult),'source-inventory.json'),'utf8'));
    const current=files(path.join(source,'native-helper')).concat(files(path.join(source,'skills'))).filter(f=>!/(?:__pycache__|\.py[co]$)/.test(f)).map(f=>({path:path.relative(source,f).replaceAll('\\','/'),sha256:hash(f)}));
    for(const item of current)if(prior.find(x=>x.path===item.path)?.sha256!==item.sha256)throw new Error('Native/skills source changed; full rebuild required');
    const priorPayload=prior.filter(x=>x.path.startsWith('native-helper/')||x.path.startsWith('skills/'));
    if(priorPayload.length!==current.length)throw new Error('Native/skills files removed; full rebuild required');
    fs.copyFileSync(reuse.exe, exe);
  } else {
  const blob = path.join(outputDirectory, 'sea-prep.blob');
  const seaConfig = path.join(outputDirectory, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit', windowsHide: true });
  // Clear Authenticode security-directory metadata in the newly copied build executable.
  let node = fs.readFileSync(process.execPath);
  const pe = node.readUInt32LE(0x3c), optional = pe + 24;
  const magic = node.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Unsupported PE header');
  const security = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
  const certOffset = node.readUInt32LE(security), certSize = node.readUInt32LE(security + 4);
  node.writeUInt32LE(0, security); node.writeUInt32LE(0, security + 4);
  if (certOffset > 0 && certOffset + certSize === node.length) node = node.subarray(0, certOffset);
  fs.writeFileSync(exe, node);
  await postject.inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  }
  const env = { ...process.env, TIANYUAN_PYTHON_BIN: path.join(packageRoot, 'runtime', 'python-portable', 'python.exe'), TIANYUAN_PRINT_SKILLS_DIR: path.join(packageRoot, 'skills'), TIANYUAN_DEPRECIATION_SKILL_DIR: path.join(packageRoot, 'skills', 'depreciation-capex-forecast'), TIANYUAN_NATIVE_RUNTIME_ROOT: nativeRoot };
  const selfTest = JSON.parse(execFileSync(exe, ['--self-test'], { encoding: 'utf8', env, windowsHide: true, timeout: 120000 }));
  fs.writeFileSync(path.join(outputDirectory, 'compiled-self-test.json'), JSON.stringify(selfTest, null, 2));
  if (!selfTest.ok || !selfTest.pythonSkillImportSmoke?.ok) throw new Error('New executable import self-test failed');
  // Imports may create cache files. Remove only generated skill caches inside the new build root.
  function removeGeneratedPythonCaches(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.resolve(dir, entry.name);
      if (!target.startsWith(packageRoot + path.sep)) throw new Error('Unsafe cache target');
      if (entry.isDirectory()) {
        removeGeneratedPythonCaches(target);
        if (entry.name === '__pycache__' && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
      } else if (/\.py[co]$/.test(entry.name)) {
        const relative = path.relative(packageRoot, target).replaceAll('\\', '/');
        if (!relative.startsWith('runtime/') || !basePackageFiles.has(relative)) fs.rmSync(target);
      }
    }
  }
  removeGeneratedPythonCaches(packageRoot);
  const sourceInventory = execFileSync('git', ['-C', source, 'ls-files', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean).map(file => ({path:file,sha256:hash(path.join(source,file))}));
  fs.writeFileSync(path.join(outputDirectory, 'source-inventory.json'), JSON.stringify(sourceInventory, null, 2));
  const provenance = { schemaVersion: 2, productVersion, buildId, installerBuild, baseArchiveSha256: expectedBaseHash, nativeHelperRebuilt: true, extensionChanged: true, portablePythonRebuilt: false, sourceRecovery: 'Official hash-verified release native/skills; see RECOVERED_SOURCE_PROVENANCE.md', sourceGitHead: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(), sourceHasUncommittedFixes: sourceState.dirty, sourceInventorySha256: hash(path.join(outputDirectory, 'source-inventory.json')), nodeVersion: process.version, nodeRuntimeSha256: hash(process.execPath), esbuildVersion: esbuild.version, postjectVersion: '1.0.0-alpha.6', nativeBundleSha256: hash(bundle), nativeExeSha256: hash(exe), nativeExecutableSigning: 'unsigned SEA rebuild; copied Node Authenticode metadata removed', builtAtUtc: new Date().toISOString() };
  if (reuse) { provenance.nativeHelperRebuilt = false; provenance.nativeExeReuseBuild = reuse.provenance.buildId; provenance.nativeBundleMatchVerified = true; }
  fs.writeFileSync(path.join(packageRoot, 'BUILD-PROVENANCE.json'), JSON.stringify(provenance, null, 2));
  fs.copyFileSync(path.join(source, 'RECOVERED_SOURCE_PROVENANCE.md'), path.join(packageRoot, 'RECOVERED_SOURCE_PROVENANCE.md'));
  fs.writeFileSync(path.join(packageRoot, 'VERSION.txt'), `version=${productVersion}\nbuild=${buildId}\n`);
  const checksumText = files(packageRoot).filter(file => path.relative(packageRoot, file) !== 'SHA256SUMS').map(file => `${hash(file)}  ${path.relative(packageRoot, file).replaceAll('\\', '/')}`).join('\n') + '\n';
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS'), checksumText);
  const archive = path.join(outputDirectory, packageName + '.zip');
  const zipCode = 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:\n for file in sorted(root.rglob("*")):\n  if file.is_file(): archive.write(file,root.name+"/"+file.relative_to(root).as_posix())';
  execFileSync(env.TIANYUAN_PYTHON_BIN, ['-c', zipCode, packageRoot, archive], { stdio: 'inherit', windowsHide: true });
  const archiveHash = hash(archive);
  fs.writeFileSync(archive + '.sha256', `${archiveHash} *${path.basename(archive)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'build-result.json'), JSON.stringify({ archive, archiveSha256: archiveHash, packageRoot, exe, provenance, selfTestPassed: true }, null, 2));
  console.log(JSON.stringify({ archive, archiveSha256: archiveHash, exe, selfTestPassed: true }, null, 2));
}
build().catch(error => { console.error(error.stack); process.exitCode = 1; });
