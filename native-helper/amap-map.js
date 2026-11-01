'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { nativeHelperDataDirectory } = require('./runtime_paths.js');

function loadMapConfig() {
  const candidates = [process.env.TIANYUAN_MAP_CONFIG_PATH, path.join(nativeHelperDataDirectory(__dirname), '..', 'map-config.json'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'AppraisalToolbox/map-config.json'), path.join(os.homedir(), '.appraisal-toolbox/map-config.json')].filter(Boolean);
  for (const file of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')), amap = data?.amap || {};
      const enabled = amap.enabled === true, key = String(amap.webKey || amap.key || '').trim();
      return { amapEnabled: enabled && Boolean(key), amapWebKey: enabled ? key : '' };
    } catch (_) { /* Try the next local candidate. Never return raw config errors. */ }
  }
  return { amapEnabled: false, amapWebKey: '' };
}
function browserScript() {
  return fs.readFileSync(path.join(nativeHelperDataDirectory(__dirname), 'map-assets/amap-only.js'), 'utf8');
}
module.exports = { loadMapConfig, browserScript };
