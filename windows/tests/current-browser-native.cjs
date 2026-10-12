const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const {probe}=require('./nm-probe.cjs');
const root=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]);
if(fs.existsSync(evidence))throw new Error('Use new evidence directory');fs.mkdirSync(evidence,{recursive:true});
const resultDir=path.join(evidence,'中文 结果 # %');fs.mkdirSync(resultDir);
const file=path.join(resultDir,'结果 # %.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><title>人工结果页</title><p>人工验收</p>');
async function main(){const outcomes=[];for(const action of ['open_land_publicity_path','open_anjuke_property_path','open_alibaba_auction_path','open_alibaba_lease_path'])for(const explicit of [true,false]){
  const response=await probe(root,{action,path:file,outputDirectory:resultDir,...(explicit?{openInCurrentBrowserTab:true}:{})});
  fs.writeFileSync(path.join(evidence,action+'-'+explicit+'.json'),JSON.stringify(response,null,2));
  assert.equal(response.final.opened,false);
  if(explicit){assert.equal(response.final.ok,true,JSON.stringify(response.final));assert.equal(response.final.browserTab,true);assert.equal(response.final.fileUrl,pathToFileURL(file).href);}
  else{assert.equal(response.final.ok,false);assert.equal(response.final.errorCode,'RESULT_FRONTEND_UPDATE_REQUIRED');assert(response.final.reason.includes('新版扩展'));assert.equal(response.final.browserTab,undefined);}
  outcomes.push({action,explicitFlag:explicit,nativeDidNotOpen:true,legacyFrontendRejected:!explicit,fileUrl:response.final.fileUrl});
}
const invalid=await probe(root,{action:'open_land_publicity_path',path:__filename,openInCurrentBrowserTab:true});assert.equal(invalid.final.ok,false);
fs.writeFileSync(path.join(evidence,'invalid-artifact.json'),JSON.stringify(invalid,null,2));
fs.writeFileSync(path.join(evidence,'current-browser-native-summary.json'),JSON.stringify({ok:true,browserUiCovered:false,outcomes,invalidArtifactRejected:true},null,2));console.log('New EXE: 8 HTML requests returned current-browser URLs without opening via OS.');}
main().catch(error=>{fs.writeFileSync(path.join(evidence,'error.txt'),error.stack);console.error(error);process.exitCode=1;});
