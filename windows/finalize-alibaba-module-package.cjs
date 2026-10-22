// Repackage the verified Alibaba-module candidate after source-only installer/module fixes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const [baseRootArg, baseArchiveArg, outputArg] = process.argv.slice(2);
if (!baseRootArg || !baseArchiveArg || !outputArg) {
  throw new Error('Arguments: verified package root, verified package ZIP, output directory');
}
const baseRoot = path.resolve(baseRootArg);
const baseArchive = path.resolve(baseArchiveArg);
const output = path.resolve(outputArg);
const source = path.resolve(__dirname, '..');
const buildId = 'windows-alibaba-lease-range-sold.12';
const installerBuild = 'windows-independent-readback.4';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
    .sort();
}
function copySourceTree(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    filter: item => !/(?:^|[\\/])(?:__pycache__|node_modules|\.git)(?:[\\/]|$)|\.py[co]$/.test(item),
  });
}
function removeUnlistedGeneratedPythonCaches(directory, packageRoot, listed) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeUnlistedGeneratedPythonCaches(target, packageRoot, listed);
      if (entry.name === '__pycache__' && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
    } else if (/\.py[co]$/.test(entry.name) && !listed.has(path.relative(packageRoot, target).replaceAll('\\', '/'))) {
      fs.rmSync(target, { force: true });
    }
  }
}

if (!fs.existsSync(baseRoot) || !fs.existsSync(baseArchive)) throw new Error('Verified base package or archive is missing');
if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
const sidecar = fs.readFileSync(baseArchive + '.sha256', 'utf8').trim().split(/\s+/)[0];
if (hash(baseArchive) !== sidecar) throw new Error('Base candidate ZIP no longer matches its SHA-256 sidecar');

const shaLines = fs.readFileSync(path.join(baseRoot, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
const listed = new Set();
for (const line of shaLines) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`Malformed base package SHA256SUMS line: ${line}`);
  const relative = match[2].replaceAll('/', path.sep);
  if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new Error(`Unsafe checksum path: ${match[2]}`);
  const file = path.join(baseRoot, relative);
  if (!fs.existsSync(file) || hash(file) !== match[1]) throw new Error(`Base package checksum mismatch: ${match[2]}`);
  if (listed.has(match[2])) throw new Error(`Duplicate package checksum path: ${match[2]}`);
  listed.add(match[2]);
}
const packageFiles = files(baseRoot);
const extraFiles = packageFiles.filter(file => {
  const relative = path.relative(baseRoot, file).replaceAll('\\', '/');
  return relative !== 'SHA256SUMS' && !listed.has(relative)
    && !/(?:^|\/)__pycache__(?:\/|$)|\.py[co]$/.test(relative);
});
if (extraFiles.length) throw new Error(`Base package contains unlisted files: ${extraFiles.slice(0, 5).join(', ')}`);

const outputName = 'appraisal-toolbox-v0.2.1-windows-x64';
const packageRoot = path.join(output, outputName);
fs.mkdirSync(output, { recursive: true });
fs.cpSync(baseRoot, packageRoot, { recursive: true, force: true });
removeUnlistedGeneratedPythonCaches(packageRoot, packageRoot, listed);
for (const name of fs.readdirSync(path.join(source, 'windows', 'installer'))) {
  fs.copyFileSync(path.join(source, 'windows', 'installer', name), path.join(packageRoot, name));
}
for (const relative of [
  'version.json',
  path.join('src', 'modules', 'alibaba-lease', 'module.js'),
  path.join('src', 'modules', 'alibaba-lease', 'template.js'),
]) {
  fs.copyFileSync(path.join(source, relative), path.join(packageRoot, 'extension', relative));
}
fs.writeFileSync(path.join(packageRoot, 'VERSION.txt'), `version=0.2.1\nbuild=${buildId}\n`, 'utf8');

