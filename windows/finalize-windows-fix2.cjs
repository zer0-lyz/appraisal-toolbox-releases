// Refresh installer/docs/checksums without recompiling the already tested EXE.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const [verifiedArg,outputArg]=process.argv.slice(2), verified=path.resolve(verifiedArg), output=path.resolve(outputArg);
const source=path.resolve(__dirname,'..');
if(fs.existsSync(output))throw new Error('Use a new output directory');
fs.mkdirSync(output,{recursive:true});
const previous=JSON.parse(fs.readFileSync(path.join(verified,'build-result.json'),'utf8'));
const verifiedHash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(verifiedHash(previous.archive)!==previous.archiveSha256 || verifiedHash(previous.exe)!==previous.provenance.nativeExeSha256)throw new Error('Prior ZIP/EXE integrity check failed');
const pkg=path.join(output,path.basename(previous.packageRoot));fs.cpSync(previous.packageRoot,pkg,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]).sort();}
for(const name of fs.readdirSync(path.join(source,'windows','installer')))fs.copyFileSync(path.join(source,'windows','installer',name),path.join(pkg,name));
const inventory=files(source).filter(p=>!/(?:^|[\\/])(?:\.git|node_modules|__pycache__)(?:[\\/]|$)|\.py[co]$/.test(p)).map(p=>({path:path.relative(source,p).replaceAll('\\','/'),sha256:hash(p)}));
fs.writeFileSync(path.join(output,'source-inventory.json'),JSON.stringify(inventory,null,2));
const installerBuild=fs.readFileSync(path.join(source,'windows','installer','install.ps1'),'utf8').match(/\$InstallerBuild = "([^"]+)"/)[1];
// Installer-only finalization must not silently reuse stale business payloads.
for(const [from,to] of [['src','extension/src'],['native-helper','native-helper'],['skills','skills']])for(const f of files(path.join(source,from)).filter(p=>!/[\\/]__pycache__[\\/]|\.py[co]$/.test(p)))if(hash(f)!==hash(path.join(pkg,to,path.relative(path.join(source,from),f))))throw new Error('Source payload differs; use the full builder: '+f);
for(const f of ['manifest.json','version.json','runtime-compat.json'])if(hash(path.join(source,f))!==hash(path.join(pkg,'extension',f)))throw new Error('Extension metadata differs: '+f);
const provenance={...previous.provenance,installerBuild,sourceInventorySha256:hash(path.join(output,'source-inventory.json')),finalizedAtUtc:new Date().toISOString(),nativeCompileEvidence:path.relative(output,verified).replaceAll('\\','/'),nativeHelperRebuilt:false,nativeExeReuseBuild:previous.provenance.buildId,extensionChanged:false,finalizationScope:'installer-context-attestation-only'};
fs.writeFileSync(path.join(pkg,'BUILD-PROVENANCE.json'),JSON.stringify(provenance,null,2));
const exe=path.join(pkg,'native-helper','native_host.exe');if(hash(exe)!==previous.provenance.nativeExeSha256)throw new Error('EXE changed during finalization');
fs.writeFileSync(path.join(pkg,'SHA256SUMS'),files(pkg).filter(p=>path.relative(pkg,p)!=='SHA256SUMS').map(p=>hash(p)+'  '+path.relative(pkg,p).replaceAll('\\','/')).join('\n')+'\n');
const archive=path.join(output,path.basename(pkg)+'.zip');
execFileSync(path.join(pkg,'runtime','python-portable','python.exe'),[path.join(source,'scripts','release','package-macos.py'),'zip',pkg,archive],{windowsHide:true});
const archiveSha256=hash(archive);fs.writeFileSync(archive+'.sha256',archiveSha256+' *'+path.basename(archive)+'\n');
fs.writeFileSync(path.join(output,'build-result.json'),JSON.stringify({archive,archiveSha256,packageRoot:pkg,exe,provenance,selfTestPassed:previous.selfTestPassed},null,2));
console.log(JSON.stringify({archive,archiveSha256,nativeExeUnchanged:true},null,2));
