import { tableFormatModule } from "../../src/modules/table-format/module.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as auction from '../../src/modules/alibaba-auction/module.js';
import * as lease from '../../src/modules/alibaba-lease/module.js';
import {classifyAlibabaPage,getAlibabaFailureMessage,isAlibabaExpiredVerificationUrl} from '../../src/core/alibaba-page-state.js';
import {userErrorMessage,localizeHistoryLabel} from '../../src/core/user-errors.js';
const evidence=path.resolve(process.argv[2]);fs.mkdirSync(evidence,{recursive:true});const checks=[];
const expired='https://passport.taobao.com/iv/static/expired.htm';
assert.equal(classifyAlibabaPage(expired),'verification');assert(isAlibabaExpiredVerificationUrl(expired));
for(const url of ['https://passport.taobao.com/iv/abc','https://sec.taobao.com/challenge/expired.htm'])assert.equal(classifyAlibabaPage(url),'verification');
assert.equal(classifyAlibabaPage('https://passport.taobao.com/'),'login');
assert(!userErrorMessage(new Error('Command failed: python.exe -c import private_source')).includes('private_source'));
assert(!getAlibabaFailureMessage('', 'ReferenceError: setResultButtons is not defined').includes('ReferenceError'));
assert.equal(localizeHistoryLabel({label:'杭州 · 2026-10-11T00:53:32.727Z · 36 条'}),'杭州 · 2026-10-11 08:53 · 36 条');checks.push('分类、技术错误隔离和本地时间');
function elementsFixture(){const elements=new Map(),handlers=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',dataset:{},style:{},innerHTML:'',textContent:'',checked:false,disabled:false,hidden:false,parentElement:{setAttribute(){}},classList:{toggle(){}},setAttribute(){},remove(){},appendChild(){},querySelector:selector=>element(id+selector)});return elements.get(id)};return {element,handlers,document:{getElementById:element,createElement:()=>({remove(){}}),head:{appendChild(){}}},scope:{add(){},on:(e,event,cb)=>handlers.set(`${e.id}:${event}`,cb)}};}
const fixture=elementsFixture(),stored={...auction.DEFAULT_CONFIG,outputDirectory:'E:\\fixture-results',historyDirectory:'E:\\fixture-history'};const historyPath='E:\\fixture-history\\latest_history.json';const rows=[{title:'真实接口结果在此测试用stub代替',url:'https://sf-item.taobao.com/sf_item/100.htm'}];let failure=false;
const instance=auction.alibabaAuctionModule.create();await instance.initialize({manifest:auction.alibabaAuctionModule.manifest,document:fixture.document,scope:fixture.scope,chrome:{runtime:{getURL:v=>v}},storage:{load:async()=>stored,save:async()=>{}},navigate(){},setStatus(){},sendNativeMessage:async message=>{
if(message.action==='list_alibaba_auction_history')return {ok:true,items:[{path:historyPath,label:'杭州 · 2026-10-11T00:53:32.727Z · 1 条',canRefresh:true}]};
if(message.action==='load_alibaba_auction_history')return {ok:true,results:rows,recordCount:1,htmlPath:'E:\\fixture-results\\latest.html',mapPath:'E:\\fixture-results\\latest_map.html',excelPath:'',canRefresh:true,request:stored,outputDirectory:stored.outputDirectory};
if(message.action==='write_alibaba_auction_excel')return failure?{ok:false,errorCode:'ALIBABA_EXCEL_EXPORT_FAILED',reason:'Excel 文件正被占用，请关闭文件后重试',diagnostics:{exitCode:1,stderrTail:['PermissionError: output file busy']}}:{ok:true,excelPath:'E:\\fixture-results\\latest.xlsx',rowCount:1};
throw new Error('Unexpected action '+message.action);
}});
await fixture.handlers.get('loadAlibabaAuctionHistoryCatalog:click')();fixture.element('alibabaAuctionHistorySelect').value=historyPath;await fixture.handlers.get('loadAlibabaAuctionHistory:click')();
for(const id of ['openAlibabaAuctionResult','exportAlibabaAuctionExcel','openAlibabaAuctionMap','runAlibabaAuctionHistory'])assert.equal(fixture.element(id).disabled,false,id);
assert.equal(fixture.element('openAlibabaAuctionExcel').disabled,true);
await fixture.handlers.get('exportAlibabaAuctionExcel:click')();assert.equal(fixture.element('openAlibabaAuctionExcel').disabled,false);
failure=true;await fixture.handlers.get('exportAlibabaAuctionExcel:click')();assert.match(fixture.element('alibabaAuctionResultMessage').textContent,/复制诊断详情/);assert(!fixture.element('alibabaAuctionResultMessage').textContent.includes('ALIBABA_'));
await fixture.handlers.get('clearAlibabaAuctionResults:click')();for(const id of ['openAlibabaAuctionResult','exportAlibabaAuctionExcel','openAlibabaAuctionExcel','openAlibabaAuctionMap','runAlibabaAuctionHistory'])assert.equal(fixture.element(id).disabled,true,id);
checks.push('真实模块按钮回调：历史加载、导出成功/失败、清空按钮状态（模拟Native）');
// Exercise the actual wait loop with a scaled monotonic clock: 5 minutes in 6 polls.
const originalNow=Date.now;let ticks=0,polls=0;Date.now=()=>ticks;
globalThis.window={setTimeout,clearTimeout};
try{
 const tab={id:71,url:expired};const context={chrome:{tabs:{query:async()=>{polls++;ticks+=60000;return [tab]},get:async()=>tab},scripting:{executeScript:async()=>{throw Error('Challenge pages must not be injected')}}}};
 await assert.rejects(()=>auction.readAlibabaPageWithManualVerification(context,tab,()=>{},()=>{},'测试',null,{expectedUrl:'https://sf.taobao.com/list/50025969.htm',pollIntervalMs:1}),e=>e.code==='ALIBABA_VERIFICATION_EXPIRED');assert(polls>=5);
}finally{Date.now=originalNow;}
checks.push('拍卖验证过期保留5分钟预算，URL级等待不注入验证页');
// Lease uses the same classifier; exercise its actual scraper entry with expired navigation.
ticks=0;polls=0;Date.now=()=>ticks;
try {
 const tab={id:81,url:expired};const events=new Set();const progress=[];
 const chrome={tabs:{query:async()=>[tab],get:async()=>{polls++;ticks+=60000;return tab},update:async()=>{for(const cb of events)cb(tab.id,{status:'complete'});return tab},onUpdated:{addListener:cb=>events.add(cb),removeListener:cb=>events.delete(cb)}},scripting:{executeScript:async()=>{throw Error('No challenge-page injection expected')}}};
 const result=await lease.runCurrentTabScrape({chrome,sendNativeMessage:async()=>{throw Error('No write while expired')}},{...lease.DEFAULT_CONFIG,maxPages:1,outputDirectory:'E:\\fixture-output'},p=>progress.push(p));
 assert.equal(result.ok,false);assert.equal(result.errorCode,'ALIBABA_LEASE_VERIFICATION_EXPIRED');assert(polls>=5);
} finally {Date.now=originalNow;}
checks.push('租赁真实scraper入口：验证过期等待预算与错误分类');


const tableFixture=elementsFixture();let allowOverwrite=false,confirmations=0,streams=0;
tableFixture.document.defaultView={confirm:()=>{confirmations++;return allowOverwrite}};
const table=tableFormatModule.create();await table.initialize({manifest:tableFormatModule.manifest,document:tableFixture.document,scope:tableFixture.scope,chrome:{runtime:{getURL:v=>v}},storage:{load:async()=>({outputMode:'overwrite'}),save:async()=>{}},navigate(){},setStatus(){},sendNativeMessage:async()=>({ok:true,paths:['E:\\synthetic.docx']}),streamNativeMessage:async()=>{streams++;return {ok:true,successCount:1,results:[]}}});
await tableFixture.handlers.get('chooseTableFormatFiles:click')();await tableFixture.handlers.get('runTableFormat:click')();assert.equal(streams,0);assert.equal(confirmations,1);allowOverwrite=true;await tableFixture.handlers.get('runTableFormat:click')();assert.equal(streams,1);assert.equal(confirmations,2);checks.push('覆盖前确认：取消不调用Native，确认后才执行');
fs.writeFileSync(path.join(evidence,'round2-ui-summary.json'),JSON.stringify({ok:true,realBrowserCovered:false,checks},null,2));console.log('Round2 UI regressions passed: '+checks.length);
