// Executes the real gate functions with plain element fixtures; no browser UI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=path.resolve(__dirname,'../..');
const evidence=path.resolve(process.argv[2]);fs.mkdirSync(evidence,{recursive:true});
function extract(module,name){const code=fs.readFileSync(path.join(source,'src/modules',module,'module.js'),'utf8');const start=code.indexOf('    function '+name+'() {');assert(start>=0);const tail=code.slice(start);const end=tail.search(/^    }\r?$/m);assert(end>0);return tail.slice(0,end+5);}
const element=()=>({disabled:false,title:'',textContent:'',dataset:{},setAttribute(k,v){this[k]=v;}});
const outcomes={};
for(const [module,prefix] of [['alibaba-auction','AlibabaAuction'],['alibaba-lease','AlibabaLease']]){
  const code=extract(module,'renderNetworkGate');const run=new Function('config','elements','running','opening','parametersApplied',code+';renderNetworkGate();');
  const elements={['open'+prefix+'Source']:element(),['run'+prefix]:element()};
  run({outputDirectory:''},elements,false,false,()=>false);assert(elements['run'+prefix].disabled);assert(elements['run'+prefix].title.includes('输出目录'));
  run({outputDirectory:'E:\\Synthetic'},elements,false,false,()=>false);assert(elements['run'+prefix].disabled);assert(elements['run'+prefix].title.includes('应用参数'));
  run({outputDirectory:'E:\\Synthetic'},elements,false,false,()=>true);assert(!elements['run'+prefix].disabled);
  run({outputDirectory:'E:\\Synthetic'},elements,true,false,()=>true);assert(elements['run'+prefix].disabled);
  outcomes[module]={missingDirectoryBlocked:true,unappliedParametersBlocked:true,readyEnabled:true,runningBlocked:true};
}
const table={runTableFormat:element(),tableFormatGate:element()};
const tableRun=new Function('elements','config','inputPaths','running',extract('table-format','renderRunGate')+';renderRunGate();');
tableRun(table,{outputMode:'copy_in_source'},[],false);assert(table.runTableFormat.disabled && table.tableFormatGate.textContent.includes('.docx'));
tableRun(table,{outputMode:'new_directory',outputDirectory:''},['synthetic.docx'],false);assert(table.runTableFormat.disabled);
tableRun(table,{outputMode:'copy_in_source'},['synthetic.docx'],false);assert(!table.runTableFormat.disabled);
outcomes.table={emptyInputBlocked:true,missingOutputBlocked:true,readyEnabled:true};
const anjuke={runAnjukeProperty:element(),anjukePropertyGate:element()};
const anjukeRun=new Function('elements','config','running','parametersApplied',extract('anjuke-property','renderRunGate')+';renderRunGate();');
anjukeRun(anjuke,{currentUrl:'',outputDirectory:''},false,()=>false);assert(anjuke.runAnjukeProperty.disabled && anjuke.anjukePropertyGate.textContent.includes('网址'));
anjukeRun(anjuke,{currentUrl:'https://hz.anjuke.com/',outputDirectory:'E:\\Synthetic'},false,()=>true);assert(!anjuke.runAnjukeProperty.disabled);
anjukeRun(anjuke,{currentUrl:'https://hz.anjuke.com/',outputDirectory:'E:\\Synthetic'},true,()=>true);assert(anjuke.runAnjukeProperty.disabled);
outcomes.anjuke={missingPrerequisitesBlocked:true,readyEnabled:true,runningBlocked:true};
fs.writeFileSync(path.join(evidence,'gate-components.json'),JSON.stringify({ok:true,plainElementFixtures:true,browserUiCovered:false,outcomes},null,2));
console.log('Four module gate component regressions passed.');
