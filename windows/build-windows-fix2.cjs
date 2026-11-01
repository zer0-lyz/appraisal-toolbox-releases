// Reproducible Windows full package: verified release runtime + current source + rebuilt SEA.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
function httpsGet(url, redirect) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'appraisal-toolbox-build' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && !redirect) {
        response.resume();
        resolve(httpsGet(response.headers.location, true));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTPS ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(new Error('download timeout')));
  });
}
async function httpsGetJson(url, resolve, reject) {
  try { resolve(JSON.parse((await httpsGet(url)).toString('utf8'))); } catch (error) { reject(error); }
}
async function httpsGetBinary(url, resolve, reject) {
  try { resolve(await httpsGet(url)); } catch (error) { reject(error); }
}
const [baseArchive, outputDirectory, toolsDirectory] = process.argv.slice(2).map(p => path.resolve(p));
if (!baseArchive || !outputDirectory || !toolsDirectory) throw new Error('Arguments: base ZIP, new output directory, tools directory');
const source = path.resolve(__dirname, '..');
const installerBuild = fs.readFileSync(path.join(source, 'windows', 'installer', 'install.ps1'), 'utf8').match(/\$InstallerBuild = "([^"]+)"/)?.[1];
if (!installerBuild) throw new Error('Installer build metadata is missing');
const buildSuffix = process.argv[5] || 'fix2';
if (!['fix2', 'fix3', 'fix4', 'inplace', 'layout', 'amap', 'mapui', 'round2', 'mapsync', 'workbooks', 'mapcamera', 'autoupd', 'alibafix'].includes(buildSuffix)) throw new Error('Unknown build suffix');
const buildId = buildSuffix === 'alibafix' ? 'windows-alibaba-scrape-fixes.1' : buildSuffix === 'autoupd' ? 'windows-auto-update.16' : buildSuffix === 'mapcamera' ? 'windows-amap-single-camera.14' : buildSuffix === 'workbooks' ? 'windows-workbook-development.13' : buildSuffix === 'mapsync' ? 'windows-amap-shared-pane.12' : buildSuffix === 'round2' ? 'windows-e2e-round2.1' : buildSuffix === 'mapui' ? 'windows-map-ui.8' : buildSuffix === 'amap' ? 'windows-amap-only.7' : buildSuffix === 'layout' ? 'windows-responsive-map.6' : buildSuffix === 'inplace' ? 'windows-original-directory.5' : buildSuffix === 'fix4' ? 'windows-result-buttons.4' : buildSuffix === 'fix3' ? 'windows-current-browser.3' : 'windows-seven-fixes.2';
const reuseBuildResult = process.argv[6] ? path.resolve(process.argv[6]) : '';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expectedBaseHash = 'a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28';
if (hash(baseArchive) !== expectedBaseHash) throw new Error('Original release SHA-256 mismatch');
if (fs.existsSync(outputDirectory)) throw new Error('Use a new output directory');
fs.mkdirSync(outputDirectory, { recursive: true });
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const psQuote = text => "'" + text.replace(/'/g, "''") + "'";
function powerShell(code) { return execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';" + code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }); }
const extraction = path.join(outputDirectory, 'verified-base');
powerShell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(baseArchive)} -DestinationPath ${psQuote(extraction)}`);
const original = path.join(extraction, 'appraisal-toolbox-v0.2.1-windows-x64');
const basePackageFiles = new Set(fs.readFileSync(path.join(original, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).map(line => {
  const match = line.match(/^[a-f0-9]{64}  (.+)$/);
  if (!match) throw new Error(`Malformed verified base checksum: ${line}`);
  return match[1].replaceAll('\\', '/');
}));
const packageName = ['inplace', 'layout', 'amap', 'round2', 'mapsync', 'workbooks', 'mapcamera', 'autoupd'].includes(buildSuffix) ? 'appraisal-toolbox-v0.2.1-windows-x64' : `appraisal-toolbox-v0.2.1-windows-x64-${buildSuffix}`;
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
  // D-E2 fix: the portable runtime must carry pywin32 (pythoncom/win32com) so
  // COM-based native editing — PPI draft write-back and class-life formula
  // workbooks — works on user machines. Wheel is resolved from PYWIN32_WHEEL,
  // <toolsDirectory>/vendor/pywin32/, or PyPI (pinned version) in that order,
  // then unpacked into the staged site-packages and import-verified.
  const pythonBin = path.join(packageRoot, 'runtime', 'python-portable', 'python.exe');
  const sitePackages = path.join(packageRoot, 'runtime', 'python-portable', 'Lib', 'site-packages');
  function pythonImportOk(code) {
    try { execFileSync(pythonBin, ['-c', code], { stdio: 'ignore', windowsHide: true, timeout: 60000 }); return true; } catch { return false; }
  }
  async function resolvePywin32Wheel() {
    const fromEnv = process.env.PYWIN32_WHEEL;
    if (fromEnv) {
      if (!fs.existsSync(fromEnv)) throw new Error('PYWIN32_WHEEL points to a missing file');
      return { wheel: fromEnv, source: 'env' };
    }
    const vendorDir = path.join(toolsDirectory, 'vendor', 'pywin32');
    if (fs.existsSync(vendorDir)) {
      const found = fs.readdirSync(vendorDir).filter(name => /^pywin32-\d+(?:\.\d+)*-cp\d{2,3}-cp\d{2,3}-win_amd64\.whl$/i.test(name)).sort().pop();
      if (found) return { wheel: path.join(vendorDir, found), source: 'tools-vendor' };
    }
    const cpTag = execFileSync(pythonBin, ['-c', 'import sys; print(f"cp{sys.version_info.major}{sys.version_info.minor}")'], { encoding: 'utf8', windowsHide: true }).trim();
    const pinnedVersion = '312';
    const index = JSON.parse(await new Promise((resolve, reject) => {
      httpsGetJson('https://pypi.org/pypi/pywin32/json', resolve, reject);
    }));
    const release = index.releases[pinnedVersion] || [];
    const candidate = release.find(file => file.filename === `pywin32-${pinnedVersion}-${cpTag}-${cpTag}-win_amd64.whl`);
    if (!candidate) throw new Error(`No pywin32 ${pinnedVersion} wheel for ${cpTag} on PyPI`);
    const body = await new Promise((resolve, reject) => {
      httpsGetBinary(candidate.url, resolve, reject);
    });
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    if (digest !== candidate.digests.sha256) throw new Error('pywin32 wheel SHA-256 mismatch');
    const vendored = path.join(outputDirectory, 'vendor', candidate.filename);
    fs.mkdirSync(path.dirname(vendored), { recursive: true });
    fs.writeFileSync(vendored, body);
    return { wheel: vendored, source: 'pypi', sha256: digest };
  }
  let pywin32WheelUsed = '';
  let pywin32WheelSource = 'preinstalled';
  if (!pythonImportOk('import pythoncom, win32com.client')) {
    const resolved = await resolvePywin32Wheel();
    const zipCopy = path.join(outputDirectory, 'pywin32-wheel.zip');
    fs.copyFileSync(resolved.wheel, zipCopy);
    powerShell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(zipCopy)} -DestinationPath ${psQuote(sitePackages)} -Force`);
    fs.rmSync(zipCopy, { force: true });
    pywin32WheelUsed = resolved.wheel;
    pywin32WheelSource = resolved.source;
  }
  if (!pythonImportOk('import pythoncom, win32com.client')) throw new Error('pywin32 import verification failed inside the packaged runtime');
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
  const sourceInventory = files(source).filter(file => !file.includes(path.sep + '.git' + path.sep) && !/(__pycache__|\.py[co]$)/.test(file)).map(file => ({ path: path.relative(source, file).replaceAll('\\', '/'), sha256: hash(file) }));
  fs.writeFileSync(path.join(outputDirectory, 'source-inventory.json'), JSON.stringify(sourceInventory, null, 2));
  const provenance = { schemaVersion: 2, productVersion: '0.2.1', buildId, installerBuild, baseArchiveSha256: expectedBaseHash, nativeHelperRebuilt: true, extensionChanged: true, portablePythonRebuilt: false, pywin32Vendor: pywin32WheelUsed ? path.basename(pywin32WheelUsed) : 'preinstalled', pywin32WheelSource, pywin32WheelSha256: pywin32WheelUsed ? hash(pywin32WheelUsed) : '', sourceRecovery: 'Official hash-verified release native/skills; see RECOVERED_SOURCE_PROVENANCE.md', sourceGitHead: (() => { try { return execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } })(), sourceHasUncommittedFixes: true, sourceInventorySha256: hash(path.join(outputDirectory, 'source-inventory.json')), nodeVersion: process.version, nodeRuntimeSha256: hash(process.execPath), esbuildVersion: esbuild.version, postjectVersion: '1.0.0-alpha.6', nativeBundleSha256: hash(bundle), nativeExeSha256: hash(exe), nativeExecutableSigning: 'unsigned SEA rebuild; copied Node Authenticode metadata removed', builtAtUtc: new Date().toISOString() };
  if (reuse) { provenance.nativeHelperRebuilt = false; provenance.nativeExeReuseBuild = reuse.provenance.buildId; provenance.nativeBundleMatchVerified = true; }
  fs.writeFileSync(path.join(packageRoot, 'BUILD-PROVENANCE.json'), JSON.stringify(provenance, null, 2));
  fs.copyFileSync(path.join(source, 'RECOVERED_SOURCE_PROVENANCE.md'), path.join(packageRoot, 'RECOVERED_SOURCE_PROVENANCE.md'));
  fs.writeFileSync(path.join(packageRoot, 'VERSION.txt'), `version=0.2.1\nbuild=${buildId}\n`);
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
