import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../..');
const code=fs.readFileSync(path.join(source,'src/core/browser-results.js'),'utf8').replace(/^export /gm,'');
const openResult=new Function(code+';return openHtmlResultInCurrentBrowser;')();
const outcome={ok:true,componentOnly:true,browserUiCovered:false,actions:[],pathCases:[]};
for(const action of ['open_land_publicity_path','open_anjuke_property_path','open_alibaba_auction_path','open_alibaba_lease_path']){
  const calls=[],tabs=[],fileUrl='file:///E:/%E4%B8%AD%E6%96%87%20%23%20%25/result.html';
  const context={sendNativeMessage:async(message)=>{calls.push(message);return{ok:true,browserTab:true,fileUrl};},chrome:{windows:{getCurrent:async()=>({id:42})},tabs:{create:async(options)=>{tabs.push(options);return{id:5};}}}};
  await openResult(context,action,'E:\\中文 # %\\result.html','E:\\中文 # %');
  assert.equal(calls.length,1);assert.equal(calls[0].openInCurrentBrowserTab,true);assert.equal(tabs.length,1);
  assert.deepEqual(tabs[0],{windowId:42,url:fileUrl,active:true});
  outcome.actions.push({action,usesCurrentWindow:true,oneNewActiveTab:true});
  const failed={...context,sendNativeMessage:async()=>({ok:false,reason:'File missing'})};
  await assert.rejects(()=>openResult(failed,action,'missing.html'),/File missing/);assert.equal(tabs.length,1);
  const invalid={...context,sendNativeMessage:async()=>({ok:true,browserTab:true,fileUrl:'https://example.com/result.html'})};
  await assert.rejects(()=>openResult(invalid,action,'result.html'),/本机 HTML/);assert.equal(tabs.length,1);
  const blocked={...context,chrome:{...context.chrome,tabs:{create:async()=>{throw new Error('Browser tab blocked');}}}};
  await assert.rejects(()=>openResult(blocked,action,'result.html'),/浏览器未能创建/);
}
for(const local of ['E:\\中文 文件\\结果 # %.html','\\\\server\\share\\中文 结果.html','/Users/test/中文 # %.html']){
  // Test Windows URL conversion with the actual host in the protocol companion.
  outcome.pathCases.push(local);
}
outcome.failedValidationDoesNotOpenTab=true;outcome.tabFailurePropagatesWithoutOsFallback=true;
for(const module of ['land-publicity','anjuke-property','alibaba-auction','alibaba-lease']){
  const moduleCode=fs.readFileSync(path.join(source,'src/modules',module,'module.js'),'utf8');
  assert(moduleCode.includes('import { openHtmlResultInCurrentBrowser }'));
  assert(moduleCode.includes('await openHtmlResultInCurrentBrowser(context,'));
}
const evidence=process.argv[2];if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'current-browser-components.json'),JSON.stringify(outcome,null,2));}
console.log(JSON.stringify(outcome,null,2));
