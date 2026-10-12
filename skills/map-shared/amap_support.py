"""Shared local AMap settings and browser client for generated map pages."""
import json
import os
from pathlib import Path


def load_map_config():
    configured = str(os.environ.get('TIANYUAN_MAP_CONFIG_PATH', '')).strip()
    candidates = [Path(configured)] if configured else []
    if os.environ.get('APPRAISAL_TOOLBOX_ROOT'):
        candidates.append(Path(os.environ['APPRAISAL_TOOLBOX_ROOT']) / 'map-config.json')
    if os.environ.get('LOCALAPPDATA'):
        candidates.append(Path(os.environ['LOCALAPPDATA']) / 'AppraisalToolbox/map-config.json')
    candidates.append(Path.home() / '.appraisal-toolbox/map-config.json')
    for path in candidates:
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            amap = data.get('amap', {}) if isinstance(data, dict) else {}
            if not isinstance(amap, dict):
                amap = {}
            enabled = amap.get('enabled') is True
            key = str(amap.get('webKey') or amap.get('key') or '').strip()
            return {'amapEnabled': enabled and bool(key),
                    'amapWebKey': key if enabled else ''}
        except (OSError, ValueError):
            continue
    return {'amapEnabled': False, 'amapWebKey': ''}


def browser_script():
    path = Path(__file__).resolve().parents[2] / 'native-helper/map-assets/amap-only.js'
    return path.read_text(encoding='utf-8')
