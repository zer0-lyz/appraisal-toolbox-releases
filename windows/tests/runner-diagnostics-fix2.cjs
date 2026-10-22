const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {probe}=require('./nm-probe.cjs');
const root=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]);
if(fs.existsSync(evidence))throw new Error('Use new evidence directory');fs.mkdirSync(evidence,{recursive:true});
const faulty=path.join(evidence,'faulty-skills');fs.cpSync(path.join(root,'skills'),faulty,{recursive:true});
const runnerText='import sys\nfor i in range(35): print("synthetic diagnostic line %d" % i,file=sys.stderr)\nprint("password=synthetic_secret",file=sys.stderr)\nraise ImportError("synthetic injected import failure")\n';
const scripts={table:'table-format/scripts/format_word_tables.py',depreciation:'depreciation-capex-forecast/scripts/workflow.py',anjuke:'anjuke-property-case-fetcher/scripts/fetch_anjuke_property_cases.py'};
for(const script of Object.values(scripts))fs.writeFileSync(path.join(faulty,script),runnerText);
const env={TIANYUAN_PRINT_SKILLS_DIR:faulty,TIANYUAN_DEPRECIATION_SKILL_DIR:path.join(faulty,'depreciation-capex-forecast')};
const docx=path.join(path.dirname(evidence),'business-regression-final','synthetic-input.docx');
const requests={
  table:{action:'run_table_format',inputPaths:[docx],outputMode:'copy_in_source'},
  depreciation:{action:'depreciation_capex_forecast',operation:'status',workbookPath:path.join(evidence,'synthetic.xlsx')},
  anjuke:{action:'run_anjuke_property',request:{listUrls:['https://hz.anjuke.com/'],outputDirectory:evidence,userDataDir:path.join(evidence,'unused-profile'),capturedPages:[]}}
};
async function main(){const outcomes={};for(const [name,message]of Object.entries(requests)){
  const result=await probe(root,message,{env});fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(result,null,2));
  assert.equal(result.exitCode,0);assert.equal(result.final.ok,false);
  const diagnostics=result.final.diagnostics || result.final.results?.find(x=>x.diagnostics)?.diagnostics;
  assert(diagnostics,JSON.stringify(result.final));assert.equal(diagnostics.exitCode,1);
  assert(diagnostics.stderrTail.length<=20 && diagnostics.stderrTail.some(x=>x.includes('synthetic injected import failure')));
  assert(!JSON.stringify(diagnostics).includes('synthetic_secret'));
  outcomes[name]={failureReported:true,exitCode:1,stderrAtMost20Lines:true,syntheticSecretRedacted:true};
}fs.writeFileSync(path.join(evidence,'diagnostics-regression-summary.json'),JSON.stringify({ok:true,syntheticFaultsOnly:true,outcomes},null,2));console.log('Runner diagnostics regressions passed.');}
main().catch(error=>{fs.writeFileSync(path.join(evidence,'error.txt'),error.stack);console.error(error);process.exitCode=1;});
