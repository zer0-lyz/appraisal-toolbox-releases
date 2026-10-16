'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {argumentsFor}=require('./build.cjs'),{verifyRuntime,installerBuild}=require('./build-common.cjs');
const {resultFromManifest}=require('../../native-helper/update_checker.js');
const {buildRunnerDiagnostics,pythonExportFailure}=require('../../native-helper/diagnostics.js');
test('build requires explicit identity and rejects unsafe/unknown parameters',()=>{
  assert.throws(()=>argumentsFor(['--target','windows-x64']),/Required/);
  assert.throws(()=>argumentsFor(['--target','macos-arm64','--version','0.2.1','--build-id','../../other','--build-number','2026101201','--output','out']),/Invalid/);
  assert.equal(installerBuild('windows-x64'),'windows-context-attested.7');assert.equal(installerBuild('macos-arm64'),'macos-transactional.1');
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
