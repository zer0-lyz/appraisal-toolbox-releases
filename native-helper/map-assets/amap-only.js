/* Official AMap JS API owns the camera and overlay pixel projection. */
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
      bounds: projection.bounds, MAX_LATITUDE: projection.MAX_LATITUDE,
      project(latlng) { const [lng, lat] = toGcj(latlng.lng, latlng.lat); return projection.project(global.L.latLng(lat, lng)); },
      unproject(point) { const converted = projection.unproject(point), [lng, lat] = fromGcj(converted.lng, converted.lat); return global.L.latLng(lat, lng); }
    } });
  }
  function createMap(id, options, config, callback) {
    // Leaflet is retained for case tools only. It never changes the camera.
    const map = global.L.map(id, { ...options, crs: crs(), minZoom: 3, maxZoom: 19,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false,
      boxZoom: false, keyboard: false, zoomAnimation: false, markerZoomAnimation: false,
      fadeAnimation: false }).setView([30.25, 120.16], 9);
    const container = map.getContainer();
    const base = {};
    for (const name of ['setView', 'panBy', 'invalidateSize', 'latLngToLayerPoint', 'layerPointToLatLng', 'getCenter', 'getZoom']) base[name] = map[name].bind(map);
    let sdk = null, ready = false, destroyed = false, syncing = false;
    let script = null, timer = null, observer = null, pendingBounds = null;
    const bindings = [];
    container.classList.add('appraisal-amap-camera');
    container.style.visibility = 'hidden';
    if (!document.getElementById('appraisal-map-interaction-style')) {
      const style = document.createElement('style'); style.id = 'appraisal-map-interaction-style';
      style.textContent = '.appraisal-amap-camera>.appraisal-amap-camera-surface{position:absolute!important;inset:0!important;z-index:0;transform:none!important}'
        + '.appraisal-amap-camera .leaflet-pane,.appraisal-amap-camera .leaflet-pane canvas,.appraisal-amap-camera .leaflet-pane svg{pointer-events:none!important}'
        + '.appraisal-amap-camera .leaflet-marker-icon,.appraisal-amap-camera .leaflet-interactive:not(canvas),.appraisal-amap-camera .leaflet-popup{pointer-events:auto!important}'
        + '.leaflet-top,.leaflet-bottom{z-index:1200!important}.leaflet-control-zoom,.leaflet-control-zoom a{pointer-events:auto!important}';
      document.head.appendChild(style);
    }
    if (map.zoomControl) map.zoomControl.setPosition('bottomright');
    const surface = document.createElement('div'); surface.className = 'appraisal-amap-camera-surface';
    container.insertBefore(surface, container.firstChild);
    const sdkLatLng = value => {
      const [lng, lat] = fromGcj(value.getLng(), value.getLat());
      return global.L.latLng(lat, lng);
    };
    const gcjPosition = value => { const point = global.L.latLng(value); return toGcj(point.lng, point.lat); };
    const pixelValue = (value, axis) => typeof value[axis === 'x' ? 'getX' : 'getY'] === 'function'
      ? value[axis === 'x' ? 'getX' : 'getY']() : value[axis];
    // Both forward and reverse positions come from the live official camera.
    // No Mercator scale guesses, CSS scaled canvases or second SDK frame exist.
    map.latLngToLayerPoint = value => {
      if (!ready) return base.latLngToLayerPoint(value);
      const [lng, lat] = gcjPosition(value);
      const pixel = sdk.lngLatToContainer(new global.AMap.LngLat(lng, lat));
      return map.containerPointToLayerPoint(global.L.point(pixelValue(pixel, 'x'), pixelValue(pixel, 'y')));
    };
    map.layerPointToLatLng = value => {
      if (!ready) return base.layerPointToLatLng(value);
      const pixel = map.layerPointToContainerPoint(value);
      return sdkLatLng(sdk.containerToLngLat(new global.AMap.Pixel(pixel.x, pixel.y)));
    };
    map.getCenter = () => ready ? sdkLatLng(sdk.getCenter()) : base.getCenter();
    map.getZoom = () => ready ? sdk.getZoom() : base.getZoom();
    function syncOverlays() {
      if (!ready || destroyed || syncing) return;
      syncing = true;
      try {
        // A transient SDK reading (mid-gesture) can be null/NaN; skipping one
        // sync is always cheaper than feeding a poisoned view into Leaflet.
        const rawCenter = sdk.getCenter(), rawZoom = sdk.getZoom();
        if (!rawCenter || !Number.isFinite(rawCenter.getLng()) || !Number.isFinite(rawCenter.getLat()) || !Number.isFinite(rawZoom) || rawZoom < 3 || rawZoom > 19) return;
        // Reset the overlay origin before every redraw. Paths, labels, popups,
        // clusters and drag inverse projection use the same SDK pixel methods.
        map._resetView(sdkLatLng(rawCenter), Number(rawZoom));
      } catch (error) {
        // Never let a sync exception break the official camera's event dispatch.
      } finally { syncing = false; }
    }
    function setCamera(center, zoom) {
      if (destroyed) return map;
      if (zoom === undefined) zoom = map.getZoom();
      if (typeof zoom !== "number" || !Number.isFinite(zoom)) return map;
      zoom = Math.max(3, Math.min(19, zoom));
      if (!ready) { pendingBounds = null; base.setView(center, zoom, { animate: false }); return map; }
      sdk.setZoomAndCenter(zoom, gcjPosition(center), true);
      syncOverlays();
      return map;
    }
    map.setView = (center, zoom) => setCamera(center, zoom);
    map.setZoom = zoom => setCamera(map.getCenter(), zoom);
    map.panTo = center => setCamera(center, map.getZoom());
    map.flyTo = (center, zoom) => setCamera(center, zoom);
    map.panBy = offset => {
      if (!ready) return base.panBy(offset, { animate: false });
      const size = map.getSize(), delta = global.L.point(offset);
      const center = sdk.containerToLngLat(new global.AMap.Pixel(size.x / 2 + delta.x, size.y / 2 + delta.y));
      return setCamera(sdkLatLng(center), map.getZoom());
    };
    function fitSdkBounds(bounds, fitOptions) {
      const southwest = gcjPosition(bounds.getSouthWest()), northeast = gcjPosition(bounds.getNorthEast());
      const common = global.L.point(fitOptions.padding || [0, 0]);
      const tl = global.L.point(fitOptions.paddingTopLeft || common), br = global.L.point(fitOptions.paddingBottomRight || common);
      // Official JSAPI order: top, bottom, left, right.
      sdk.setBounds(new global.AMap.Bounds(southwest, northeast), true, [tl.y, br.y, tl.x, br.x]);
      if (Number.isFinite(fitOptions.maxZoom) && sdk.getZoom() > fitOptions.maxZoom) sdk.setZoom(fitOptions.maxZoom, true);
      syncOverlays();
    }
    map.fitBounds = (value, fitOptions = {}) => {
      const bounds = global.L.latLngBounds(value);
      if (!bounds.isValid()) throw new Error('Bounds are not valid.');
      if (ready) fitSdkBounds(bounds, fitOptions);
      else {
        const view = map._getBoundsCenterZoom(bounds, fitOptions);
        base.setView(view.center, view.zoom, { animate: false });
        pendingBounds = { bounds, options: fitOptions };
      }
      return map;
    };
    map.flyToBounds = map.fitBounds;
    map.invalidateSize = () => {
      base.invalidateSize({ pan: false, animate: false });
      if (ready) { if (typeof sdk.resize === 'function') sdk.resize(); syncOverlays(); }
      return map;
    };
    // Leaflet still delegates marker/popup DOM events; the official SDK handles
    // background clicks. Filtering avoids duplicate placement and drag clicks.
    map._initEvents(true);
    const leafletEvent = map._handleDOMEvent;
    map._handleDOMEvent = function(event) {
      if (!ready || event.target?.closest?.('.leaflet-marker-icon,.leaflet-interactive,.leaflet-popup,.leaflet-tooltip')) leafletEvent.call(this, event);
    };
    map._initEvents();
    const clickZoom = event => {
      const button = event.target?.closest?.('a.leaflet-control-zoom-in,a.leaflet-control-zoom-out');
      if (!button || !container.contains(button)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!ready || destroyed || button.classList.contains('leaflet-disabled')) return;
      if (!Number.isFinite(sdk.getZoom())) return;
      const delta = (map.options.zoomDelta || 1) * (event.shiftKey ? 3 : 1);
      map.setZoom(sdk.getZoom() + (button.classList.contains('leaflet-control-zoom-in') ? delta : -delta));
    };
    container.addEventListener('click', clickZoom, true);
    // Native AMap 2.0 double-click zoom corrupts the map's internal center in
    // this configuration (getCenter() returns LngLat(NaN,NaN) permanently), so
    // it is disabled and the bridge routes the gesture through setCamera.
    let wheelAccum = 0, wheelTimer = null, wheelEvent = null, wheelLastEvent = 0;
    const clientPixel = event => {
      const rect = container.getBoundingClientRect();
      return new global.AMap.Pixel(event.clientX - rect.left, event.clientY - rect.top);
    };
    const overUi = event => Boolean(event.target?.closest?.('.leaflet-control,.leaflet-popup,.leaflet-tooltip,.amap-control,.amap-logo,.amap-copyright,input,textarea,select,button,a,[role="button"],[data-map-control]'));
    function zoomAtPixel(pixel, level) {
      const zoom = sdk.getZoom(), center = sdk.getCenter();
      if (!Number.isFinite(zoom) || !center || !Number.isFinite(center.getLng()) || !Number.isFinite(center.getLat()) || !Number.isFinite(level)) return;
      const target = sdk.containerToLngLat(pixel);
      if (!target || !Number.isFinite(target.getLng()) || !Number.isFinite(target.getLat())) return;
      level = Math.max(3, Math.min(19, level));
      if (level === zoom) return;
      // Preserve the cursor anchor using live SDK projection after zoom. No scale guesses.
      sdk.setZoomAndCenter(level, [center.getLng(), center.getLat()], true);
      const projected = sdk.lngLatToContainer(target), size = map.getSize();
      const corrected = sdk.containerToLngLat(new global.AMap.Pixel(size.x/2 + pixelValue(projected, 'x') - pixelValue(pixel, 'x'), size.y/2 + pixelValue(projected, 'y') - pixelValue(pixel, 'y')));
      if (corrected && Number.isFinite(corrected.getLng()) && Number.isFinite(corrected.getLat())) sdk.setZoomAndCenter(level, [corrected.getLng(), corrected.getLat()], true);
      syncOverlays();
    }
    const flushWheel = () => {
      const delta = wheelAccum, event = wheelEvent;
      wheelTimer = null;
      // Retain subthreshold trackpad increments across nearby bursts; expire on next gesture.
      if (ready && !destroyed && event && Math.abs(delta) < 40) return;
      wheelAccum = 0; wheelEvent = null; wheelTimer = null;
      if (!ready || destroyed || !event || Math.abs(delta) < 40) return;
      try { zoomAtPixel(clientPixel(event), sdk.getZoom() + (delta < 0 ? 1 : -1) * (map.options.zoomDelta || 1) * (event.shiftKey ? 3 : 1)); } catch (_) { /* next gesture can retry */ }
    };
    const wheelZoom = event => {
      if (!ready || destroyed || overUi(event) || event.ctrlKey) return;
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
      if (!Number.isFinite(amount) || amount === 0) return;
      event.preventDefault(); event.stopPropagation();
      if (Date.now() - wheelLastEvent > 500) wheelAccum = 0;
      wheelLastEvent = Date.now();
      if (Math.sign(amount) !== Math.sign(wheelAccum) && wheelAccum !== 0) wheelAccum = 0;
      wheelAccum += amount; wheelEvent = event;
      if (!wheelTimer) wheelTimer = global.setTimeout(flushWheel, 120);
    };
    const dblClickZoom = event => {
      if (!ready || destroyed || overUi(event) || event.target?.closest?.('.leaflet-marker-icon,.leaflet-interactive')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { zoomAtPixel(clientPixel(event), sdk.getZoom() + (map.options.zoomDelta || 1) * (event.shiftKey ? -1 : 1)); } catch (_) { /* next gesture can retry */ }
    };
    container.addEventListener('wheel', wheelZoom, { passive: false, capture: true });
    container.addEventListener('dblclick', dblClickZoom, true);
    function cleanup() {
      global.clearTimeout(timer); global.clearTimeout(bootTimer); global.clearTimeout(wheelTimer);
      wheelAccum = 0; wheelEvent = null; wheelTimer = null;
      observer?.disconnect();
      container.removeEventListener('click', clickZoom, true);
      container.removeEventListener('wheel', wheelZoom, { capture: true });
      container.removeEventListener('dblclick', dblClickZoom, true);
      global.removeEventListener('error', scriptFailure);
      for (const [event, listener] of bindings) sdk?.off(event, listener);
      if (sdk) sdk.destroy();
      sdk = null; ready = false; surface.remove(); script?.remove();
    }
    function fail() {
      if (destroyed) return;
      destroyed = true; cleanup(); container.style.visibility = 'hidden';
      report('高德地图加载失败。请检查网络、Key 和高德控制台的域名配置。' + guide, 'error', callback);
    }
    function scriptFailure(event) {
      if (!ready && /INVALID_USER|USERKEY|AMap|amap/i.test(String(event.message || ''))) fail();
    }
    const listen = (event, listener) => {
      const wrapped = (...args) => { try { listener(...args); } catch (_) { /* next sync recovers */ } };
      sdk.on(event, wrapped); bindings.push([event, wrapped]);
    };
    function startSdk() {
      if (destroyed || sdk) return;
      if (!global.AMap?.Map) { fail(); return; }
      try {
        sdk = new global.AMap.Map(surface, { viewMode: '2D', center: gcjPosition(base.getCenter()), zoom: base.getZoom(),
          zooms: [3, 19], resizeEnable: true, animateEnable: false, dragEnable: true,
          zoomEnable: true, doubleClickZoom: false, keyboardEnable: true,
          rotateEnable: false, pitchEnable: false, showLabel: true });
        listen('complete', () => {
          if (destroyed || ready) return;
          ready = true; global.clearTimeout(timer);
          syncOverlays();
          if (pendingBounds) { const pending = pendingBounds; pendingBounds = null; fitSdkBounds(pending.bounds, pending.options); }
          container.style.visibility = 'visible'; report('高德地图已加载。', 'ok', callback);
        });
        for (const event of ['mapmove', 'zoomchange', 'moveend', 'zoomend', 'resize']) listen(event, syncOverlays);
        listen('click', event => {
          if (!ready || destroyed || !event.lnglat) return;
          const latlng = sdkLatLng(event.lnglat), containerPoint = map.latLngToContainerPoint(latlng);
          map.fire('click', { latlng, containerPoint, layerPoint: map.containerPointToLayerPoint(containerPoint), originalEvent: event.originEvent });
        });
        listen('error', fail);
        if (global.ResizeObserver) { observer = new global.ResizeObserver(() => map.invalidateSize()); observer.observe(container); }
      } catch (_) { fail(); }
    }
    map.on('unload', () => { if (!destroyed) { destroyed = true; cleanup(); } });
    mounted = true; global.clearTimeout(bootTimer);
    if (!configurationReady(config)) { report('尚未配置高德地图。' + guide, 'warn', callback); return map; }
    report('正在加载高德地图…', 'loading', callback);
    timer = global.setTimeout(fail, 15000);
    if (global.AMap?.Map) startSdk();
    else {
      script = document.createElement('script'); script.async = true;
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(String(config.amapWebKey).trim());
      script.onload = startSdk; script.onerror = fail;
      global.addEventListener('error', scriptFailure); document.head.appendChild(script);
    }
    return map;
  }
  global.AppraisalAmap = { configurationReady, watch, createMap, toGcj, fromGcj, report,
    clientBuild: 'amap-single-camera-20261013.3' };
})(window);
