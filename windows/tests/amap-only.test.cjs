const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const source = path.resolve(__dirname, '../..'), out = path.resolve(process.argv[2]); fs.mkdirSync(out, {recursive:true});
const client = fs.readFileSync(path.join(source,'native-helper/map-assets/amap-only.js'),'utf8');
const configuration = {amapEnabled:true,amapWebKey:'synthetic-test-key'};
function environment({constructorThrows=false}={}) {
  const nodes=new Map(), timers=new Map(), scripts=[], instances=[];let nextTimer=0;
  function node(id=''){const value={id,style:{},children:[],hidden:false,dataset:{},setAttribute(){},appendChild(item){this.children.push(item);if(item.id)nodes.set(item.id,item);return item;},remove(){this.removed=true;}};if(id)nodes.set(id,value);return value;}
  const document={getElementById:id=>nodes.get(id),createElement:()=>node(),body:node(),head:node()};document.head.appendChild=item=>{scripts.push(item);return item;};
  const listeners={};
  const context={document,setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},addEventListener(name,callback){listeners[name]=callback;},encodeURIComponent,console};context.window=context;
  class MapFixture {
    constructor(element,options){if(constructorThrows)throw Error('fixture failure');this.options=options;this.events={};this.centers=[];instances.push(this);}
    on(name,callback){this.events[name]=callback;}
    setZoomAndCenter(zoom,center){this.centers.push({zoom,center});}
    resize(){this.resized=true;}
    destroy(){this.destroyed=true;}
  }
  const baseProjection={bounds:{},project:latlng=>({x:latlng.lng,y:latlng.lat}),unproject:point=>({lng:point.x,lat:point.y})};
  context.L={CRS:{EPSG3857:{projection:baseProjection}},extend:Object.assign,latLng:(lat,lng)=>({lat,lng}),map(id,options){const container=node(id);return {options,center:{lat:30.25,lng:120.16},zoom:9,events:{},getContainer(){return container;},getCenter(){return this.center;},getZoom(){return this.zoom;},setView(center,zoom){this.center={lat:center[0],lng:center[1]};this.zoom=zoom;return this;},on(name,callback){this.events[name]=callback;return this;},off(name){delete this.events[name];return this;}};}};
  vm.runInNewContext(client,context);
  return {context,timers,scripts,instances,nodes,MapFixture,api:context.AppraisalAmap,expire(delay){for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}}};
}
const cases=[];
for(const config of [{amapEnabled:false},{...configuration,amapWebKey:''}]){
  const e=environment();e.api.watch(config);const map=e.api.createMap('map',{},config);
  assert.equal(e.scripts.length,0);assert.equal(e.instances.length,0);assert.equal(map.getContainer().style.visibility,'hidden');
  assert.match(e.nodes.get('amap-configuration-notice').textContent,/地图基础配置/);cases.push('missing-config-no-network');
}
{
  const e=environment(),reports=[];e.api.watch(configuration);const map=e.api.createMap('map',{},configuration,(message,kind)=>reports.push({message,kind}));
  assert.equal(e.context._AMapSecurityConfig,undefined);
  assert.equal(e.scripts.length,1);assert.equal(new URL(e.scripts[0].src).hostname,'webapi.amap.com');
  e.context.AMap={Map:e.MapFixture};e.scripts[0].onload();const sdk=e.instances[0];sdk.events.complete();
  assert.equal(map.getContainer().style.visibility,'visible');assert.equal(reports.at(-1).kind,'ok');
  assert.equal(e.nodes.get('amap-configuration-notice').hidden,true);
  const [lng,lat]=e.api.toGcj(120.16,30.25);assert(Math.abs(sdk.options.center[0]-lng)<1e-9);assert(Math.abs(sdk.options.center[1]-lat)<1e-9);
  const projected=map.options.crs.projection.project({lng:120.16,lat:30.25});assert(Math.abs(projected.x-lng)<1e-9);
  const original=map.options.crs.projection.unproject(projected);assert(Math.abs(original.lng-120.16)<1e-7);assert(Math.abs(original.lat-30.25)<1e-7);
  map.center={lng:120.2,lat:30.3};map.zoom=12;map.events['move zoom resize']();assert.equal(sdk.centers.at(-1).zoom,12);assert(sdk.resized);
  sdk.events.error();assert.equal(map.getContainer().style.visibility,'hidden');assert(sdk.destroyed);assert.equal(e.scripts.length,1);assert.match(reports.at(-1).message,/Key.*域名配置/);
  cases.push('official-sdk-key-ready-center-resize-auth-error');
}
for(const scenario of ['script-error','script-timeout','map-timeout','constructor-error']){
  const e=environment({constructorThrows:scenario==='constructor-error'});e.api.createMap('map',{},configuration);
  if(scenario==='script-error')e.scripts[0].onerror();
  if(scenario==='script-timeout')e.expire(15000);
  if(scenario==='map-timeout'||scenario==='constructor-error'){e.context.AMap={Map:e.MapFixture};e.scripts[0].onload();if(scenario==='map-timeout')e.expire(15000);}
  assert.match(e.nodes.get('amap-configuration-notice').textContent,/高德地图加载失败/);assert.equal(e.scripts.length,1);assert.equal(e.nodes.get('amap-configuration-notice').style.top,'12px');assert.equal(e.nodes.get('amap-configuration-notice').style.bottom,undefined);
  if(scenario==='script-timeout'){e.context.AMap={Map:e.MapFixture};e.scripts[0].onload();assert.equal(e.instances.length,0);}
  cases.push(scenario+'-no-fallback');
}
{
  const e=environment();e.api.watch(configuration);e.expire(12000);assert.match(e.nodes.get('amap-configuration-notice').textContent,/组件加载失败或超时/);assert.equal(e.scripts.length,0);cases.push('leaflet-timeout-visible');
  const known=e.api.toGcj(116.404,39.915);assert(Math.abs(known[0]-116.41024449916938)<1e-8);assert(Math.abs(known[1]-39.91640428150164)<1e-8);
  for(const [lng,lat] of [[120.16,30.25],[116.404,39.915],[121.5,31.2],[113.26,23.13],[-0.12,51.5]]){const converted=e.api.toGcj(lng,lat),original=e.api.fromGcj(...converted);assert(Math.abs(original[0]-lng)<1e-7);assert(Math.abs(original[1]-lat)<1e-7);}
  assert.deepEqual(Array.from(e.api.toGcj(-0.12,51.5)),[-0.12,51.5]);cases.push('coordinate-reference-and-inverse');
}
const auction=require(path.join(source,'native-helper/alibaba-auction.js')),lease=require(path.join(source,'native-helper/alibaba-lease.js'));
for(const configured of [false,true])for(const [name,render] of [['auction',auction.renderMapHtml],['lease',lease.renderLeaseMapHtml]]){
  const data={points:[],unlocated:[],stats:{},mapConfig:configured?configuration:{amapEnabled:false,amapWebKey:''}};
  const html=render(data,{});assert(!/tileProviders|arcgisonline|tile\.openstreetmap|webrd0|map-provider-select/.test(html));assert(html.includes('AppraisalAmap.createMap'));
  fs.writeFileSync(path.join(out,`${name}-${configured}.html`),html);
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}
let scriptsParsed=0;
for(const file of files(out).filter(file=>file.endsWith('.html')&&!file.includes(path.sep+'map-assets'+path.sep))){
  const html=fs.readFileSync(file,'utf8');assert(!/__AMAP_CLIENT__|__MAP_CONFIG__|__MAP_NOTICE_HIDDEN__/.test(html));
  for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/\bsrc=/.test(script[1])){new vm.Script(script[2],{filename:path.relative(out,file)});scriptsParsed++;}}
}
const result={ok:true,fixturesOnly:true,realConfigRead:false,realAmapNetworkCovered:false,browserUiCovered:false,keyOnlyConfiguration:true,noBottomNotice:true,cases,scriptsParsed,otherMapRenderers:4};
fs.writeFileSync(path.join(out,'client-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
