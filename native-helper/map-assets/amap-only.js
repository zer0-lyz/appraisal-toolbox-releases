/* Official AMap JS API basemap. Leaflet retains the case/selection tools. */
(function (global) {
  'use strict';
  const guide = '请前往工具箱首页 → 地图基础配置，启用高德地图，填写 Web 端（JS API）Key 并保存，再重新生成地图。';
  const configurationReady = config => config?.amapEnabled === true && Boolean(String(config.amapWebKey || '').trim());
  function report(message, kind = 'error', callback) {
    let notice = document.getElementById('map-setup-notice') || document.getElementById('tile-status') || document.getElementById('amap-configuration-notice');
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'amap-configuration-notice';
      notice.setAttribute('role', 'status');
      Object.assign(notice.style, { position: 'fixed', zIndex: '1500', left: '12px', right: '12px', top: '12px', padding: '12px', border: '1px solid #f6d58a', borderRadius: '8px', background: '#fff8e6', color: '#854d0e', font: '13px/1.6 system-ui', overflowWrap: 'anywhere' });
      document.body.appendChild(notice);
    }
    notice.textContent = message; notice.dataset.kind = kind; notice.hidden = kind === 'ok';
    if (typeof callback === 'function') callback(message, kind);
  }
  let bootTimer = null, mounted = false;
  function watch(config, callback) {
    if (!configurationReady(config)) { report('尚未配置高德地图。' + guide, 'warn', callback); return; }
    report('正在加载高德地图…', 'loading', callback);
    bootTimer = global.setTimeout(() => {
      if (!mounted) report('地图组件加载失败或超时，请检查网络后刷新页面。' + guide, 'error', callback);
    }, 12000);
  }
  function outsideChina(lng, lat) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
  function toGcj(lng, lat) {
    if (outsideChina(lng, lat)) return [lng, lat];
    const x = lng - 105, y = lat - 35, pi = Math.PI;
    let dLat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    dLat += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
    dLat += (20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3;
    dLat += (160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
    let dLng = 300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
    dLng += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
    dLng += (20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3;
    dLng += (150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
    const radLat = lat/180*pi, sin = Math.sin(radLat), magic = 1-0.00669342162296594323*sin*sin, sqrt = Math.sqrt(magic);
    dLat = dLat*180/((6378245*(1-0.00669342162296594323))/(magic*sqrt)*pi);
    dLng = dLng*180/(6378245/sqrt*Math.cos(radLat)*pi);
    return [lng+dLng, lat+dLat];
  }
  function fromGcj(lng, lat) {
    let guessLng = lng, guessLat = lat;
    for (let i = 0; i < 6; i++) { const actual = toGcj(guessLng, guessLat); guessLng -= actual[0]-lng; guessLat -= actual[1]-lat; }
    return [guessLng, guessLat];
  }
  function crs() {
    const original = global.L.CRS.EPSG3857, projection = original.projection;
    return global.L.extend({}, original, { projection: {
      bounds: projection.bounds,
      project(latlng) { const [lng, lat] = toGcj(latlng.lng, latlng.lat); return projection.project(global.L.latLng(lat, lng)); },
      unproject(point) { const converted = projection.unproject(point), [lng, lat] = fromGcj(converted.lng, converted.lat); return global.L.latLng(lat, lng); }
    } });
  }
  function mount(map, config, callback) {
    mounted = true; global.clearTimeout(bootTimer);
    const container = map.getContainer(); container.style.visibility = 'hidden';
    if (!configurationReady(config)) { report('尚未配置高德地图。' + guide, 'warn', callback); return; }
    report('正在加载高德地图…', 'loading', callback);
    let sdkMap = null, base = null, script = null, settled = false, destroyed = false, sync = null;
    const failure = () => {
      if (destroyed) return;
      settled = true; destroyed = true; global.clearTimeout(timer);
      if (script) script.remove();
      if (sync) map.off('move zoom resize', sync);
      if (sdkMap) sdkMap.destroy();
      if (base) base.remove();
      container.style.visibility = 'hidden';
      report('高德地图加载失败。请检查网络、Key 和高德控制台的域名配置。' + guide, 'error', callback);
    };
    const timer = global.setTimeout(failure, 15000);
    function startSdk() {
      if (destroyed || sdkMap) return;
      if (!global.AMap?.Map) { failure(); return; }
      try {
        base = document.createElement('div'); base.className = 'appraisal-amap-basemap';
        Object.assign(base.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none' });
        container.appendChild(base); container.style.background = 'transparent';
        const center = map.getCenter();
        sdkMap = new global.AMap.Map(base, { viewMode: '2D', center: toGcj(center.lng, center.lat), zoom: map.getZoom(), zooms: [3, 19], resizeEnable: true, animateEnable: false, dragEnable: false, zoomEnable: false, doubleClickZoom: false, keyboardEnable: false, rotateEnable: false, pitchEnable: false, showLabel: true });
        sync = () => { if (destroyed) return; try { const current = map.getCenter(); sdkMap.setZoomAndCenter(map.getZoom(), toGcj(current.lng, current.lat)); if (typeof sdkMap.resize === 'function') sdkMap.resize(); } catch (_) { failure(); } };
        map.on('move zoom resize', sync);
        sdkMap.on('error', failure);
        sdkMap.on('complete', () => {
          if (destroyed) return; settled = true; global.clearTimeout(timer);
          container.style.visibility = 'visible'; sync();
          if (!destroyed) report('高德地图已加载。', 'ok', callback);
        });
        map.on('unload', () => { if (destroyed) return; destroyed = true; global.clearTimeout(timer); map.off('move zoom resize', sync); sdkMap.destroy(); base.remove(); });
      } catch (_) { failure(); }
    }
    if (global.AMap?.Map) { startSdk(); return; }
    script = document.createElement('script'); script.async = true;
    script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(String(config.amapWebKey).trim());
    script.onload = startSdk; script.onerror = failure;
    global.addEventListener('error', event => {
      if (!settled && /INVALID_USER|USERKEY|AMap|amap/i.test(String(event.message || ''))) failure();
    });
    document.head.appendChild(script);
  }
  function createMap(id, options, config, callback) {
    const map = global.L.map(id, { ...options, crs: crs(), minZoom: 3, maxZoom: 19, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([30.25, 120.16], 9);
    mount(map, config, callback);
    return map;
  }
  global.AppraisalAmap = { configurationReady, watch, createMap, toGcj, fromGcj, report };
})(window);
