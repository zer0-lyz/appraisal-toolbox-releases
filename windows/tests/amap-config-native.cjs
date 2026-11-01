const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {probe}=require('./nm-probe.cjs');
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
if(fs.existsSync(out))throw new Error('Preserve previous evidence');fs.mkdirSync(out,{recursive:true});
const configFile=path.join(out,'synthetic-map-config.json'),results=[];
async function run(message){const result=await probe(root,message,{env:{TIANYUAN_MAP_CONFIG_PATH:configFile},timeout:30000});assert.equal(result.exitCode,0);assert(result.final);return result.final;}
async function main(){
  let result=await run({action:'get_map_config'});assert(!result.configured&&!result.webKeyConfigured);results.push('empty-config');
  result=await run({action:'save_map_config',config:{amap:{enabled:true,webKey:'synthetic-key'}}});assert(result.ok&&result.configured&&result.webKeyConfigured);assert(!('securityJsCodeConfigured' in result));assert(!JSON.stringify(result).includes('synthetic-key'));assert.equal(JSON.parse(fs.readFileSync(configFile,'utf8')).amap.securityJsCode,undefined);results.push('key-only-config-and-redacted-summary');
  result=await run({action:'save_map_config',config:{amap:{enabled:true,preserveExisting:true}}});assert(result.ok&&result.configured);results.push('preserve-pair');
  result=await run({action:'save_map_config',config:{amap:{enabled:true,preserveExisting:true,webKey:'new-synthetic-key'}}});assert(result.ok&&result.configured);assert.equal(JSON.parse(fs.readFileSync(configFile,'utf8')).amap.webKey,'new-synthetic-key');results.push('replace-key-without-extra-secret');
  fs.writeFileSync(configFile,JSON.stringify({amap:{enabled:true,webKey:'synthetic-legacy-key',securityJsCode:'synthetic-obsolete-code'}}));
  result=await run({action:'get_map_config'});assert(result.configured&&result.webKeyConfigured&&!('securityJsCodeConfigured' in result));
  result=await run({action:'save_map_config',config:{amap:{enabled:true,preserveExisting:true}}});assert(result.ok&&result.configured);const migrated=JSON.parse(fs.readFileSync(configFile,'utf8')).amap;assert.equal(migrated.webKey,'synthetic-legacy-key');assert.equal(migrated.securityJsCode,undefined);results.push('legacy-key-only-and-discard-obsolete-code');
  result=await run({action:'clear_map_config'});assert(result.ok&&!result.configured&&!fs.existsSync(configFile));results.push('clear-config');
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({ok:true,realNativeMessaging:true,syntheticSettingsOnly:true,realUserConfigTouched:false,browserUiCovered:false,results},null,2));console.log(JSON.stringify({ok:true,results}));
}
main().catch(error=>{fs.writeFileSync(path.join(out,'failure.txt'),error.stack);console.error(error);process.exitCode=1;});
