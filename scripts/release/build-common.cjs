'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function sourceState() {
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], {encoding:'utf8'}).trim();
  if (dirty) throw new Error(`Build requires a clean source tree, including untracked files:\n${dirty}`);
  return {commit, dirty:false};
}
function inventory(directory) {
  return fs.readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=> {
    const file=path.join(directory,e.name);
    if(e.isSymbolicLink()) throw new Error('Unexpected package symlink: '+file);
    return e.isDirectory()?inventory(file):[{path:file,sha256:hash(file),bytes:fs.statSync(file).size}];
  });
}
function verifyRuntime(directory, targetLock) {
  const expected=targetLock.runtimeFiles;
  for(const item of expected) {
    if(!item.path.startsWith('runtime/') || item.path.includes('..')) throw new Error('Unsafe lock path');
    const file=path.join(directory,item.path);
    if(!fs.existsSync(file)||hash(file)!==item.sha256) throw new Error('Runtime SHA mismatch: '+item.path);
  }
  const actual=inventory(path.join(directory,'runtime')).map(x=>path.relative(directory,x.path).replaceAll('\\','/')).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected.map(x=>x.path).sort())) throw new Error('Runtime inventory has extra/missing files');
}
function copyTracked(from, to, tracked) {
  fs.mkdirSync(to,{recursive:true});
  for(const file of tracked) {
    if(file===from||file.startsWith(from+'/')) {
      const relative=file===from?path.basename(file):file.slice(from.length+1);
      const target=path.join(to,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);
    }
  }
}
function installerBuild(target) {
  const file=path.join(root,target==='windows-x64'?'windows/installer/install.ps1':'macos/installer/install.sh');
  const match=fs.readFileSync(file,'utf8').match(target==='windows-x64'?/^\$InstallerBuild\s*=\s*"([^"]+)"/m:/^INSTALLER_BUILD="([^"]+)"/m);
  if(!match)throw new Error('Missing installer build declaration');
  return match[1];
}
module.exports={root,hash,sourceState,inventory,verifyRuntime,copyTracked,installerBuild};
