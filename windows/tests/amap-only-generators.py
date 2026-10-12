import json
import sys
import importlib.util
from pathlib import Path
from dataclasses import fields
from unittest.mock import patch

source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / 'skills/zj-land-publicity'))
import scrape_zj_land as land
import amap_support
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
config = {'amapEnabled': True, 'amapWebKey': 'synthetic-test-key'}
rows = [{'_coord': {'center': {'lat': 30.25, 'lng': 120.16}}, '_location': '人工测试位置', '_use': '工矿仓储'}]
basic = out / 'basic'
basic.mkdir(exist_ok=True)
with patch.object(land, 'load_map_config', return_value=config):
    land._build_basic_map_assets(rows, basic / 'basic.xlsx')

script = source / 'skills/anjuke-property-case-fetcher/scripts/fetch_anjuke_property_cases.py'
spec = importlib.util.spec_from_file_location('anjuke_amap_fixture', script)
anjuke = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = anjuke
spec.loader.exec_module(anjuke)
values = {f.name: None for f in fields(anjuke.CaseRow)}
values.update(case_number=1, source_url='https://hz.anjuke.com/synthetic', case_type='sale', title='人工案例', capture_status='ok', longitude=120.16, latitude=30.25)
row = anjuke.CaseRow(**values)
for enabled in (False, True):
    target = out / ('anjuke-configured' if enabled else 'anjuke-unconfigured')
    target.mkdir(exist_ok=True)
    fixture = config if enabled else {'amapEnabled': False, 'amapWebKey': ''}
    with patch.object(anjuke, 'load_map_config', return_value=fixture):
        anjuke.write_result_pages([row], target, [], 'completed', {}, '', source / 'native-helper/map-assets')
    html = (target / 'map.html').read_text(encoding='utf-8')
    assert 'AppraisalAmap.createMap' in html and 'amapSecurityJsCode' not in html
    assert 'tileProviders' not in html and 'arcgisonline' not in html

# Local synthetic files only. Existing user settings are never used.
fixture_path = out / 'synthetic-map-config.json'
cases = []
for enabled, key in [(False, ''), (True, 'fixture'), (True, '')]:
    fixture_path.write_text(json.dumps({'amap': {'enabled': enabled, 'webKey': key}}), encoding='utf-8')
    with patch.dict('os.environ', {'TIANYUAN_MAP_CONFIG_PATH': str(fixture_path)}):
        loaded = amap_support.load_map_config()
    assert loaded['amapEnabled'] == bool(enabled and key)
    cases.append({'enabled': enabled, 'keyPresent': bool(key), 'ready': loaded['amapEnabled']})
summary = {'ok': True, 'fixturesOnly': True, 'realConfigRead': False, 'basicMapGenerated': True, 'anjukeCases': 2, 'configurationCases': cases, 'browserUiCovered': False}
(out / 'generators-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
