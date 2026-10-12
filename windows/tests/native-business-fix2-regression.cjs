const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {probe}=require('./nm-probe.cjs');
const [rootArg,evidenceArg]=process.argv.slice(2);
const root=path.resolve(rootArg), evidence=path.resolve(evidenceArg);
if(fs.existsSync(evidence)) throw new Error('Use new evidence directory');
fs.mkdirSync(evidence,{recursive:true});
const python=path.join(root,'runtime','python-portable','python.exe');
async function run(name,message){const result=await probe(root,message,{timeout:300000});fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(result,null,2));assert.equal(result.exitCode,0);return result.final;}
async function main(){
  const workbookPath=path.join(evidence,'synthetic-input.xlsx');
  const message=(operation,extra={})=>({action:'depreciation_capex_forecast',operation,workbookPath,...extra});
  assert((await run('prepare',message('prepare'))).ok);
  assert((await run('params',message('write_params',{values:{'评估基准日':'2026-10-09','结束日期':'2027-12-31','折现率':0.08,'最低尚可使用年限':1}}))).ok);
  const asset={'序号':'fixture-1','情形描述':'人工验收','公司主体':'合成公司','资产科目':'机器设备','名称':'合成设备','账面原值':100,'账面净值':80,'评估原值':100,'启用时间':'2024-01-01','折旧年限':5,'经济耐用年限':10,'预计尚可使用年限':7,'更新后折旧年限':5,'更新后经济耐用年限':10,'残值率':0.05,'费用科目':'主营业务成本','折旧摊销':'折旧','进项税率':0.13,'是否需要更新':'是'};
  assert((await run('stock',message('write_stock',{values:[asset]}))).ok);
  const preflight=await run('preflight',message('preflight'));assert(preflight.ok && preflight.compatible);
  const calculated=await run('calculate',message('run'));assert.equal(calculated.ok,true,JSON.stringify(calculated));
  const read=await run('read-result',message('read_result'));assert.equal(read.ok,true);
  const outputPath=path.join(evidence,'synthetic-export.xlsx');
  const exported=await run('export',message('export',{outputPath}));assert(exported.ok && exported.readbackOk);
  const check=execFileSync(python,['-X','utf8','-c','import json,sys,zipfile;from openpyxl import load_workbook;p=sys.argv[1];assert zipfile.ZipFile(p).testzip() is None;w=load_workbook(p,data_only=False);print(json.dumps({"ok":True,"sheets":w.sheetnames,"checks":[list(r) for r in w["检查结果"].iter_rows(values_only=True)]},ensure_ascii=False));w.close()',outputPath],{encoding:'utf8',windowsHide:true});
  fs.writeFileSync(path.join(evidence,'export-workbook-readback.json'),check);
  const docx=path.join(evidence,'synthetic-input.docx');
  execFileSync(python,['-X','utf8','-c','from docx import Document;import sys;d=Document();d.add_paragraph("人工验收文档");t=d.add_table(rows=3,cols=2);t.cell(0,0).text="名称";t.cell(0,1).text="金额";t.cell(1,0).text="合成资产";t.cell(1,1).text="100";d.save(sys.argv[1])',docx],{windowsHide:true});
  const table=await run('table-format',{action:'run_table_format',inputPaths:[docx],outputMode:'copy_in_source'});assert.equal(table.ok,true,JSON.stringify(table));
  const gate=await run('table-no-input',{action:'run_table_format',inputPaths:[],outputMode:'copy_in_source'});assert.equal(gate.ok,false);
  const anjukeOutput=path.join(evidence,'anjuke-output');fs.mkdirSync(anjukeOutput);
  const anjuke=await run('anjuke-offline',{action:'run_anjuke_property',request:{listUrls:['https://hz.anjuke.com/'],outputDirectory:anjukeOutput,userDataDir:path.join(evidence,'unused-profile'),capturedPages:[{url:'https://hz.anjuke.com/prop/view/123456789/',title:'人工验收商铺',text:'人工验收商铺 售价 100 万 建筑面积 100 平米 单价 10000 元/平米 地址 杭州市合成路',location:'杭州市合成路'}],runStatus:'complete',restoreStatus:'skipped'}});
  assert.equal(anjuke.ok,true,JSON.stringify(anjuke));assert(anjuke.outputPaths.length>0 && anjuke.outputPaths.every(p=>fs.statSync(p).size>0));
  fs.writeFileSync(path.join(evidence,'business-regression-summary.json'),JSON.stringify({ok:true,syntheticDataOnly:true,depreciation:{preflight:true,run:true,exportReadback:true},table:{processed:true,emptyInputRejected:true},anjuke:{offlineCapturedPageRunner:true,realBrowserCaptureCovered:false},browserUiCovered:false},null,2));
  console.log('Native synthetic business regression passed: '+evidence);
}
main().catch(error=>{fs.writeFileSync(path.join(evidence,'business-regression-error.txt'),error.stack);console.error(error);process.exitCode=1;});
