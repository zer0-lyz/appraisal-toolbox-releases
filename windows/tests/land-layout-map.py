import json
import sys
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / "skills" / "zj-land-publicity"))
import scrape_zj_land as maps
import land_publicity_runner as runner

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
shell = (source / "src" / "shell" / "index.html").read_text(encoding="utf-8")
assert 'id="landPublicityHealth"' not in shell
rows = [{"sourceCode": "fixture-1", "districtName": "萧山区", "_location": "人工测试位置", "_use": "工矿仓储", "_coord": {"center": {"lat": 30.1, "lng": 120.2}}}]
request = runner.validate_request({"district": "杭州市", "startDate": "2026-07-01", "endDate": "2026-10-09", "outputDirectory": str(out), "generateMap": True, "maxPages": 200})
runner.write_result_html(out / "result.html", [{"公示编号": "fixture-1", "坐标纬度": 30.1, "坐标经度": 120.2}], request, {"written": 1}, {"excel": "result.xlsx", "map": "result_map.html"})
html = (out / "result.html").read_text(encoding="utf-8")
assert "max-width:1440px" not in html
assert "main{width:100%" in html and "box-sizing:inherit" in html
assert "height:clamp(360px,50dvh,720px)" in html
assert ".detail-toolbar{flex-wrap:wrap}" in html
assert 'event.source !== frame?.contentWindow' in html
assert "地图基础配置" in html
cases = []
for configured in (False, True):
    folder = out / ("configured" if configured else "unconfigured")
    folder.mkdir(exist_ok=True)
    # Synthetic fixture only; no real map configuration is read.
    with patch.object(maps, "load_map_config", return_value={"amapEnabled": configured, "amapWebKey": "synthetic-test-key" if configured else ""}):
        result = maps.build_map_assets(rows, folder / "result.xlsx")
    text = Path(result["map_html"]).read_text(encoding="utf-8")
    assert "__MAP_NOTICE_HIDDEN__" not in text
    notice = text.split('id="map-setup-notice"', 1)[1].split(">", 1)[0]
    assert (" hidden" in notice) == configured
    assert "subdomains: provider.subdomains || undefined" not in text
    assert "AppraisalAmap.createMap" in text
    assert "webapi.amap.com/maps?v=2.0&key=" in text
    assert "bottom:48px" not in text
    assert "top:10px" in text
    assert "tileProviders" not in text and "arcgisonline" not in text
    assert "AppraisalAmap.watch" in text and "if (!window.L)" in text
    assert "window.parent !== window" in text and "notice.hidden = embedded" in text
    cases.append({"configured": configured, "immediateConfigurationNotice": not configured, "componentAndTileFailureGuidance": True})
summary = {"ok": True, "fixturesOnly": True, "realConfigRead": False, "responsiveCssRules": True, "cases": cases, "browserUiCovered": False}
(out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
