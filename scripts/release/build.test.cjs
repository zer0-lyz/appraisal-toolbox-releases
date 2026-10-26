'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {argumentsFor,refreshAdapterBuildResultArchive}=require('./build.cjs'),{verifyRuntime,installerBuild,hash}=require('./build-common.cjs');
const {resultFromManifest}=require('../../native-helper/update_checker.js');
const {buildRunnerDiagnostics,pythonExportFailure}=require('../../native-helper/diagnostics.js');
const {commandLaunchSpec}=require('../../native-helper/process_launcher.js');
test('build requires explicit identity and rejects unsafe/unknown parameters',()=>{
  assert.throws(()=>argumentsFor(['--target','windows-x64']),/Required/);
  assert.throws(()=>argumentsFor(['--target','macos-arm64','--version','0.2.1','--build-id','../../other','--build-number','2026101201','--output','out']),/Invalid/);
  const common=['--target','windows-x64','--version','0.2.3','--build-id','release-windows-x64-test','--build-number','2026101805','--output','out'];
  const candidate=argumentsFor(common);assert.equal(candidate.channel,'candidate');assert.equal(candidate['runtime-build-kind'],'local');
  const stable=argumentsFor([...common,'--channel','stable','--runtime-build-kind','release']);assert.equal(stable.channel,'stable');assert.equal(stable['runtime-build-kind'],'release');
  assert.throws(()=>argumentsFor([...common,'--channel','stable','--runtime-build-kind','local']),/Invalid release channel/);
  assert.throws(()=>argumentsFor([...common,'--channel','production']),/Invalid release channel/);
  assert.equal(installerBuild('windows-x64'),'windows-context-attested.8');assert.equal(installerBuild('macos-arm64'),'macos-transactional.4');
});
test('Windows package builder validates and extracts the hash-locked base ZIP without optional Archive module autoload',()=>{
  const builder=fs.readFileSync(path.join(__dirname,'../../windows/build-windows-fix2.cjs'),'utf8');
  assert.match(builder,/ZipFile\]::OpenRead\(\$archive\)/);
  assert.match(builder,/Invalid base archive path/);
  assert.match(builder,/ZipFile\]::ExtractToDirectory\(\$archive,\$destination\)/);
  assert.doesNotMatch(builder,/Expand-Archive/);
});
test('unified Windows repack refreshes the adapter build result archive digest',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'toolbox-build-result-test-'));
  const archive=path.join(directory,'candidate.zip');
  const resultPath=path.join(directory,'build-result.json');
  try{
    fs.writeFileSync(archive,'finalized archive bytes');
    fs.writeFileSync(resultPath,JSON.stringify({archive:'old.zip',archiveSha256:'0'.repeat(64)}));
    const result=refreshAdapterBuildResultArchive(directory,archive);
    assert.equal(result.archive,archive);
    assert.equal(result.archiveSha256,hash(archive));
    assert.equal(JSON.parse(fs.readFileSync(resultPath,'utf8')).archiveSha256,hash(archive));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('Windows command launcher safely defaults an omitted argument list',()=>{
  const spec=commandLaunchSpec('powershell.exe',undefined,{platform:'win32',env:{}});
  assert.equal(spec.mode,'direct');
  assert.deepEqual(spec.args,[]);
});
test('depreciation skill bundle includes the exact workbook template used by the extension',()=>{
  const sourceAssets=path.join(__dirname,'../../src/modules/depreciation-capex-forecast/assets');
  const skillAssets=path.join(__dirname,'../../skills/depreciation-capex-forecast/assets');
  const templateName='折旧摊销预测输入模板.xlsx';
  const source=path.join(sourceAssets,templateName);
  const bundled=path.join(skillAssets,templateName);
  assert.ok(fs.existsSync(source),'Extension workbook template must use the runtime filename');
  assert.ok(fs.existsSync(bundled),'Bundled depreciation skill workbook template must use the runtime filename');
  assert.deepEqual(fs.readFileSync(bundled),fs.readFileSync(source));
});
test('cache rejects changed or extra runtime bytes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toolbox-cache-test-'));fs.mkdirSync(path.join(dir,'runtime'));fs.writeFileSync(path.join(dir,'runtime','x'),'original');
  const {hash}=require('./build-common.cjs'),lock={runtimeFiles:[{path:'runtime/x',sha256:hash(path.join(dir,'runtime/x'))}]};
  try{verifyRuntime(dir,lock);fs.writeFileSync(path.join(dir,'runtime','x'),'mutated');assert.throws(()=>verifyRuntime(dir,lock),/SHA mismatch/);fs.writeFileSync(path.join(dir,'runtime','x'),'original');fs.writeFileSync(path.join(dir,'runtime','unexpected'),'extra');assert.throws(()=>verifyRuntime(dir,lock),/extra\/missing/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('Windows-only higher build in schema 2 does not prompt unchanged Mac',()=>{
  const url='https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/latest/download/update-manifest.json';
  const asset=target=>({fileName:`appraisal-toolbox-${target}.zip`,url:`https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.1/appraisal-toolbox-${target}.zip`,sha256:'a'.repeat(64)});
  const m={schemaVersion:2,repository:'zer0-lyz/appraisal-toolbox-releases',platforms:{'macos-arm64':{target:'macos-arm64',productVersion:'0.2.1',buildNumber:2026100901,asset:asset('macos-arm64')},'windows-x64':{target:'windows-x64',productVersion:'0.2.1',buildNumber:2026101201,asset:asset('windows-x64')}}};
  const input={currentVersion:'0.2.1',currentBuildNumber:2026100901};assert.equal(resultFromManifest(m,url,{...input,platform:'darwin',architecture:'arm64'}).updateAvailable,false);assert.equal(resultFromManifest(m,url,{...input,platform:'win32',architecture:'x64'}).updateAvailable,true);
  assert.throws(()=>resultFromManifest({...m,platforms:{}},url,{...input,platform:'darwin',architecture:'arm64'}),/PLATFORM_MANIFEST_INVALID/);
  const legacy={schemaVersion:1,productVersion:'0.2.1',buildNumber:2026101201,assets:{'macos-arm64':asset('macos-arm64')}};assert.equal(resultFromManifest(legacy,url,{...input,platform:'darwin',architecture:'arm64'}).updateAvailable,true);
});
test('diagnostics preserve bounded Chinese reasons without source/credentials',()=>{
  const d=buildRunnerDiagnostics(1,Array.from({length:40},(_,i)=>'失败 '+i+' token=synthetic-secret').join('\n'));assert.equal(d.exitCode,1);assert.equal(d.stderrTail.length,20);assert(!JSON.stringify(d).includes('synthetic-secret'));
  const e=pythonExportFailure({code:'ENOENT',message:'Command failed: python -c SECRET_SOURCE'},'EXPORT_FAILED');assert(!JSON.stringify(e).includes('SECRET_SOURCE'));assert.match(e.message,/Python 路径不可用/);
});
test('Windows archive creation is checksum-driven and verifies the exact ZIP inventory',()=>{
  const packager=fs.readFileSync(path.join(__dirname,'package-macos.py'),'utf8');
  const builder=fs.readFileSync(path.join(__dirname,'../../windows/build-windows-fix2.cjs'),'utf8');
  assert.match(packager,/SHA256SUMS is produced by the build inventory and is the authoritative list/);
  assert.match(packager,/long_path\(os\.path\.join\(root/);
  assert.match(packager,/verify_archive\(root, output, checksums\)/);
  assert.doesNotMatch(builder,/root\.rglob\("\*"\)/);
});
