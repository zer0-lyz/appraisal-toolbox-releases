import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ModuleRegistry } from '../../src/core/module-registry.js';
import { landPublicityModule } from '../../src/modules/land-publicity/module.js';
import { openHtmlResultInCurrentBrowser } from '../../src/core/browser-results.js';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createWindowsAdapter}=require('../../native-helper/platform/windows.js');
class Element {
  constructor(id){this.id=id;this.dataset={};this.style={};this.value='';this.checked=false;this.textContent='';this.disabled=false;this.classList={toggle(){}};this.listeners=new Map();}
  addEventListener(event,fn){this.listeners.set(event,fn);}
  removeEventListener(event){this.listeners.delete(event);}
  toggleAttribute(){} removeAttribute(){} remove(){} querySelectorAll(){return [];}
  click(){assert.equal(this.disabled,false,`${this.id} disabled`);return this.listeners.get('click')();}
}
const results=[];
async function harness(){
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},head:{appendChild(){}},createElement(){return new Element('link');}};
  const statuses=[],calls=[],tabs=[],routes=[];
  const state={nativeFailure:false,tabFailure:false,fileAccess:undefined,excelNoConfirmation:false};
  const chrome={runtime:{getURL:p=>p},windows:{getCurrent:async()=>({id:19})},tabs:{create:async options=>{if(state.tabFailure)throw new Error('File scheme blocked');tabs.push(options);return{id:9};}},extension:{isAllowedFileSchemeAccess:async()=>state.fileAccess}};
  const registry=new ModuleRegistry({featureFlags:{async load(){},isEnabled(){return true;}},eventBus:{publish(){},clear(){}},storageFactory:()=>({load:async()=>({}),save:async()=>{}}),documentRef:document});
  const entry=registry.register(landPublicityModule);
  await registry.initialize({chrome,document,extensionManifest:{version:'0.2.1'},connectorProtocolVersion:'connector-agent-binding-v3',isBusy:()=>false,setConnection(){},navigate:route=>routes.push(route),setStatus:(text,kind)=>statuses.push({text,kind}),
    async sendNativeMessage(message){
      calls.push(message);
      if(message.action==='list_land_publicity_regions')return{ok:true,regions:[{name:'杭州市',children:[]}]};
      if(message.action==='open_land_publicity_path'){
        if(state.nativeFailure)return{ok:false,reason:'NATIVE_PATH_OPEN_FAILED'};
        if(/\.html$/.test(message.path))return{ok:true,browserTab:true,fileUrl:'file:///E:/fixture/'+(message.path.includes('map')?'map':'result')+'.html'};
        return{ok:true,opened:!state.excelNoConfirmation,launchAccepted:true};
      }
      throw new Error('Unexpected action '+message.action);
    },
    async streamNativeMessage(){return{ok:true,percent:100,htmlPath:'E:\\fixture\\result.html',excelPath:'E:\\fixture\\result.xlsx',mapPath:'E:\\fixture\\map.html',writtenCount:7};}
  });
  assert(entry.initialized,'Real registry/module initialization failed');
  const get=id=>document.getElementById(id);
  get('landPublicityOutputDirectory').value='E:\\fixture';
  await get('runLandPublicity').click();
  return{state,statuses,calls,tabs,get,registry,routes};
}
const ui=await harness();
await ui.get('openLandPublicityMapSettings').click();assert.equal(ui.routes.at(-1),'map-settings');
assert.equal(ui.tabs.length,1);
assert.match(ui.get('landPublicityResultMessage').textContent,/Excel 7 条/);
assert.match(ui.get('landPublicityResultMessage').textContent,/上限=200/);
for(const [button,label]of [['openLandPublicityHtml','结果页'],['openLandPublicityMap','地图']]){
  await ui.get(button).click();
  assert.deepEqual(ui.tabs.at(-1),{windowId:19,url:'file:///E:/fixture/'+(label==='地图'?'map':'result')+'.html',active:true});
  assert.match(ui.get('landPublicityOpenMessage').textContent,/当前浏览器新标签页/);
  results.push({button,currentWindow:true,inlineFeedback:true});
}
await ui.get('openLandPublicityExcel').click();
assert.match(ui.get('landPublicityOpenMessage').textContent,/Windows 关联应用/);
assert.equal(ui.calls.at(-1).openInCurrentBrowserTab,undefined);
ui.state.nativeFailure=true;
await ui.get('openLandPublicityExcel').click();
assert.equal(ui.get('landPublicityOpenMessage').dataset.kind,'error');
assert.match(ui.get('landPublicityOpenMessage').textContent,/文件关联和访问权限/);
ui.state.nativeFailure=false;ui.state.excelNoConfirmation=true;
await ui.get('openLandPublicityExcel').click();assert.match(ui.get('landPublicityOpenMessage').textContent,/未收到文件打开确认/);
ui.state.tabFailure=true;ui.state.fileAccess=false;
await ui.get('openLandPublicityHtml').click();assert.match(ui.get('landPublicityOpenMessage').textContent,/允许访问文件网址/);
await ui.get('runLandPublicity').click();
assert.match(ui.get('landPublicityResultMessage').textContent,/Excel 7 条/);
assert.match(ui.get('landPublicityOpenMessage').textContent,/允许访问文件网址/);
assert.equal(ui.statuses.at(-1).kind,'error','Automatic open failure overwritten by completion');
assert.equal(ui.get('landPublicityProgressPercent').textContent,'100%','Open failure changed completed job to failed');
assert.equal(ui.get('runLandPublicity').disabled,false);
await ui.registry.dispose();assert.equal(ui.get('openLandPublicityHtml').listeners.size,0);
// Verify browser failure without a file-permission API, and an absent tab confirmation.
for(const chrome of [{windows:{getCurrent:async()=>({id:1})},tabs:{create:async()=>{throw new Error('blocked');}}},{windows:{getCurrent:async()=>({id:1})},tabs:{create:async()=>undefined}}]){
  await assert.rejects(()=>openHtmlResultInCurrentBrowser({chrome,sendNativeMessage:async()=>({ok:true,browserTab:true,fileUrl:'file:///E:/result.html'})},'open_land_publicity_path','E:\\result.html'),/浏览器未能创建/);
}
// Test the production adapter command contract, with no GUI/app launch.
for(const [stdout,error,expected]of [
  ['APPRAISAL_OPEN_RESULT:{"ok":true,"opened":true,"launchAccepted":true}',null,true],
  ['APPRAISAL_OPEN_RESULT:{"ok":false,"reason":"FILE_ASSOCIATION_MISSING"}',{code:1},false],
  ['',null,false],
]){
  const adapter=createWindowsAdapter({execFile(command,args,options,done){
    assert(command.endsWith('powershell.exe'));assert(args.includes('-NonInteractive'));
    assert.equal(options.env.APPRAISAL_OPEN_TARGET,'E:\\中文 # % & \' 文件.xlsx');
    const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
    assert(script.includes('Start-Process -FilePath $env:APPRAISAL_OPEN_TARGET'));assert(!script.includes('中文'));
    done(error,stdout);
  }});
  const response=await adapter.openPath('E:\\中文 # % & \' 文件.xlsx');assert.equal(response.ok,expected);
  if(expected)assert(response.launchAccepted);else if(stdout)assert.equal(response.reason,'FILE_ASSOCIATION_MISSING');
}
const outcome={ok:true,realRegistryAndScope:true,fixtureDomAndChrome:true,browserUiCovered:false,results,excelDispatchAndFailureFeedback:true,autoOpenFailurePreservesCompletedJob:true,fileAccessGuidance:true,windowsOpenAdapterCases:3};
const folder=process.argv[2];if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'result-buttons-components.json'),JSON.stringify(outcome,null,2));}
console.log(JSON.stringify(outcome,null,2));
