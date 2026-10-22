import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapSettingsModule} from '../../src/modules/map-settings/module.js';
import {ModuleRegistry} from '../../src/core/module-registry.js';
class Element {
  constructor(id){this.id=id;this.dataset={};this.style={};this.value='';this.checked=false;this.textContent='';this.disabled=false;this.listeners=new Map();this.classList={toggle(){}};}
  addEventListener(event,fn){this.listeners.set(event,fn);}removeEventListener(event){this.listeners.delete(event);}remove(){}toggleAttribute(){}removeAttribute(){}
  click(){assert(!this.disabled);return this.listeners.get('click')();}
}
const nodes=new Map(),calls=[],routes=[];
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);},head:{appendChild(){}},createElement(){return new Element('link');}};
let summary={ok:true,enabled:false,configured:false,webKeyConfigured:false};
const registry=new ModuleRegistry({featureFlags:{async load(){},isEnabled(){return true;}},eventBus:{publish(){},clear(){}},storageFactory:()=>({load:async()=>({}),save:async()=>{}}),documentRef:document});
const entry=registry.register(mapSettingsModule);
await registry.initialize({chrome:{runtime:{getURL:p=>p}},document,navigate:route=>routes.push(route),setStatus(){},sendNativeMessage:async message=>{
  calls.push(message);
  if(message.action==='save_map_config'){summary={ok:true,enabled:message.config.amap.enabled,configured:message.config.amap.enabled,webKeyConfigured:true,webKeyMasked:'masked'};}
  if(message.action==='clear_map_config'){summary={ok:true,enabled:false,configured:false,webKeyConfigured:false};}
  return summary;
}});
assert(entry.initialized);const get=id=>document.getElementById(id);const actions=()=>calls.filter(x=>x.action==='save_map_config').length;
const settingsTemplate=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../src/modules/map-settings/template.js'),'utf8');assert(!/securityJsCode|安全密钥/.test(settingsTemplate));assert(!settingsTemplate.includes('mapSettingsAmapSecurityCode'));
get('mapSettingsEnableAmap').checked=true;await get('saveMapSettings').click();assert.equal(actions(),0);assert.match(get('mapSettingsMessage').textContent,/Key/);
get('mapSettingsAmapKey').value='synthetic-key';await get('saveMapSettings').click();assert.equal(actions(),1);assert.equal(get('mapSettingsAmapKey').value,'');assert.match(get('mapSettingsConfiguredStatus').textContent,/已配置/);assert(!('securityJsCode' in calls.at(-1).config.amap));
await get('saveMapSettings').click();assert.equal(actions(),2);assert(calls.at(-1).config.amap.preserveExisting);
get('mapSettingsAmapKey').value='synthetic-new-key';await get('saveMapSettings').click();assert.equal(actions(),3);assert.equal(calls.at(-1).config.amap.webKey,'synthetic-new-key');
await get('clearMapSettings').click();assert.equal(get('mapSettingsConfiguredStatus').textContent,'未配置');assert.match(get('mapSettingsMessage').textContent,/配置提示/);assert(!/公共|备用/.test(get('mapSettingsMessage').textContent));
summary={ok:true,enabled:true,configured:false,webKeyConfigured:true};await entry.instance.activate();
// activate intentionally refreshes asynchronously; wait for its native continuation.
await Promise.resolve();await get('saveMapSettings').click();assert.equal(actions(),4);assert(calls.at(-1).config.amap.preserveExisting);assert(!('securityJsCode' in calls.at(-1).config.amap));
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const result={ok:true,fixturesOnly:true,realRegistryAndModule:true,missingKeyBlocked:true,keyOnlySaveAccepted:true,keyReplacementAccepted:true,existingKeyRepair:true,clearShowsConfigurationGuidance:true,browserUiCovered:false};fs.writeFileSync(path.join(out,'settings-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
