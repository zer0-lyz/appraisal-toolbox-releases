#!/usr/bin/env node
'use strict';
// Actual packaged host protocol checks; synthetic records, no login/network/desktop claims.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
function cleanEnvironment(extra={}) {
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('TIANYUAN_')||['PYTHON_BIN','PYTHONPATH','PYTHONHOME','APPRAISAL_TOOLBOX_ROOT'].includes(key))delete env[key];
  return {...env,...extra};
}
function hostCommand(root) {
  return process.platform==='win32'?{exe:path.join(root,'native-helper/native_host.exe'),args:[]}:{exe:path.join(root,'runtime/node/bin/node'),args:[path.join(root,'native-helper/native_host.js')]};
}
function probe(root,message,{timeout=120000,env=cleanEnvironment()}={}) {
  return new Promise((resolve,reject)=>{
    const spec=hostCommand(root),child=spawn(spec.exe,[...spec.args,'chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/'],{env,cwd:path.join(root,'native-helper'),stdio:['pipe','pipe','pipe'],windowsHide:true});
    const frames=[];let data=Buffer.alloc(0),stderr='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(result);};
    const timer=setTimeout(()=>finish(new Error('Owned protocol probe timed out')),timeout);
    child.stdout.on('data',b=>{data=Buffer.concat([data,b]);try{while(data.length>=4){const n=data.readUInt32LE(0);if(n>16*1024*1024)throw Error('Invalid Native frame size');if(data.length<n+4)break;frames.push(JSON.parse(data.subarray(4,4+n)));data=data.subarray(4+n);}}catch(e){finish(e);}});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-6000);});child.on('error',e=>finish(e));child.on('close',code=>{try{assert.equal(code,0);assert.equal(data.length,0);assert(frames.length);finish(null,{frames,stderr,final:frames.findLast(x=>x.event==='complete')||frames.at(-1)});}catch(e){finish(e);}});
    const payload=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);child.stdin.end(Buffer.concat([header,payload]));
  });
}
async function verify(root,evidence) {
  root=path.resolve(root);evidence=path.resolve(evidence);if(fs.existsSync(evidence))throw Error('Use new evidence directory');fs.mkdirSync(evidence,{recursive:true});
  const env=cleanEnvironment(),spec=hostCommand(root),python=process.platform==='win32'?path.join(root,'runtime/python-portable/python.exe'):path.join(root,'python/bin/python3');
  const self=JSON.parse(execFileSync(spec.exe,[...spec.args,'--self-test'],{env,encoding:'utf8',timeout:120000}));assert(self.ok,JSON.stringify(self));assert(self.pythonSkillImportSmoke?.ok);
  const checks=['actual packaged host --self-test: four independent Python imports without interpreter/skill environment overrides'];
  const run=async message=>{const result=await probe(root,message,{env});assert(result.final.ok,JSON.stringify(result.final));return result.final;};
  const synthetic={title:'合成案例 中文 [1]',province:'浙江省',city:'杭州市',district:'萧山区',propertyType:'住宅用房',address:'合成路1号',transactionTime:'2026-08-01',transactionAmount:1000000,buildingArea:100,unitPrice:10000,url:'https://sf-item.taobao.com/sf_item/100000001.htm'};
  for(const type of ['auction','lease']) {
    const request={outputDirectory:path.join(evidence,'中文 输出 ['+type+']'),province:'浙江省',city:'杭州市',district:'萧山区',generateMap:false,startDate:'2026-06-01',endDate:'2026-10-12'};
    const row=type==='auction'?synthetic:{...synthetic,endTime:'2026-08-02',resultStatus:'成交',location:'合成路2号',houseUsage:'住宅',leaseTermYears:1,monthlyUnitPrice:25};
    const result=await run({action:`write_alibaba_${type}_result`,request,results:[row],candidates:1,skipped:0});assert(fs.existsSync(result.htmlPath));assert(fs.existsSync(result.historyPath));
    const excel=await run({action:`write_alibaba_${type}_excel`,request,results:[row],candidates:1,skipped:0});assert(fs.existsSync(excel.excelPath));
    execFileSync(python,['-X','utf8','-c','import sys,zipfile;from openpyxl import load_workbook;p=sys.argv[1];assert zipfile.ZipFile(p).testzip() is None;w=load_workbook(p,read_only=True);assert len(list(w["成交案例"].iter_rows(values_only=True)))==2;w.close()',excel.excelPath],{env});
    const opened=await run({action:`open_alibaba_${type}_path`,path:result.htmlPath,outputDirectory:request.outputDirectory,openInCurrentBrowserTab:true});assert(opened.browserTab);assert(opened.fileUrl.startsWith('file:///'));
    checks.push(type+': synthetic HTML/history/Excel readback and validated current-browser URL via actual NM host');
  }
  const docDir=path.join(evidence,'中文 表格 [Content_Types]');fs.mkdirSync(docDir);
  for(const mode of ['copy_in_source','overwrite','new_directory']) {
    const input=path.join(docDir,mode+'.docx');execFileSync(python,['-X','utf8','-c','from docx import Document;import sys;d=Document();d.add_table(rows=2,cols=2).cell(0,0).text="合成资产";d.save(sys.argv[1])',input],{env});
    await run({action:'run_table_format',inputPaths:[input],outputMode:mode,outputDir:docDir});checks.push('table-format '+mode+': actual Native protocol, synthetic document');
  }
  const summary={ok:true,evidenceType:'offline-import-and-native-protocol',productVersion:JSON.parse(fs.readFileSync(path.join(root,'extension/version.json'))).productVersion,sourceCommit:JSON.parse(fs.readFileSync(path.join(root,'BUILD-PROVENANCE.json'))).sourceCommit,node:JSON.parse(fs.readFileSync(path.join(root,'BUILD-PROVENANCE.json'))).nodeVersion||execFileSync(spec.exe,['--version'],{encoding:'utf8'}).trim(),python:execFileSync(python,['--version'],{env,encoding:'utf8'}).trim(),checks,browserGuiCovered:false,networkScrapingCovered:false,desktopExcelOpenCovered:false,noPythonOverrides:true};
  fs.writeFileSync(path.join(evidence,'offline-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));return summary;
}
if(require.main===module)verify(...process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cleanEnvironment,probe,verify};
