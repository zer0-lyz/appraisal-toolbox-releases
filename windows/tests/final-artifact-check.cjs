const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),delivery=path.resolve(process.argv[2]),build=path.resolve(process.argv[3]);
const result=JSON.parse(fs.readFileSync(path.join(build,'build-result.json'),'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function files(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(d,x.name)):[path.join(d,x.name)]).sort();}
const base=JSON.parse(fs.readFileSync(path.join(delivery,'extension-to-load-baseline-files.json'),'utf8'));
// After an authorized in-place upgrade, validate the immutable backup of the old baseline.
const baseline=process.argv[4]?path.resolve(process.argv[4]):path.join(source,'..','extension-to-load');assert.equal(files(baseline).length,base.length);
for(const f of base)assert.equal(hash(path.join(baseline,f.path)),f.sha256,'Baseline changed: '+f.path);
assert.equal(hash(result.archive),result.archiveSha256);assert(fs.readFileSync(result.archive+'.sha256','utf8').startsWith(result.archiveSha256+' '));
let checksums=0;for(const line of fs.readFileSync(path.join(result.packageRoot,'SHA256SUMS'),'utf8').trim().split('\n')){const match=line.match(/^([a-f0-9]{64})  (.+)$/);assert(match);assert.equal(hash(path.join(result.packageRoot,match[2])),match[1],match[2]);checksums++;}
assert.equal(checksums,files(result.packageRoot).length-1,'Unlisted package files');
const sourceManifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')),baselineManifest=JSON.parse(fs.readFileSync(path.join(baseline,'manifest.json'),'utf8'));
assert.equal(sourceManifest.key,baselineManifest.key);
const publicKey=Buffer.from(sourceManifest.key,'base64');const id=crypto.createHash('sha256').update(publicKey).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));assert.equal(id,'aamfmhcbjgofhmannejoiilkkpchfkgm');
const compareTrees=[['native-helper','native-helper'],['skills','skills'],['src','extension/src'],['windows/installer','']];
let sourceMatches=0;for(const [from,to] of compareTrees)for(const file of files(path.join(source,from)).filter(x=>!/[\\/]__pycache__[\\/]|\.py[co]$/.test(x))){const relative=path.relative(path.join(source,from),file);assert.equal(hash(file),hash(path.join(result.packageRoot,to,relative)),from+'/'+relative);sourceMatches++;}
const archiveCheck=execFileSync(path.join(result.packageRoot,'runtime/python-portable/python.exe'),['-X','utf8','-c','import json,sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({"ok":True,"entries":len(z.infolist())}));z.close()',result.archive],{encoding:'utf8',windowsHide:true});
const archiveInventoryCheck=execFileSync(path.join(result.packageRoot,'runtime/python-portable/python.exe'),[path.join(source,'scripts/release/package-macos.py'),'verify-zip',result.packageRoot,result.archive],{encoding:'utf8',windowsHide:true});
const inventory=JSON.parse(fs.readFileSync(path.join(build,'source-inventory.json'),'utf8'));for(const item of inventory)assert.equal(hash(path.join(source,item.path)),item.sha256,item.path);
const output={ok:true,archiveSha256:result.archiveSha256,archiveZipIntegrity:JSON.parse(archiveCheck),archiveInventoryIntegrity:JSON.parse(archiveInventoryCheck),packageFilesVerified:checksums,sourceFilesMatchPackage:sourceMatches,sourceInventoryFilesVerified:inventory.length,baselineFilesUnchanged:base.length,baselineDirectory:baseline,baselineVerifiedInBackup:Boolean(process.argv[4]),extensionId:id,nativeExeSha256:hash(result.exe),browserUiCovered:false};
fs.writeFileSync(path.join(build,'final-artifact-verification.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
