const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const [packageArg, archiveArg, evidenceArg] = process.argv.slice(2);
const packageRoot = path.resolve(packageArg);
const archive = path.resolve(archiveArg);
const evidence = path.resolve(evidenceArg);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
}).sort();
if (fs.existsSync(evidence)) throw new Error('Use a new evidence directory');
fs.mkdirSync(evidence, { recursive: true });

const checksumPath = path.join(packageRoot, 'SHA256SUMS');
const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split(/\r?\n/);
const checked = [];
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  assert(match, `Malformed SHA256SUMS entry: ${line}`);
  const target = path.resolve(packageRoot, match[2]);
  assert(target.startsWith(packageRoot + path.sep), `Checksum path escapes package root: ${match[2]}`);
  assert.equal(sha256(target), match[1], `Checksum mismatch: ${match[2]}`);
  checked.push(match[2]);
}
assert.equal(checked.length, walk(packageRoot).length - 1, 'Every package file except SHA256SUMS must be listed exactly once');

const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extension', 'manifest.json'), 'utf8'));
const keyBytes = Buffer.from(manifest.key, 'base64');
const extensionId = crypto.createHash('sha256').update(keyBytes).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
assert.equal(extensionId, 'aamfmhcbjgofhmannejoiilkkpchfkgm');
assert.equal(manifest.version, '0.2.1');
assert.equal(manifest.name, '评估工具箱');
const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'BUILD-PROVENANCE.json'), 'utf8'));
assert.equal(provenance.productVersion, '0.2.1');
assert.equal(provenance.nativeHelperRebuilt, false);
assert.equal(sha256(archive), fs.readFileSync(archive + '.sha256', 'utf8').trim().split(/\s+/)[0]);

const python = path.join(packageRoot, 'runtime', 'python-portable', 'python.exe');
const archiveCheck = JSON.parse(execFileSync(python, [
  '-X', 'utf8', '-c',
  'import json,sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;names=z.namelist();assert names and all(n.startswith("appraisal-toolbox-v0.2.1-windows-x64/") for n in names);print(json.dumps({"ok":True,"entries":len(names)},ensure_ascii=False));z.close()',
  archive,
], { encoding: 'utf8', windowsHide: true }));

const summary = {
  ok: true,
  packageRoot,
  archive,
  archiveSha256: sha256(archive),
  archiveIntegrity: archiveCheck,
  packageFiles: walk(packageRoot).length,
  sha256Entries: checked.length,
  extensionId,
  productVersion: manifest.version,
  displayName: manifest.name,
  nativeHelperRebuilt: false,
};
fs.writeFileSync(path.join(evidence, 'package-verification.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