const acceptanceNote = path.join(packageRoot, 'ALIBABA_MODULES_FIX_ACCEPTANCE.md');
fs.appendFileSync(acceptanceNote, '\n## Windows 安装回归补充（2026-10-10）\n\n- 修复复制包含方括号的 python-docx 模板文件时 PowerShell 通配符解释导致的暂存失败。\n- 完整隔离安装回归验证 `[Content_Types].xml` 安装后存在且 SHA-256 与包内一致。\n- 此构建只更新扩展模块和安装器脚本，复用已验证的 Native Helper；不代表真实阿里登录或网络抓取通过。\n', 'utf8');
fs.appendFileSync(acceptanceNote, '\n## 阿里资产租赁日期范围与成交金额修复（2026-10-10）\n\n- 根因一：租赁搜索页面没有可靠的服务端结束日期参数；原执行器把40条列表卡片全部送去读详情，最后才按详情结束日期过滤。现在列表日期只从“结束时间/截止时间”标签提取，明确超出所选范围的卡片在详情访问前跳过；列表无日期时才访问详情，并要求详情必须有结束时间。\n- 根因二：租赁详情显示“成交价 43,000 元/年”，解析器只认“拍下价/当前价”，因此金额为空、成交案例被拒。现在将明确的“成交价”作为首年租金成交额，并允许此标签满足详情页就绪条件。\n- 对应截图中的 2023-12-15 记录会因所选 2026-06-01 至 2026-10-09 范围被排除；其43,000元/年会被正确识别为成交金额，但不会进入2026结果。\n- 回归覆盖列表预筛、范围内案例端到端合成抓取、成交字段、未知日期拒收和旧日期排除；真实登录态页面及阿里实时抓取未覆盖。Native Helper 未变化/未重编。\n', 'utf8');

const sourceInventory = files(source)
  .filter(file => !file.includes(`${path.sep}.git${path.sep}`) && !/(?:__pycache__|\.py[co]$)/.test(file))
  .map(file => ({ path: path.relative(source, file).replaceAll('\\', '/'), sha256: hash(file) }));
const inventoryPath = path.join(output, 'source-inventory.json');
fs.writeFileSync(inventoryPath, JSON.stringify(sourceInventory, null, 2), 'utf8');

const provenancePath = path.join(packageRoot, 'BUILD-PROVENANCE.json');
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
const nativeExe = path.join(packageRoot, 'native-helper', 'native_host.exe');
if (hash(nativeExe) !== provenance.nativeExeSha256) throw new Error('Native Helper differs from previously verified build provenance');
provenance.buildId = buildId;
provenance.installerBuild = installerBuild;
provenance.nativeHelperRebuilt = false;
provenance.alibabaModulesPackageParentSha256 = sidecar;
provenance.sourceInventorySha256 = hash(inventoryPath);
provenance.installerFix = 'literal-path-recursive-copy-preserves-bracketed-filenames';
provenance.alibabaLeaseFix = 'prefilter-explicit-list-end-date-before-detail-navigation; parse-detail-成交价-as-sold-rent';
provenance.changedExtensionFiles = [...new Set([
  ...(Array.isArray(provenance.changedExtensionFiles) ? provenance.changedExtensionFiles : []),
  'version.json',
  'src/modules/alibaba-lease/template.js',
])].sort();
provenance.finalizedAtUtc = new Date().toISOString();
fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), 'utf8');

const python = path.join(packageRoot, 'runtime', 'python-portable', 'python.exe');
const env = {
  ...process.env,
  TIANYUAN_PRINT_SKILLS_DIR: path.join(packageRoot, 'skills'),
  TIANYUAN_DEPRECIATION_SKILL_DIR: path.join(packageRoot, 'skills', 'depreciation-capex-forecast'),
  TIANYUAN_NATIVE_RUNTIME_ROOT: path.join(packageRoot, 'native-helper'),
  TIANYUAN_PYTHON_BIN: python,
  PYTHONDONTWRITEBYTECODE: '1',
};
const selfTest = JSON.parse(execFileSync(nativeExe, ['--self-test'], {
  encoding: 'utf8', env, windowsHide: true, timeout: 120000,
}));
if (!selfTest.ok || !selfTest.pythonSkillImportSmoke?.ok) throw new Error('Native Helper self-test failed during package finalization');
fs.writeFileSync(path.join(output, 'native-self-test.json'), JSON.stringify(selfTest, null, 2), 'utf8');

const checksumText = files(packageRoot)
  .filter(file => path.relative(packageRoot, file) !== 'SHA256SUMS')
  .map(file => `${hash(file)}  ${path.relative(packageRoot, file).replaceAll('\\', '/')}`)
  .join('\n') + '\n';
fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS'), checksumText, 'utf8');

const archive = path.join(output, `${outputName}.zip`);
execFileSync(python, [path.join(source, 'scripts', 'release', 'package-macos.py'), 'zip', packageRoot, archive], { windowsHide: true });
const archiveSha256 = hash(archive);
fs.writeFileSync(archive + '.sha256', `${archiveSha256} *${path.basename(archive)}\n`, 'utf8');
const result = {
  ok: true,
  archive,
  archiveSha256,
  packageRoot,
  exe: nativeExe,
  provenance,
  selfTestPassed: true,
  nativeHelperRebuilt: false,
  packageFiles: files(packageRoot).length,
};
fs.writeFileSync(path.join(output, 'build-result.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
