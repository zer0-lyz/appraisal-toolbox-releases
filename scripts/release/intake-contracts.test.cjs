'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const checker=require('../../native-helper/update_checker.js');
test('same-version older official build never repairs a newer Mac or Windows build',()=>{
 const url='https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/latest/download/update-manifest.json';
 for(const [platform,architecture,key] of [['darwin','arm64','macos-arm64'],['win32','x64','windows-x64']]){
  const m={schemaVersion:1,productVersion:'0.2.1',buildNumber:2026101101,runtimeBuildId:'old',assets:{[key]:{fileName:'appraisal-toolbox-'+key+'.zip',url:'https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.1/a.zip',sha256:'a'.repeat(64)}}};
  const input={platform,architecture,currentVersion:'0.2.1',currentBuildNumber:2026101601,currentRuntimeBuildId:'new',currentRuntimeBuildKind:'release'};
  const r=checker.resultFromManifest(m,url,input);assert.equal(r.repairRequired,false);assert.equal(r.updateAvailable,false);
  assert.equal(checker.resultFromManifest({...m,buildNumber:2026101601},url,input).repairRequired,true);
 }
});
test('Mac update protocol completes once without loading Windows installer engine',async t=>{
 if(process.platform!=='darwin')return t.skip('Mac boundary checked on Mac runner');
 const updater=require('../../native-helper/platform/update.js'),frames=[];
 assert.equal(updater.capabilities().autoUpdateSupported,false);
 const r=await updater.downloadAndInstallUpdate({url:'https://fixture.invalid'},x=>frames.push(x),()=>assert.fail('must not fetch'));
 assert.equal(frames.length,1);assert.equal(r.event,'complete');assert.equal(r.reason,'PLATFORM_UPDATE_UNSUPPORTED');assert.equal(updater.isUpdating(),false);
 assert(!require.cache[path.join(root,'native-helper/update_engine.js')]);
});
test('actual shell stream settles legacy rejection and multi-frame progress/terminal responses',async()=>{
 const source=fs.readFileSync(path.join(root,'src/shell/shell.js'),'utf8');
 const body=source.slice(source.indexOf('function streamNativeMessage('),source.indexOf('async function bootstrapApplication('));
 for(const messages of [[{ok:false,reason:'APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED'}],[{event:'progress',percent:5},{ok:true,event:'complete'}]]){
  let receiver,disconnects=0;const progresses=[];
  const port={onMessage:{addListener:f=>receiver=f},onDisconnect:{addListener(){}},postMessage(){for(const x of messages)receiver(x)},disconnect(){disconnects++}};
  const sandbox={Promise,Error,window:{clearTimeout,setTimeout},NATIVE_STREAM_IDLE_TIMEOUT_MS:1000,NATIVE_HOST_NAME:'com.appraisal.toolbox.helper',chrome:{runtime:{connectNative:()=>port}},showNativeDiagnostics(){}};
  vm.createContext(sandbox);vm.runInContext(body+';globalThis.stream=streamNativeMessage;',sandbox);
  const r=await sandbox.stream({action:'download_and_install_update'},p=>progresses.push(p));assert.equal(r,messages.at(-1));assert.equal(disconnects,1);assert.equal(progresses.length,messages.length-1);
 }
});
test('Windows picker exit 1 is failure; cancel exit 2 remains cancellation',async()=>{
 const {createWindowsAdapter}=require('../../native-helper/platform/windows.js');
 for(const [code,cancelled] of [[1,false],[2,true]]){
  const adapter=createWindowsAdapter({execFile:(exe,args,options,done)=>done(Object.assign(new Error('fixture'),{code}),'','fixture failure')});
  const r=await adapter.chooseDirectory('fixture');assert.equal(r.cancelled,cancelled);assert.equal(r.reason,cancelled?'FILE_SELECTION_CANCELLED':'FILE_PICKER_FAILED');
 }
});
test('all three inherited workbook tools retain their scripts and development status',()=>{
 const module=fs.readFileSync(path.join(root,'src/modules/workbook-tools/module.js'),'utf8');
 assert.match(module,/stage: "development"/);
 for(const f of ['skills/appraisal-detail-print-format/scripts/adjust_appraisal_detail_print.py','skills/appraisal-declaration-print-format/scripts/adjust_appraisal_declaration_print.py','skills/asset-link-restore/scripts/restore_links.py'])assert(fs.statSync(path.join(root,f)).size>0);
});
