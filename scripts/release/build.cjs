#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {root,hash,sourceState,inventory,verifyRuntime,copyTracked,installerBuild}=require('./build-common.cjs');
function argumentsFor(argv) {
  const result={};
  for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Use --name value pairs');const key=argv[i].slice(2);if(result[key])throw Error('Duplicate argument: '+key);result[key]=argv[i+1];}
  const accepted=['target','version','build-id','build-number','output','base-archive','cache','tools','reuse-native','python'];
  for(const key of Object.keys(result))if(!accepted.includes(key))throw Error('Unknown argument: '+key);
  for(const key of ['target','version','build-id','build-number','output'])if(!result[key])throw Error('Required: --'+key);
  if(!['macos-arm64','windows-x64'].includes(result.target)||!/^\d+\.\d+\.\d+$/.test(result.version)||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(result['build-id'])||!/^\d{10}$/.test(result['build-number']))throw Error('Invalid target/version/buildId/buildNumber');
  return result;
}
async function build(o) {
  // Every target must carry and recheck the inherited Windows fixes.
  execFileSync(process.execPath,[path.join(root,'scripts/release/source-checks.cjs')],{stdio:'inherit'});
  const state=sourceState(),lockfile=path.join(root,'release-inputs.lock.json'),lock=JSON.parse(fs.readFileSync(lockfile)),targetLock=lock.targets[o.target];
  const expectedPlatform=o.target==='macos-arm64'?'darwin':'win32',expectedArch=o.target==='macos-arm64'?'arm64':'x64';
  if(process.platform!==expectedPlatform||process.arch!==expectedArch)throw Error('Build on the actual target OS/architecture');
  const out=path.resolve(o.output),cache=path.resolve(o.cache||path.join(require('node:os').tmpdir(),'appraisal-toolbox-build-cache'));
  if(out===root||out.startsWith(root+path.sep)||cache===root||cache.startsWith(root+path.sep))throw Error('Output/cache must be outside source checkout');
  if(fs.existsSync(out))throw Error('Output must be new');
  fs.mkdirSync(cache,{recursive:true});
  const base=o['base-archive']?path.resolve(o['base-archive']):path.join(cache,'assets',targetLock.baseAsset.sha256+'.zip');
  if(!fs.existsSync(base)){fs.mkdirSync(path.dirname(base),{recursive:true});const resp=await fetch(targetLock.baseAsset.url);if(!resp.ok)throw Error('Runtime download failed: '+resp.status);const tmp=base+'.partial-'+process.pid;fs.writeFileSync(tmp,Buffer.from(await resp.arrayBuffer()));if(hash(tmp)!==targetLock.baseAsset.sha256){fs.unlinkSync(tmp);throw Error('Downloaded runtime SHA mismatch');}fs.renameSync(tmp,base);}
  if(hash(base)!==targetLock.baseAsset.sha256)throw Error('Base ZIP SHA mismatch');
  fs.mkdirSync(out,{recursive:true});
  const tracked=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const sourceInventory=tracked.map(file=>({path:file,sha256:hash(path.join(root,file))}));
  const sourceInventoryFile=path.join(out,'source-inventory.json');fs.writeFileSync(sourceInventoryFile,JSON.stringify(sourceInventory,null,2)+'\n');
  let packageRoot,archive,native,cacheHit=false;
  if(o.target==='macos-arm64') {
    const python=o.python||'/usr/bin/python3';
    const pyVersion=execFileSync(python,['--version'],{encoding:'utf8'}).trim();
    const runtimeCache=path.join(cache,'runtime',o.target,hash(lockfile)+'-'+targetLock.baseAsset.sha256);
    if(fs.existsSync(runtimeCache)){verifyRuntime(runtimeCache,targetLock);cacheHit=true;}else{
      const tmp=runtimeCache+'.partial-'+process.pid;fs.mkdirSync(tmp,{recursive:true});
      execFileSync(python,[path.join(root,'scripts/release/package-macos.py'),'runtime',base,tmp,lockfile],{stdio:'inherit'});verifyRuntime(tmp,targetLock);fs.mkdirSync(path.dirname(runtimeCache),{recursive:true});fs.renameSync(tmp,runtimeCache);
    }
    packageRoot=path.join(out,`appraisal-toolbox-v${o.version}-${o.target}-${o['build-id']}`);fs.mkdirSync(packageRoot);
    fs.cpSync(path.join(runtimeCache,'runtime'),path.join(packageRoot,'runtime'),{recursive:true});
    copyTracked('src',path.join(packageRoot,'extension/src'),tracked);
    for(const file of ['manifest.json','version.json','runtime-compat.json','README.md','LICENSE']){fs.mkdirSync(path.join(packageRoot,'extension'),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(packageRoot,'extension',file));}
    copyTracked('native-helper',path.join(packageRoot,'native-helper'),tracked);copyTracked('skills',path.join(packageRoot,'skills'),tracked);
    const files={'install.sh':'安装.command','uninstall.sh':'卸载.command'};
    for(const [from,to]of Object.entries(files)){fs.copyFileSync(path.join(root,'macos/installer',from),path.join(packageRoot,to));fs.chmodSync(path.join(packageRoot,to),0o755);}
    fs.copyFileSync(path.join(root,'macos/installer/HISTORIC_INSTALL_README.md'),path.join(packageRoot,'安装说明.md'));
    const provenance={schemaVersion:3,target:o.target,productVersion:o.version,buildId:o['build-id'],buildNumber:Number(o['build-number']),sourceCommit:state.commit,sourceDirty:false,installerBuild:installerBuild(o.target),lockSha256:hash(lockfile),sourceInventorySha256:hash(sourceInventoryFile),baseAssetSha256:hash(base),node:targetLock.node,python:targetLock.python,buildTools:{node:process.version,python:pyVersion,pythonExecutableSha256:hash(fs.realpathSync(python)),macos:execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim()},signing:{package:'unsigned candidate; no notarization',native:'source executed with byte-identical vendor Node; product launcher unsigned'}};
    fs.writeFileSync(path.join(packageRoot,'BUILD-PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
    native={path:'native-helper/native_host.js',sha256:hash(path.join(packageRoot,'native-helper/native_host.js')),signing:provenance.signing.native};
    archive=path.join(out,path.basename(packageRoot)+'.zip');
  } else {
    if(process.version!==targetLock.node.version||hash(process.execPath)!==targetLock.node.sha256)throw Error('Windows build Node version/SHA mismatch');
    if(!o.tools)throw Error('Windows requires --tools from bootstrap-build-tools.ps1');
    // The legacy implementation remains the target adapter, with explicit metadata and audited reuse.
    const adapterOut=path.join(out,'adapter');
    const env={...process.env,APPRAISAL_BUILD_ID:o['build-id'],APPRAISAL_PRODUCT_VERSION:o.version,APPRAISAL_BUILD_NUMBER:o['build-number']};
    execFileSync(process.execPath,[path.join(root,'windows/build-windows-fix2.cjs'),base,adapterOut,path.resolve(o.tools),'round2',...(o['reuse-native']?[path.resolve(o['reuse-native'])]:[])],{stdio:'inherit',env});
    const result=JSON.parse(fs.readFileSync(path.join(adapterOut,'build-result.json')));packageRoot=result.packageRoot;archive=result.archive;
    native={path:'native-helper/native_host.exe',sha256:hash(result.exe),signing:result.provenance.nativeExecutableSigning};
  }
  const extensionVersion=JSON.parse(fs.readFileSync(path.join(packageRoot,'extension/version.json')));extensionVersion.productVersion=o.version;extensionVersion.chromeVersion=o.version;extensionVersion.versionName=o.version;extensionVersion.buildNumber=Number(o['build-number']);extensionVersion.platformBuildId=o['build-id'];extensionVersion.channel='candidate';
  fs.writeFileSync(path.join(packageRoot,'extension/version.json'),JSON.stringify(extensionVersion,null,2)+'\n');
  // A candidate must not carry the historical release's runtime fingerprint.
  const contract=JSON.parse(fs.readFileSync(path.join(packageRoot,'extension/runtime-compat.json')));
  Object.assign(contract,{extensionVersion:o.version,buildId:o['build-id'],runtimeBuildKind:'local',runtimeBuildId:require('node:crypto').createHash('sha256').update(JSON.stringify(sourceInventory.filter(x=>/^(?:src|native-helper|skills)\//.test(x.path)))).digest('hex'),generatedAt:new Date().toISOString()});
  fs.writeFileSync(path.join(packageRoot,'extension/runtime-compat.json'),JSON.stringify(contract,null,2)+'\n');
  const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'extension/manifest.json')));manifest.version=o.version;manifest.version_name=o.version;fs.writeFileSync(path.join(packageRoot,'extension/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const builtProvenance=JSON.parse(fs.readFileSync(path.join(packageRoot,'BUILD-PROVENANCE.json')));
  Object.assign(builtProvenance,{target:o.target,sourceCommit:state.commit,sourceDirty:false,productVersion:o.version,buildId:o['build-id'],buildNumber:Number(o['build-number']),lockSha256:hash(lockfile),installerBuild:installerBuild(o.target)});
  fs.writeFileSync(path.join(packageRoot,'BUILD-PROVENANCE.json'),JSON.stringify(builtProvenance,null,2)+'\n');
  fs.copyFileSync(lockfile,path.join(packageRoot,'release-inputs.lock.json'));fs.copyFileSync(sourceInventoryFile,path.join(packageRoot,'SOURCE-INVENTORY.json'));
  fs.writeFileSync(path.join(packageRoot,'VERSION.txt'),`version=${o.version}\nbuild=${o['build-id']}\ninstallerBuild=${installerBuild(o.target)}\n`);
  const checksums=inventory(packageRoot).filter(x=>path.basename(x.path)!=='SHA256SUMS').map(x=>`${x.sha256}  ${path.relative(packageRoot,x.path).replaceAll('\\','/')}`).join('\n')+'\n';fs.writeFileSync(path.join(packageRoot,'SHA256SUMS'),checksums);
  const zipPython=o.target==='macos-arm64'?(o.python||'/usr/bin/python3'):path.join(packageRoot,'runtime/python-portable/python.exe');
  // Repack after target-independent version/lock/provenance changes.
  execFileSync(zipPython,[path.join(root,'scripts/release/package-macos.py'),'zip',packageRoot,archive],{stdio:'inherit'});
  // Fail instead of publishing provenance for a checkout modified while packaging.
  if(sourceState().commit!==state.commit||sourceInventory.some(item=>hash(path.join(root,item.path))!==item.sha256))throw Error('Source changed during build; discard candidate and rebuild from the frozen commit');
  const payload=inventory(packageRoot).map(x=>({...x,path:path.relative(packageRoot,x.path).replaceAll('\\','/')}));
  const relative=p=>path.relative(out,p).replaceAll('\\','/');
  const result={schemaVersion:3,product:'评估工具箱',productVersion:o.version,target:o.target,buildId:o['build-id'],buildNumber:Number(o['build-number']),extensionId:lock.extensionId,nativeHost:lock.nativeHost,sourceCommit:state.commit,sourceDirty:false,installerBuild:installerBuild(o.target),lockSha256:hash(lockfile),archive:{path:relative(archive),sha256:hash(archive)},packageRoot:relative(packageRoot),native,cache:{runtimeHit:cacheHit,key:o.target+'-'+hash(lockfile)},payload,acceptance:{offline:'pending',installer:'pending',gui:'not-covered',windowsRevalidation:'required for shared/Windows changes'}};
  fs.writeFileSync(path.join(out,'release-manifest.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(archive+'.sha256',`${hash(archive)}  ${path.basename(archive)}\n`);
  console.log(JSON.stringify({sourceCommit:state.commit,archive:result.archive,manifest:relative(path.join(out,'release-manifest.json')),runtimeCacheHit:cacheHit}));
}
if(require.main===module)build(argumentsFor(process.argv.slice(2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={argumentsFor,build};
