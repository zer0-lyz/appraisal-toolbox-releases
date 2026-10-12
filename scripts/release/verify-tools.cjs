'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {inventory,hash}=require('./build-common.cjs');
function verifyTools(directory, lock) {
  for(const item of lock.tools) {
    const archive=path.join(directory,item.name.replace(/[/@]/g,'_')+'-'+item.version+'.tgz');
    const expected=item.integrity.replace(/^sha512-/,'');
    const digest=crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
    if(digest!==expected)throw Error('Tool archive integrity mismatch: '+item.name);
    // Check the module files against the locked tar bytes, not self-reported version metadata.
    const names=execFileSync(path.join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'),['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/).filter(n=>!n.endsWith('/'));
    for(const name of names) {
      if(!name.startsWith('package/')||name.split('/').includes('..'))throw Error('Unsafe tool archive entry');
      const relative=name.slice(8),installed=path.join(directory,'node_modules',item.name,relative);
      const data=execFileSync(path.join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'),['-xOzf',archive,name],{maxBuffer:30*1024*1024});
      const want=crypto.createHash('sha256').update(data).digest('hex');
      if(hash(installed)!==want)throw Error('Tool module content mismatch: '+item.name+'/'+relative);
    }
    const actual=inventory(path.join(directory,'node_modules',item.name)).map(x=>path.relative(path.join(directory,'node_modules',item.name),x.path).replaceAll('\\','/')).sort();
    if(JSON.stringify(actual)!==JSON.stringify(names.map(n=>n.slice(8)).sort()))throw Error('Unexpected tool module file: '+item.name);
  }
}
module.exports={verifyTools};
