'use strict';
// Actual module in a synthetic DOM. No browser/network/installer acceptance claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require(path.join(path.resolve(process.argv[2]),'jsdom'));
const root=path.resolve(__dirname,'../..');
async function fixture(platform){
 const autoUpdateSupported=platform==='windows-x64'||platform==='macos-arm64';
 const dom=new JSDOM('<div id="page-updates"></div><button id="openUpdatesTop"></button>',{url:'https://fixture.invalid/'}),document=dom.window.document,handlers=new Map(),opened=[];
 const config={productVersion:'0.2.2',buildNumber:2026101701},contract={runtimeBuildId:'fixture',runtimeBuildKind:'local'};
 const result={ok:true,releasePublished:true,updateAvailable:true,latestVersion:'0.2.3',platform,autoUpdateSupported,releaseUrl:'https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.3',asset:{name:'fixture.zip',url:'https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.3/fixture.zip',sha256:'a'.repeat(64)},currentVersion:'0.2.2',currentBuildNumber:2026101701,currentRuntimeBuildId:'fixture',currentRuntimeBuildKind:'local'};
 let checks=0,streams=0,finish,reloads=0;const reloadTimers=[];const originalSetTimeout=dom.window.setTimeout.bind(dom.window);dom.window.setTimeout=(callback,delay,...args)=>delay===900?(reloadTimers.push(callback),reloadTimers.length):originalSetTimeout(callback,delay,...args);
 const context={document,manifest:{pageElementId:'page-updates'},extensionManifest:{version:'0.2.2'},storage:{migrateLegacy:async()=>null,save:async()=>{}},setConnection(){},setStatus(){},isBusy:()=>false,navigate(){},chrome:{runtime:{getURL:p=>p,reload:()=>reloads++},tabs:{create:async x=>opened.push(x)}},scope:{on:(el,event,fn)=>handlers.set(el.id||event,fn),add(){},interval(){},timeout(){}},sendNativeMessage:async()=>{checks++;return result},streamNativeMessage:async(message,progress)=>{streams++;progress({event:'progress',percent:20,phase:'downloading'});return await new Promise(resolve=>finish=resolve)}};
 const sandbox={window:dom.window,URL,Date,console,fetch:async url=>({ok:true,json:async()=>String(url).includes('runtime-compat')?contract:config})};vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(path.join(root,'src/modules/updates/template.js'),'utf8').replace('export const','const')+';globalThis.updatesTemplate=updatesTemplate;',sandbox);
 vm.runInContext(fs.readFileSync(path.join(root,'src/modules/updates/module.js'),'utf8').replace('export const','const').replace('import { updatesTemplate } from "./template.js";','')+';globalThis.module=updatesModule;',sandbox);
 await sandbox.module.create().initialize(context);await handlers.get('updatePrimaryAction')();assert.equal(checks,1);
 if(!autoUpdateSupported){assert.equal(document.getElementById('updatePrimaryAction').textContent,'打开发布页');await handlers.get('updatePrimaryAction')();assert.equal(streams,0);assert.equal(opened.length,1)}
 else{
  const pending=handlers.get('updatePrimaryAction')();await Promise.resolve();assert.equal(streams,1);assert.equal(document.getElementById('updatePrimaryAction').disabled,true);
  await handlers.get('focus')();assert.equal(checks,1);finish({ok:true,event:'complete',...(platform==='windows-x64'?{}:{platform})});await pending;
  assert.equal(document.getElementById('updateProgressBar').value,100);assert.equal(document.getElementById('updatePrimaryAction').disabled,false);
  for(const callback of reloadTimers)callback();
  assert.equal(reloads,['macos-arm64','windows-x64'].includes(platform)?1:0);
 }
 dom.window.close();return {platform,autoUpdateSupported,checks,streams,opened:opened.length,reloads};
}
(async()=>{const cases=[await fixture('linux-x64'),await fixture('windows-x64'),await fixture('macos-arm64')];const summary={ok:true,evidenceType:'actual-updates-module-synthetic-DOM',cases,guiCovered:false};fs.writeFileSync(process.argv[3],JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary))})().catch(e=>{console.error(e);process.exitCode=1});
