const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const os = require('node:os');
const [packageArg, evidenceArg] = process.argv.slice(2);
const pkg = path.resolve(packageArg), evidence = path.resolve(evidenceArg);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (fs.existsSync(evidence)) throw new Error('Use a new evidence directory');
fs.mkdirSync(evidence, { recursive: true });
// Keep the transient install root short enough for legacy Windows MAX_PATH
// handling inside PowerShell/.NET. All durable logs and selected reports stay
// under evidence; the synthetic install tree is removed in finally.
const installRoot = path.join(os.tmpdir(), `atb-i-${process.pid}-${String(Date.now()).slice(-6)}`);
const registryRoot = 'HKCU:\\Software\\AppraisalToolbox\\InstallerFixture\\fix2-' + Date.now();
const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const q = s => "'" + s.replaceAll("'", "''") + "'";
function powershell(code) {
  return execFileSync(ps, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + code,'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
}
function install(name, extra = {}) {
  const result = spawnSync('cmd.exe', ['/d','/c', 'install.cmd'], {
    cwd: pkg, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 12*1024*1024,
    env: { ...process.env, APPRAISAL_TOOLBOX_INSTALLER_TEST_MODE:'1', APPRAISAL_TOOLBOX_INSTALL_ROOT:installRoot, APPRAISAL_TOOLBOX_INSTALLER_TEST_REGISTRY_ROOT:registryRoot, ...extra }
  });
  if (result.error) throw result.error;
  fs.writeFileSync(path.join(evidence,name+'.log'), result.stdout + '\n' + result.stderr);
  fs.writeFileSync(path.join(evidence,name+'-exit.json'), JSON.stringify({ exitCode:result.status, signal:result.signal }));
  const tempParent = path.dirname(installRoot), installLeaf = path.basename(installRoot);
  for (const file of fs.readdirSync(tempParent).filter(n => n.startsWith(installLeaf + '.installation-failure-'))) {
    const suffix = file.slice((installLeaf + '.installation-failure-').length);
    fs.copyFileSync(path.join(tempParent,file),path.join(evidence,'isolated-install.installation-failure-'+suffix));
  }
  return result;
}
function registryState() {
  const output = powershell(`$v=@();foreach($k in @(${q(registryRoot+'\\Chrome')},${q(registryRoot+'\\Edge')})){ $x=Get-Item -LiteralPath $k; $v+=@{path=$k;value=$x.GetValue('');kind=[string]$x.GetValueKind('')} };ConvertTo-Json -InputObject $v -Compress`);
  return JSON.parse(output.replace(/^\uFEFF/,''));
}
function report() { return fs.readFileSync(path.join(installRoot,'installation-report.txt'),'utf8'); }
function latestFailure() {
  const file = fs.readdirSync(evidence).filter(n=>n.startsWith('isolated-install.installation-failure-')).map(n=>path.join(evidence,n)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
const summary = { fixtureOnly:true, realBrowserRegistrationCovered:false, actualAppContainerCovered:false, registryRoot, installRoot, outcomes:{} };
try {
  assert.equal(install('success').status,0);
  assert(report().includes('status=success')); assert(report().includes('false-fixture-only'));
  const bracketedTemplate = path.join('runtime','python-portable','Lib','site-packages','docx','templates','default-docx-template','[Content_Types].xml');
  assert(fs.existsSync(path.join(pkg,bracketedTemplate)), 'Package must contain the python-docx template with square brackets');
  assert(fs.existsSync(path.join(installRoot,bracketedTemplate)), 'Installer must copy literal square-bracket filenames');
  assert.equal(sha256(path.join(installRoot,bracketedTemplate)), sha256(path.join(pkg,bracketedTemplate)), 'Bracketed template contents must be preserved');
  const registered = registryState(); assert(registered.every(x=>x.kind==='String' && fs.existsSync(x.value)));
  fs.writeFileSync(path.join(evidence,'success-report.txt'),report());
  fs.copyFileSync(path.join(installRoot,'registration-verification.json'),path.join(evidence,'success-dual-view-verification.json'));
  const dual=JSON.parse(fs.readFileSync(path.join(evidence,'success-dual-view-verification.json'),'utf8'));
  assert.equal(dual.registryResults.length,2);assert(dual.registryResults.every(k=>k.registryViews.length===2&&k.registryViews.every(v=>v.regExeExitCode===0)));

  fs.writeFileSync(path.join(evidence,'independent-registry-readback.json'),JSON.stringify(registered,null,2));
  const exe = path.join(installRoot,'native-helper','native_host.exe');
  const selfTest = JSON.parse(execFileSync(exe,['--self-test'],{encoding:'utf8',windowsHide:true,timeout:120000}));
  assert(selfTest.ok && selfTest.pythonSkillImportSmoke.ok);
  fs.writeFileSync(path.join(evidence,'installed-exe-self-test.json'),JSON.stringify(selfTest,null,2));
  summary.outcomes.success = { exitCode:0, independentReadback:true, manifestAndExecutableExist:true, fourSkillImports:true, squareBracketFilenamePreserved:true };
  const sentinel = path.join(installRoot,'projects','synthetic-fixture','sentinel.txt');
  fs.mkdirSync(path.dirname(sentinel),{recursive:true}); fs.writeFileSync(sentinel,'synthetic user data; preserve exactly');
  const priorReport = report();
  assert.equal(install('missing-edge',{APPRAISAL_TOOLBOX_INSTALLER_TEST_DELETE_BEFORE_VERIFY:registryRoot+'\\Edge'}).status,1);
  const failure = latestFailure();
  assert.equal(failure.status,'failed'); assert(failure.rollbackVerified);
  assert.equal(failure.registryResults.find(x=>x.browser==='edge').status,'failed');
  assert.deepEqual(registryState(),registered); assert.equal(report(),priorReport);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'synthetic user data; preserve exactly');
  summary.outcomes.missingEdge = { exitCode:1, failedKeyReported:true, rollbackVerified:true, priorReportAndSyntheticDataRestored:true };
  assert.equal(install('upgrade').status,0);
  const upgradeReport = report();
  fs.writeFileSync(path.join(evidence,'upgrade-report.txt'),upgradeReport);
  const backup = upgradeReport.split(/\r?\n/).find(x=>x.startsWith('previousInstallBackup=')).slice('previousInstallBackup='.length);
  assert(path.basename(backup).startsWith(path.basename(installRoot) + '.previous-'));
  assert.equal(fs.readFileSync(path.join(backup,'projects','synthetic-fixture','sentinel.txt'),'utf8'),'synthetic user data; preserve exactly');
  fs.writeFileSync(path.join(evidence,'upgrade-backup-sentinel.txt'),fs.readFileSync(path.join(backup,'projects','synthetic-fixture','sentinel.txt'),'utf8'),'utf8');
  summary.outcomes.upgrade = { exitCode:0, backupLeaf:path.basename(backup), syntheticDataRetainedInBackup:true };
  const beforeGuard = report();
  assert.equal(install('restricted-context-guard',{APPX_PACKAGE_FAMILY_NAME:'Synthetic.GuardFixture_NotActualAppContainer'}).status,1);
  assert.equal(report(),beforeGuard); assert.deepEqual(registryState(),registered);
  const guard = latestFailure(); assert(guard.error.includes('AppContainer/MSIX')); assert.equal(guard.registryResults.length,0);
  summary.outcomes.restrictedContextGuard = { exitCode:1, simulated:true, rejectedBeforeMutation:true };
  summary.ok=true;
} catch(error) { summary.ok=false; summary.error=error.stack; process.exitCode=1; }
finally {
  // Only the independently named fixture subtree is removed. Runtime evidence stays.
  powershell(`if(Test-Path -LiteralPath ${q(registryRoot)}){Remove-Item -LiteralPath ${q(registryRoot)} -Recurse -Force}`);
  summary.fixtureRegistryCleaned=true;
  const tempRoot = path.resolve(path.dirname(installRoot));
  const installLeaf = path.basename(installRoot);
  for (const name of fs.readdirSync(tempRoot)) {
    if (name !== installLeaf && !name.startsWith(installLeaf + '.previous-') && !name.startsWith(installLeaf + '.staging-') && !name.startsWith(installLeaf + '.installation-failure-')) continue;
    const target = path.resolve(tempRoot, name);
    if (path.dirname(target) !== tempRoot) throw new Error(`Refusing fixture cleanup outside temp root: ${target}`);
    fs.rmSync(target, { recursive:true, force:true });
  }
  summary.temporaryInstallArtifactsCleaned=true;
  fs.writeFileSync(path.join(evidence,'installer-regression-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
}
