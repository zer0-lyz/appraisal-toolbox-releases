/* Official AMap JS API frames share Leaflet's moving pane with case overlays. */
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
  function mount(map, config, callback, releaseControls) {
    mounted = true; global.clearTimeout(bootTimer);
    const container = map.getContainer(); container.style.visibility = 'hidden';
    if (!configurationReady(config)) { report('尚未配置高德地图。' + guide, 'warn', callback); return; }
    report('正在加载高德地图…', 'loading', callback);
    let script = null, settled = false, destroyed = false, initialized = false;
    let active = null, pending = null, moving = false, revision = 0;
    const pixelDensity = { x: 1, y: 1 };
    const frames = [], eventBindings = [];
    const pane = map.getPane('mapPane');
    const bind = (events, listener) => { map.on(events, listener); eventBindings.push([events, listener]); };
    function removeFrame(frame) {
      if (frame.raf) global.cancelAnimationFrame(frame.raf);
      if (frame.sdk) frame.sdk.destroy();
      frame.node.remove();
    }
    function cleanup() {
      global.clearTimeout(timer);
      for (const [events, listener] of eventBindings) map.off(events, listener);
      global.removeEventListener('error', scriptFailure);
      for (const frame of frames) removeFrame(frame);
      if (script) script.remove();
      releaseControls();
    }
    const failure = () => {
      if (destroyed) return;
      settled = true; destroyed = true; cleanup();
      container.style.visibility = 'hidden';
      report('高德地图加载失败。请检查网络、Key 和高德控制台的域名配置。' + guide, 'error', callback);
    };
    const timer = global.setTimeout(failure, 15000);
    function scriptFailure(event) {
      if (!settled && /INVALID_USER|USERKEY|AMap|amap/i.test(String(event.message || ''))) failure();
    }
    function place(frame) {
      if (!frame.center) return;
      const point = map.latLngToLayerPoint(frame.center);
      const scale = map.getZoomScale(map.getZoom(), frame.zoom);
      const geometry = frame.geometry || { x: frame.width / 2, y: frame.height / 2, scaleX: 1, scaleY: 1 };
      const scaleX = scale * geometry.scaleX, scaleY = scale * geometry.scaleY;
      const x = point.x - geometry.x * scaleX;
      const y = point.y - geometry.y * scaleY;
      frame.node.style.transform = `translate3d(${x}px,${y}px,0) scale(${scaleX},${scaleY})`;
    }
    function positionFrames() {
      if (destroyed) return;
      for (const frame of frames) place(frame);
    }
    function sdkCenter(frame) {
      const center = frame.sdk.getCenter();
      return [center.getLng(), center.getLat()];
    }
    function calibrate(frame) {
      const sdk = frame.sdk;
      if (typeof sdk.lngLatToContainer !== 'function' || typeof sdk.containerToLngLat !== 'function'
          || typeof global.AMap.Pixel !== 'function') return;
      const nativeCenter = sdk.getCenter(), origin = sdk.lngLatToContainer(nativeCenter);
      const x = typeof origin.getX === 'function' ? origin.getX() : origin.x;
      const y = typeof origin.getY === 'function' ? origin.getY() : origin.y;
      // Derive the actual SDK pixel scale rather than assuming that two map
      // engines assign identical resolution/origin to a zoom number.
      const east = sdk.containerToLngLat(new global.AMap.Pixel(x + 256, y));
      const south = sdk.containerToLngLat(new global.AMap.Pixel(x, y + 256));
      const projected = value => {
        const [lng, lat] = fromGcj(value.getLng(), value.getLat());
        return map.project(global.L.latLng(lat, lng), frame.zoom);
      };
      const centerPoint = projected(nativeCenter), eastPoint = projected(east), southPoint = projected(south);
      const scaleX = Number(((eastPoint.x - centerPoint.x) / 256).toPrecision(12));
      const scaleY = Number(((southPoint.y - centerPoint.y) / 256).toPrecision(12));
      if (![x, y, scaleX, scaleY].every(Number.isFinite) || scaleX < 0.125 || scaleY < 0.125
          || scaleX > 8 || scaleY > 8) throw new Error('AMap pixel projection is unavailable');
      frame.geometry = { x, y, scaleX, scaleY };
      pixelDensity.x = Math.min(1, scaleX); pixelDensity.y = Math.min(1, scaleY);
    }
    function schedulePublish(frame) {
      if (destroyed || pending !== frame || !frame.sdk || !frame.ready || !frame.request) return;
      if (frame.raf) global.cancelAnimationFrame(frame.raf);
      const expectedRevision = frame.request.revision;
      // Camera events precede a canvas paint. Keep the old, geographically
      // anchored frame visible until the replacement has had a render turn.
      frame.raf = global.requestAnimationFrame(() => {
        frame.raf = global.requestAnimationFrame(() => {
          frame.raf = null;
          if (destroyed || pending !== frame || frame.request.revision !== expectedRevision || moving) return;
          try {
            const requested = frame.request, actual = sdkCenter(frame);
            if (Math.abs(frame.sdk.getZoom() - requested.zoom) > 1e-7
                || Math.abs(actual[0] - requested.gcj[0]) > 1e-7
                || Math.abs(actual[1] - requested.gcj[1]) > 1e-7) return;
            if (typeof frame.sdk.getSize === 'function') {
              const size = frame.sdk.getSize();
              const width = typeof size.getWidth === 'function' ? size.getWidth() : size.width;
              const height = typeof size.getHeight === 'function' ? size.getHeight() : size.height;
              if (Math.abs(width - requested.width) > 1 || Math.abs(height - requested.height) > 1) return;
            }
            const [lng, lat] = fromGcj(actual[0], actual[1]);
            frame.center = global.L.latLng(lat, lng);
            frame.zoom = frame.sdk.getZoom();
            calibrate(frame);
            const viewport = map.getSize();
            if (frame.width < Math.ceil(viewport.x / pixelDensity.x) + 512
                || frame.height < Math.ceil(viewport.y / pixelDensity.y) + 512) { refresh(); return; }
            place(frame);
            if (active && active !== frame) active.node.style.visibility = 'hidden';
            active = frame; pending = null;
            frame.node.style.visibility = 'visible';
            settled = true; global.clearTimeout(timer);
            container.style.visibility = 'visible';
            report('高德地图已加载。', 'ok', callback);
          } catch (_) { failure(); }
        });
      });
    }
    function refresh() {
      if (destroyed || !initialized || moving) return;
      try {
        const size = map.getSize(), center = map.getCenter(), zoom = map.getZoom();
        // Overscan avoids a blank strip during an ordinary drag. The rendered
        // SDK camera stays frozen while its entire pane moves with the markers.
        const width = Math.ceil(Math.max(1, size.x) / pixelDensity.x) + 512;
        const height = Math.ceil(Math.max(1, size.y) / pixelDensity.y) + 512;
        const gcj = toGcj(center.lng, center.lat);
        const request = { zoom, gcj, width, height, revision: ++revision };
        const matches = frame => frame && frame.request
          && frame.request.zoom === zoom && frame.width === width && frame.height === height
          && Math.abs(frame.request.gcj[0] - gcj[0]) < 1e-10
          && Math.abs(frame.request.gcj[1] - gcj[1]) < 1e-10;
        if (matches(active) && !pending) { positionFrames(); return; }
        if (matches(pending)) { schedulePublish(pending); return; }
        let frame = pending || frames.find(candidate => candidate !== active);
        if (!frame) {
          const node = document.createElement('div'); node.className = 'appraisal-amap-basemap';
          Object.assign(node.style, { position: 'absolute', left: '0', top: '0', zIndex: '0',
            pointerEvents: 'none', transformOrigin: '0 0', visibility: 'hidden' });
          // Both basemap and marker/vector panes now inherit this exact same
          // Leaflet mapPane transform; no second camera follows every mousemove.
          pane.appendChild(node);
          frame = { node, sdk: null, ready: false, center: global.L.latLng(center.lat, center.lng), zoom, raf: null };
          frames.push(frame);
        }
        if (frame.sdk && (frame.width !== width || frame.height !== height)) {
          frame.sdk.destroy(); frame.sdk = null; frame.ready = false;
          frame.geometry = null;
        }
        pending = frame; frame.request = request; frame.width = width; frame.height = height;
        frame.center = global.L.latLng(center.lat, center.lng); frame.zoom = zoom;
        frame.node.style.visibility = 'hidden';
        frame.node.style.width = `${width}px`; frame.node.style.height = `${height}px`;
        place(frame);
        if (!frame.sdk) {
          frame.sdk = new global.AMap.Map(frame.node, { viewMode: '2D', center: gcj, zoom,
            zooms: [3, 19], resizeEnable: true, animateEnable: false, dragEnable: false,
            zoomEnable: false, doubleClickZoom: false, keyboardEnable: false,
            rotateEnable: false, pitchEnable: false, showLabel: true });
          const sdk = frame.sdk;
          sdk.on('error', () => { if (frame.sdk === sdk) failure(); });
          for (const event of ['complete', 'moveend', 'zoomend', 'resize']) {
            sdk.on(event, () => { if (frame.sdk !== sdk) return; if (event === 'complete') frame.ready = true; schedulePublish(frame); });
          }
        } else {
          if (typeof frame.sdk.resize === 'function') frame.sdk.resize();
          frame.sdk.setZoomAndCenter(zoom, gcj, true);
          schedulePublish(frame);
        }
      } catch (_) { failure(); }
    }
    function startSdk() {
      if (destroyed || initialized) return;
      if (!global.AMap?.Map) { failure(); return; }
      try {
        initialized = true; container.style.background = 'transparent';
        bind('move zoom resize', positionFrames);
        bind('movestart zoomstart', () => { moving = true; });
        bind('moveend zoomend', () => { moving = false; positionFrames(); refresh(); });
        bind('resize', refresh);
        bind('unload', () => { if (!destroyed) { destroyed = true; cleanup(); } });
        refresh();
      } catch (_) { failure(); }
    }
    if (global.AMap?.Map) { startSdk(); return; }
    script = document.createElement('script'); script.async = true;
    script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(String(config.amapWebKey).trim());
    script.onload = startSdk; script.onerror = failure;
    global.addEventListener('error', scriptFailure);
    document.head.appendChild(script);
  }
  function createMap(id, options, config, callback) {
    const map = global.L.map(id, { ...options, crs: crs(), minZoom: 3, maxZoom: 19, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([30.25, 120.16], 9);
    const container = map.getContainer();
    if (!document.getElementById('appraisal-map-interaction-style')) {
      const style = document.createElement('style'); style.id = 'appraisal-map-interaction-style';
      style.textContent = '.appraisal-amap-basemap{position:absolute!important;left:0!important;top:0!important;transform-origin:0 0!important}'
        + '.appraisal-amap-basemap,.appraisal-amap-basemap *{pointer-events:none!important}'
        + '.leaflet-top,.leaflet-bottom{z-index:1200!important}'
        + '.leaflet-control-zoom,.leaflet-control-zoom a{pointer-events:auto!important}';
      document.head.appendChild(style);
    }
    // Keep the map controls clear of the floating case list. All interactions
    // drive Leaflet's single logical view; the SDK owns only the frozen image.
    if (map.zoomControl) map.zoomControl.setPosition('bottomright');
    const clickZoom = event => {
      const button = event.target?.closest?.('a.leaflet-control-zoom-in,a.leaflet-control-zoom-out');
      if (!button || !container.contains(button)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (button.classList.contains('leaflet-disabled')) return;
      const delta = (map.options.zoomDelta || 1) * (event.shiftKey ? 3 : 1);
      const direction = button.classList.contains('leaflet-control-zoom-in') ? 1 : -1;
      map.setZoom(Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + direction * delta)));
    };
    container.addEventListener('click', clickZoom, true);
    mount(map, config, callback, () => container.removeEventListener('click', clickZoom, true));
    return map;
  }
  global.AppraisalAmap = { configurationReady, watch, createMap, toGcj, fromGcj, report,
    clientBuild: 'amap-shared-pane-20261012.1' };
})(window);
