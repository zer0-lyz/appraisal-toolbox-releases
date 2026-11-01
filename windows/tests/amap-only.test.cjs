// Local Leaflet integration with a simulated official-camera API; no GUI/network.
// Run: node amap-only.test.cjs <output-dir> <directory-containing-jsdom>
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require(path.join(path.resolve(process.argv[3]),'jsdom'));
const source=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const client=fs.readFileSync(path.join(source,'native-helper/map-assets/amap-only.js'),'utf8');
(async()=>{
const cases=[],configuration={amapEnabled:true,amapWebKey:'synthetic-test-key'};
function environment(pixelScale=1){
 const dom=new JSDOM('<!doctype html><html><head></head><body><div id="map"></div></body></html>',{runScripts:'outside-only',url:'https://fixture.invalid/'});
 const w=dom.window,c=w.document.getElementById('map'),instances=[];
 for(const [property,value] of Object.entries({clientWidth:800,clientHeight:600,offsetWidth:800,offsetHeight:600}))Object.defineProperty(c,property,{value,configurable:true});
 c.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:800,bottom:600,width:800,height:600});
 w.SVGSVGElement.prototype.createSVGRect=()=>({});
 w.eval(fs.readFileSync(path.join(source,'native-helper/map-assets/leaflet.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(source,'native-helper/map-assets/leaflet.markercluster.js'),'utf8'));
 class LngLat{constructor(lng,lat){this.lng=lng;this.lat=lat;}getLng(){return this.lng;}getLat(){return this.lat;}}
 class Pixel{constructor(x,y){this.x=x;this.y=y;}getX(){return this.x;}getY(){return this.y;}}
 class Bounds{constructor(sw,ne){this.sw=sw;this.ne=ne;}}
 class Camera{
  constructor(element,options){this.element=element;this.options=options;this.center=options.center;this.zoom=options.zoom;this.handlers={};this.calls=[];instances.push(this);}
  on(event,callback){(this.handlers[event]??=[]).push(callback);}
  off(event,callback){this.handlers[event]=(this.handlers[event]||[]).filter(x=>x!==callback);}
  emit(event,data={}){for(const fn of this.handlers[event]||[])fn(data);}
  getCenter(){return new LngLat(...this.center);} getZoom(){return this.zoom;}
  scale(){return pixelScale*2**(this.zoom+0.15*Math.sin(this.zoom));}
  lngLatToContainer(p){return new Pixel(400+(p.getLng()-this.center[0])*this.scale(),300-(p.getLat()-this.center[1])*this.scale());}
  containerToLngLat(p){return new LngLat(this.center[0]+(p.x-400)/this.scale(),this.center[1]-(p.y-300)/this.scale());}
  setZoomAndCenter(z,c){this.zoom=z;this.center=c;this.calls.push({z,c});this.emit('zoomchange');this.emit('mapmove');this.emit('zoomend');}
  setBounds(b,immediate,avoid){this.bounds=b;this.avoid=avoid;this.setZoomAndCenter(12,[(b.sw[0]+b.ne[0])/2,(b.sw[1]+b.ne[1])/2]);}
  setZoom(z){this.setZoomAndCenter(z,this.center);}resize(){this.emit('resize');}destroy(){this.destroyed=true;}
 }
 w.AMap={Map:Camera,LngLat,Pixel,Bounds};w.eval(client);
 return {w,dom,c,instances};
}
for(const scale of [0.5,1,2,3]){
 const e=environment(scale),{w}=e,L=w.L;
 const map=w.AppraisalAmap.createMap('map',{preferCanvas:false},configuration).setView([30.25,120.16],9),sdk=e.instances[0];
 const marker=L.marker([30.26,120.18],{icon:L.divIcon({html:'case',iconSize:[20,20],iconAnchor:[10,18]})});
 const cluster=L.markerClusterGroup({disableClusteringAtZoom:8,animate:false,removeOutsideVisibleBounds:false}).addTo(map);cluster.addLayer(marker);
 marker.bindTooltip('label',{permanent:true}).bindPopup('details',{autoPan:false});
 const line=L.polyline([[30.25,120.16],[30.26,120.18]]).addTo(map);
 sdk.emit('complete');
 assert.equal(e.instances.length,1);assert.equal(sdk.options.zoomEnable,true);assert.equal(map.dragging.enabled(),false);assert.equal(map.scrollWheelZoom.enabled(),false);
 function aligned(){
  const gcj=w.AppraisalAmap.toGcj(marker.getLatLng().lng,marker.getLatLng().lat),expected=sdk.lngLatToContainer(new w.AMap.LngLat(...gcj));
  const actual=L.DomUtil.getPosition(marker.getElement());
  assert(Math.abs(actual.x-expected.x)<=0.5,JSON.stringify({actual,expected}));assert(Math.abs(actual.y-expected.y)<=0.5,JSON.stringify({actual,expected}));
  const reverse=map.layerPointToLatLng(map.latLngToLayerPoint(marker.getLatLng()));assert(Math.abs(reverse.lng-marker.getLatLng().lng)<1e-7);assert(Math.abs(reverse.lat-marker.getLatLng().lat)<1e-7);
  const tip=L.DomUtil.getPosition(marker.getTooltip().getElement());assert(Number.isFinite(tip.x)&&Number.isFinite(tip.y));
  const vertex=line._rings[0][1];assert(Math.abs(vertex.x-expected.x)<1e-7);assert(Math.abs(vertex.y-expected.y)<1e-7);
 }
 aligned();
 for(const zoom of [10,13,17,9.35,8,12]){map.setZoom(zoom);assert.equal(sdk.getZoom(),zoom);aligned();sdk.center=[sdk.center[0]+.005,sdk.center[1]-.003];sdk.emit('mapmove');aligned();sdk.emit('moveend');aligned();}
 const oldZoom=sdk.getZoom();e.c.querySelector('.leaflet-control-zoom-in').dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(sdk.getZoom(),oldZoom+1);aligned();
 e.c.querySelector('.leaflet-control-zoom-out').dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(sdk.getZoom(),oldZoom);aligned();
 map.flyTo([30.24,120.15],14);assert.equal(sdk.getZoom(),14);aligned();map.panBy([40,-20]);aligned();map.invalidateSize();aligned();
 map.fitBounds([[30.2,120.1],[30.3,120.2]],{paddingTopLeft:[11,22],paddingBottomRight:[33,44],maxZoom:11});assert.equal(sdk.getZoom(),11);assert.deepEqual(Array.from(sdk.avoid),[22,44,11,33]);aligned();
 let clicks=0;map.on('click',()=>clicks++);sdk.emit('click',{lnglat:sdk.getCenter()});assert.equal(clicks,1);
 marker.openPopup();assert(marker.isPopupOpen());map.setZoom(13);aligned();marker.closePopup();cluster.clearLayers();assert.equal(cluster.getLayers().length,0);
 map.remove();assert(sdk.destroyed);e.dom.window.close();cases.push('real-leaflet-marker-cluster-line-label-popup-buttons-sdk-camera-scale-'+scale);
}
for(const config of [{amapEnabled:false},{amapEnabled:true,amapWebKey:''}]){const e=environment();const map=e.w.AppraisalAmap.createMap('map',{},config);assert.equal(e.instances.length,0);assert.match(e.w.document.getElementById('amap-configuration-notice').textContent,/地图基础配置/);map.remove();e.dom.window.close();cases.push('missing-key-no-sdk');}
{
 const e=environment(),L=e.w.L,map=e.w.AppraisalAmap.createMap('map',{},configuration),sdk=e.instances[0];
 const group=L.markerClusterGroup({animate:false,disableClusteringAtZoom:12}).addTo(map);
 const first=L.marker([30.25,120.16],{icon:L.divIcon({html:'1'})}),second=L.marker([30.25001,120.16001],{icon:L.divIcon({html:'2'})});
 group.addLayers([first,second]);sdk.emit('complete');assert.notEqual(group.getVisibleParent(first),first);
 let focused=0;group.zoomToShowLayer(first,()=>focused++);assert.equal(focused,1);assert.equal(group.getVisibleParent(first),first);
 sdk.emit('error');assert(sdk.destroyed);assert.equal(e.c.style.visibility,'hidden');assert.match(e.w.document.getElementById('amap-configuration-notice').textContent,/高德地图加载失败/);
 map.remove();e.dom.window.close();cases.push('real-cluster-focus-and-sdk-error-hide-stale-map');
}
{
 const e=environment(),w=e.w,map=w.AppraisalAmap.createMap('map',{},configuration).setView([30.25,120.16],10),sdk=e.instances[0];sdk.emit('complete');map.setView([30.25,120.16],10);
 const pause=()=>new Promise(resolve=>setTimeout(resolve,150));
 const wheel=(amount,mode=0,extra={},target=e.c)=>target.dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:600,clientY:200,deltaY:amount,deltaMode:mode,...extra}));
 const anchor=sdk.containerToLngLat(new w.AMap.Pixel(600,200));wheel(-120);await pause();assert.equal(sdk.getZoom(),11);
 const point=sdk.lngLatToContainer(anchor);assert(Math.abs(point.x-600)<1e-7&&Math.abs(point.y-200)<1e-7);
 wheel(3,1);await pause();assert.equal(sdk.getZoom(),10);wheel(-1,2,{shiftKey:true});await pause();assert.equal(sdk.getZoom(),13);
 wheel(-10);await pause();assert.equal(sdk.getZoom(),13);wheel(-30);await pause();assert.equal(sdk.getZoom(),14);
 wheel(-10);await pause();await new Promise(resolve=>setTimeout(resolve,510));wheel(-30);await pause();assert.equal(sdk.getZoom(),14);
 wheel(-120,0,{ctrlKey:true});await pause();assert.equal(sdk.getZoom(),14);
 const button=w.document.createElement('button');e.c.append(button);wheel(-120,0,{},button);await pause();assert.equal(sdk.getZoom(),14);
 e.c.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:600,clientY:200,shiftKey:true}));assert.equal(sdk.getZoom(),13);assert.equal(sdk.options.doubleClickZoom,false);
 const getCenter=sdk.getCenter.bind(sdk),getZoom=sdk.getZoom.bind(sdk);let resets=0;const reset=map._resetView;map._resetView=function(...args){resets++;return reset.apply(this,args)};
 sdk.getCenter=()=>null;sdk.emit('mapmove');assert.equal(resets,0);sdk.getCenter=getCenter;sdk.getZoom=()=>NaN;sdk.emit('zoomchange');assert.equal(resets,0);sdk.getZoom=getZoom;
 map.setZoom(null);assert.equal(sdk.getZoom(),13);map.setZoom(NaN);assert.equal(sdk.getZoom(),13);
 wheel(-120);map.remove();const calls=sdk.calls.length;await pause();assert.equal(sdk.calls.length,calls);assert(Object.values(sdk.handlers).every(x=>x.length===0));e.dom.window.close();
 cases.push('wheel-units-shift-small-deltas-expiry-sdk-anchor-ui-ctrl-null-nan-unbind-cancel-pending');
}
const auction=require(path.join(source,'native-helper/alibaba-auction.js')),lease=require(path.join(source,'native-helper/alibaba-lease.js'));
for(const configured of [false,true])for(const [name,render]of[['auction',auction.renderMapHtml],['lease',lease.renderLeaseMapHtml]]){const html=render({points:[],unlocated:[],stats:{},mapConfig:configured?configuration:{amapEnabled:false,amapWebKey:''}},{});assert(html.includes('amap-single-camera-20261013.3'));assert(!/arcgisonline|tile\.openstreetmap|webrd0/.test(html));fs.writeFileSync(path.join(out,`${name}-${configured}.html`),html);}
let scriptsParsed=0;function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of files(out).filter(f=>f.endsWith('.html')&&!f.includes(path.sep+'map-assets'+path.sep))){const html=fs.readFileSync(file,'utf8');for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/\bsrc=/.test(script[1])){new vm.Script(script[2],{filename:path.basename(file)});scriptsParsed++;}}}
const result={ok:true,realLeafletUsed:true,simulatedAmapApi:true,realAmapNetworkCovered:false,browserUiCovered:false,realConfigRead:false,cases,scriptsParsed};fs.writeFileSync(path.join(out,'client-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
