"""抓取浙江自然资源土地成交公示（通用版，支持任意行政区）"""
import requests

import land_http
import re
import openpyxl
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter
import time
import os
import sys
import json
import argparse
from pathlib import Path
from urllib.parse import urlencode

# ============================================================
#  坐标提取相关（可选，依赖 PyMuPDF + 图像模型）
# ============================================================
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'map-shared'))
from amap_support import load_map_config, browser_script


def fetch_attachment_list(source_id):
    """获取地块的附件列表（出让公告、宗地界址图等）

    Args:
        source_id: 地块资源ID（即 sourceId）

    Returns:
        list: 附件记录列表，每条含 fileName, fileId, fileType, url 等
    """
    url = (
        f"https://www.zjzrzyjy.com/trade/view/landbidding/queryLandResourceUploadFile"
        f"?resourceId={source_id}&fileType=XZWJ&currentPage=1&pageSize=200"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": f"https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={source_id}"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=20)
        data = resp.json()
        records = data.get('data', {}).get('records', [])
        result = []
        for r in records:
            # 优先从 fileContent JSON 中取 url
            file_content_str = r.get('fileContent', '')
            if file_content_str:
                try:
                    fc = json.loads(file_content_str)
                    if isinstance(fc, list) and fc:
                        first = fc[0]
                        file_url = first.get('url', '')
                        if file_url:
                            result.append({
                                'fileName': r.get('fileName', ''),
                                'fileId': first.get('id', '') or r.get('fileId', ''),
                                'dataType': r.get('dataType', ''),
                                'url': file_url,
                            })
                            continue
                except (json.JSONDecodeError, IndexError):
                    pass
            # 兜底：从 r 直接取
            result.append({
                'fileName': r.get('fileName', ''),
                'fileId': r.get('fileId', ''),
                'dataType': r.get('dataType', ''),
                'url': r.get('url', ''),
            })
        return result
    except Exception as e:
        print(f"  [附件] 请求失败: {e}")
        return []


def download_pdf(url, output_path, timeout=30):
    """下载 PDF 文件"""
    try:
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        if resp.status_code == 200 and len(resp.content) > 1000:
            with open(output_path, 'wb') as f:
                f.write(resp.content)
            return True
    except Exception:
        pass
    return False


def extract_coordinates_from_pdf(pdf_path):
    """从勘测定界图 PDF 中提取地块边界坐标

    原理：PDF 为矢量/图像混合，先用 PyMuPDF 渲染为图像，
          再通过图像模型识别 X/Y 坐标值。

    Args:
        pdf_path: PDF 文件本地路径

    Returns:
        dict: {
            'status': 'ok'|'error'|'no_coord',
            'coords': [(x, y), ...]  # CGCS2000 坐标系坐标列表
            'area': float  # 公顷
            'scale': str   # 比例尺
            'note': str    # 说明
        }
    """
    if not PYMUPDF_AVAILABLE:
        return {'status': 'error', 'note': 'PyMuPDF 未安装'}

    if not os.path.exists(pdf_path):
        return {'status': 'error', 'note': 'PDF 文件不存在'}

    try:
        doc = fitz.open(pdf_path)
        page = doc[0]

        # 渲染为高分辨率图像
        mat = fitz.Matrix(3, 3)  # 3x 缩放，提高文字清晰度
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        img_path = pdf_path + ".png"
        with open(img_path, 'wb') as f:
            f.write(img_bytes)

        doc.close()
        return {
            'status': 'ok',
            'note': f'已渲染为图像: {img_path}，请调用图像模型提取坐标',
            'rendered_image': img_path,
            'pixel_size': f'{pix.width}x{pix.height}',
        }
    except Exception as e:
        return {'status': 'error', 'note': str(e)}


def fetch_resource_detail(source_id):
    """获取地块详情接口数据，包含 resourceCoordinate 等字段"""
    url = f"https://www.zjzrzyjy.com/trade/view/landbidding/queryResourceDetail?resourceId={source_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": f"https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={source_id}"
    }
    for attempt in range(1, 4):
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            return resp.json().get('data', {}) or {}
        except Exception as e:
            if attempt == 3:
                print(f"  [详情] 请求失败: {e}")
                return {}
            time.sleep(0.5)


def normalize_resource_coordinate(raw):
    """把 resourceCoordinate 规范化为 dict。"""
    if not raw:
        return {}
    if isinstance(raw, dict):
        coord = raw
    else:
        try:
            coord = json.loads(raw)
        except Exception:
            return {}
    if not isinstance(coord, dict):
        return {}

    center = coord.get('center') or {}
    point_groups = coord.get('pointGroups') or []
    point_count = 0
    for group in point_groups:
        point_count += len(group.get('points') or [])
    coord['point_count'] = point_count
    coord['group_count'] = len(point_groups)
    coord['center'] = center
    coord['pointGroups'] = point_groups
    return coord


def _build_basic_map_assets(rows, output_path):
    """按 resourceCoordinate 生成 JSON / JS / HTML 地图文件。"""
    base = Path(output_path)
    stem = base.with_suffix('')
    coord_json = stem.as_posix() + "_coords.json"
    points_js = stem.as_posix() + "_points.js"
    map_html = stem.as_posix() + "_map.html"

    points = []
    for r in rows:
        coord = r.get('_coord', {})
        center = coord.get('center') or {}
        lng = center.get('lng')
        lat = center.get('lat')
        if lng in (None, '') or lat in (None, ''):
            continue
        points.append({
            'name': r.get('sourceCode', ''),
            'district': r.get('districtName', ''),
            'date': r.get('releaseTime', ''),
            'url': r.get('_detail_url', ''),
            'location': r.get('_location', ''),
            'center': [lng, lat],
            'origin': [center.get('originLng', ''), center.get('originLat', '')],
            'area_mu': r.get('_area_mu', ''),
            'use': r.get('_use', ''),
            'startUnitPriceYuanSqm': r.get('_start_unit_price', ''),
            'startTotalPriceWan': r.get('_start_total_price_wan', ''),
            'dealUnitPriceYuanSqm': r.get('_deal_unit_price', ''),
            'dealTotalPriceWan': r.get('_deal_total_price_wan', ''),
            'assignmentAreaSqm': r.get('_assignment_area_sqm', ''),
            'pointCount': coord.get('point_count', 0),
            'groupCount': coord.get('group_count', 0),
        })

    with open(coord_json, 'w', encoding='utf-8') as f:
        json.dump(points, f, ensure_ascii=False, indent=2)

    with open(points_js, 'w', encoding='utf-8') as f:
        f.write("window.ZJ_LAND_POINTS = ")
        json.dump(points, f, ensure_ascii=False, separators=(',', ':'))
        f.write(";\n")

    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>浙江土地成交坐标地图</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
  <style>
    html, body {{ height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    #map {{ height: 100%; width: 100%; }}
    .panel {{
      position: absolute; z-index: 1000; top: 12px; left: 12px; background: rgba(255,255,255,.95);
      padding: 12px 14px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.15);
      max-width: 360px; line-height: 1.5;
    }}
    .panel h1 {{ margin: 0 0 6px; font-size: 16px; }}
    .panel .sub {{ color: #555; font-size: 12px; }}
    .popup-title {{ font-weight: 700; margin-bottom: 6px; }}
    .popup-meta {{ font-size: 12px; color: #444; line-height: 1.4; }}
    .tile-status {{ position: fixed; z-index: 1100; right: 12px; bottom: 12px; max-width: min(360px, calc(100vw - 24px)); padding: 6px 9px; border-radius: 7px; background: rgba(255,255,255,.94); color: #475569; box-shadow: 0 3px 12px rgba(15,23,42,.14); font-size: 11px; }}
    .tile-status[data-kind="ok"] {{ display: none; }}
    .tile-status[data-kind="error"] {{ color: #b91c1c; }}
    a {{ color: #0a58ca; text-decoration: none; }}
  </style>
</head>
<body>
  <div class="panel">
    <h1>浙江土地成交坐标地图</h1>
    <div class="sub">共 {len(points)} 宗可定位地块。</div>
    <div class="sub">标注点为 `resourceCoordinate.center`。</div>
  </div>
  <div id="map"></div>
  <script>{browser_script()}
const MAP_CONFIG = {json.dumps(load_map_config(), ensure_ascii=False).replace('<', chr(92) + 'u003c')};
AppraisalAmap.watch(MAP_CONFIG);</script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script src="./{Path(points_js).name}"></script>
  <script>
    if (!window.L) {{ AppraisalAmap.report('地图组件未能加载，请检查网络后刷新页面。'); }} else {{
    const map = AppraisalAmap.createMap('map', {{ preferCanvas: true }}, MAP_CONFIG).setView([29.2, 120.2], 8);
    const cluster = typeof L.markerClusterGroup === 'function'
      ? L.markerClusterGroup({{ disableClusteringAtZoom: 16 }})
      : L.layerGroup();
    const bounds = [];

    function esc(s) {{
      return String(s ?? '').replace(/[&<>"']/g, m => ({{'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}}[m]));
    }}

    for (const p of window.ZJ_LAND_POINTS || []) {{
      const latlng = [Number(p.center[1]), Number(p.center[0])];
      if (!Number.isFinite(latlng[0]) || !Number.isFinite(latlng[1])) continue;
      bounds.push(latlng);
      const marker = L.marker(latlng);
      marker.bindPopup(`
        <div class="popup-title">${{esc(p.name)}}</div>
        <div class="popup-meta">
          行政区：${{esc(p.district)}}<br/>
          发布时间：${{esc(p.date)}}<br/>
          地块位置：${{esc(p.location)}}<br/>
          坐标中心：${{esc(p.center[0])}}, ${{esc(p.center[1])}}<br/>
          原始坐标：${{esc(p.origin[0])}}, ${{esc(p.origin[1])}}<br/>
          用地信息：${{esc(p.use)}}<br/>
          出让面积：${{esc(p.area_mu)}} 亩<br/>
          成交单价：${{esc(p.dealUnitPriceYuanSqm)}} 元/平方米<br/>
          成交总价：${{esc(p.dealTotalPriceWan)}} 万元<br/>
          边界点：${{esc(p.pointCount)}} 个，分 ${{esc(p.groupCount)}} 组<br/>
          <a href="${{esc(p.url)}}" target="_blank" rel="noreferrer">打开详情页</a>
        </div>
      `);
      cluster.addLayer(marker);
    }}

    map.addLayer(cluster);
    if (bounds.length) {{
      map.fitBounds(bounds, {{ padding: [30, 30] }});
    }}
    }}
  </script>
</body>
</html>
"""
    with open(map_html, 'w', encoding='utf-8') as f:
        f.write(html)

    return {
        'coord_json': coord_json,
        'points_js': points_js,
        'map_html': map_html,
        'point_count': len(points),
    }


def build_map_assets(rows, output_path):
    """生成参考青州地图风格的交互地图，同时保留现有资产文件契约。"""
    base = Path(output_path)
    stem = base.with_suffix('')
    coord_json = stem.as_posix() + "_coords.json"
    points_js = stem.as_posix() + "_points.js"
    map_html = stem.as_posix() + "_map.html"

    color_rules = [
        {"label": "工业/仓储", "color": "#2b6cb0"},
        {"label": "住宅", "color": "#c53030"},
        {"label": "商服", "color": "#2f855a"},
        {"label": "办公/商务", "color": "#6b46c1"},
        {"label": "其他", "color": "#b7791f"},
    ]

    def text(value):
        return str(value or "").strip()

    def number(value):
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed == parsed else None

    def number_text(value):
        parsed = number(value)
        if parsed is None:
            return text(value)
        if parsed.is_integer():
            return f"{int(parsed):,}"
        return f"{parsed:,.2f}".rstrip("0").rstrip(".")

    def summarize_location(value):
        location = text(value)
        if not location:
            return "未填写位置"
        matched = re.search(r"(.+?(?:交叉口|交汇处|十字路口).{0,8})", location)
        if matched:
            return matched.group(1)
        for separator in ("，", ",", "、", "；", ";"):
            if separator in location:
                return location.split(separator, 1)[0]
        return location if len(location) <= 18 else location[:18] + "..."

    def color_for(use):
        value = text(use)
        if any(keyword in value for keyword in ("住宅", "居住")):
            return "#c53030"
        if any(keyword in value for keyword in ("商服", "商业", "商住")):
            return "#2f855a"
        if any(keyword in value for keyword in ("办公", "商务", "金融")):
            return "#6b46c1"
        if any(keyword in value for keyword in ("工业", "工矿", "仓储")):
            return "#2b6cb0"
        return "#b7791f"

    def map_item(row):
        coord = row.get('_coord') or {}
        center = coord.get('center') or {}
        return {
            'sourceCode': text(row.get('sourceCode')),
            'district': text(row.get('districtName')),
            'date': text(row.get('releaseTime')),
            'url': text(row.get('_detail_url')),
            'location': text(row.get('_location')),
            'landUse': text(row.get('_use')),
            'tradeMethod': text(row.get('_trade_method')),
            'areaMu': row.get('_area_mu', ''),
            'areaSqm': row.get('_assignment_area_sqm', ''),
            'startUnitPriceYuanSqm': row.get('_start_unit_price', ''),
            'startTotalPriceWan': row.get('_start_total_price_wan', ''),
            'dealUnitPriceYuanSqm': row.get('_deal_unit_price', ''),
            'dealTotalPriceWan': row.get('_deal_total_price_wan', ''),
            'coordType': text(coord.get('locationType')),
            'originLng': center.get('originLng', ''),
            'originLat': center.get('originLat', ''),
            'pointCount': coord.get('point_count', 0),
            'groupCount': coord.get('group_count', 0),
        }

    def price_text(items):
        prices = [number(item.get('dealUnitPriceYuanSqm')) for item in items]
        prices = [value for value in prices if value is not None and value > 0]
        if not prices:
            return "暂无成交单价"
        low, high = min(prices), max(prices)
        if abs(low - high) < 0.000001:
            return f"{number_text(low)} 元/㎡"
        return f"{number_text(low)}~{number_text(high)} 元/㎡"

    grouped = {}
    unlocated = []
    located_count = 0
    for row in rows:
        coord = row.get('_coord') or {}
        center = coord.get('center') or {}
        lng = number(center.get('lng'))
        lat = number(center.get('lat'))
        item = map_item(row)
        if lng is None or lat is None:
            unlocated.append(item)
            continue
        located_count += 1
        grouped.setdefault((round(lat, 6), round(lng, 6)), []).append(item)

    points = []
    for (lat, lng), items in grouped.items():
        first = items[0]
        land_uses = list(dict.fromkeys(item['landUse'] for item in items if item['landUse']))
        location = first['location'] or first['sourceCode'] or "未填写位置"
        points.append({
            'lat': lat,
            'lon': lng,
            'color': color_for(first['landUse']),
            'labelTitle': summarize_location(location),
            'labelPrice': price_text(items),
            'labelCount': len(items),
            'labelLandUse': "、".join(land_uses[:2]) or "未分类",
            'labelDate': first['date'],
            'title': f"{first['landUse']} · {location}",
            'items': items[:50],
        })

    unique_locations = {text(row.get('_location')) for row in rows if text(row.get('_location'))}
    if points:
        center_lat = sum(point['lat'] for point in points) / len(points)
        center_lng = sum(point['lon'] for point in points) / len(points)
    else:
        center_lat, center_lng = 29.2, 120.2
    payload = {
        'stats': {'总记录': len(rows), '已定位': located_count, '未定位': len(unlocated), '唯一位置': len(unique_locations)},
        'displayStats': {'展示点位': len(points), '定位记录': located_count},
        'mapConfig': load_map_config(),
        'legend': color_rules,
        'points': points,
        'unlocated': unlocated,
        'center': {'lat': center_lat, 'lon': center_lng},
    }

    with open(coord_json, 'w', encoding='utf-8') as f:
        json.dump(points, f, ensure_ascii=False, indent=2)
    with open(points_js, 'w', encoding='utf-8') as f:
        f.write("window.ZJ_LAND_POINTS = ")
        json.dump(points, f, ensure_ascii=False, separators=(',', ':'))
        f.write(";\n")

    payload_json = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>浙江土地成交公示地图</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    #map { position: absolute; inset: 0; }
    .legend-panel { position: absolute; z-index: 1000; top: 12px; right: 12px; max-width: min(560px, calc(100vw - 320px)); background: rgba(255,255,255,.94); border-radius: 10px; padding: 7px 9px; box-shadow: 0 4px 14px rgba(0,0,0,.10); }
    .legend { display: flex; flex-wrap: wrap; gap: 7px 10px; }
    .legend-item { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: #2d3748; }
    .legend-swatch { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .map-tool-row { display: flex; gap: 5px; margin-top: 7px; }
    .map-tool { border: 1px solid #cbd5e0; border-radius: 7px; padding: 4px 7px; background: #fff; color: #1e3a8a; font-size: 10px; cursor: pointer; }
    .map-tool:hover, .map-tool.active { border-color: #2563eb; background: #eff6ff; }
    .map-tool:disabled { opacity: .5; cursor: default; }
    .map-tool-status { margin-top: 5px; color: #64748b; font-size: 10px; line-height: 1.35; }
    .tile-status { position: fixed; z-index: 1100; right: 12px; bottom: 12px; max-width: min(360px, calc(100vw - 24px)); padding: 6px 9px; border-radius: 7px; background: rgba(255,255,255,.94); color: #475569; box-shadow: 0 3px 12px rgba(15,23,42,.14); font-size: 11px; }
    .tile-status[data-kind="ok"] { display: none; }
    .tile-status[data-kind="error"] { color: #b91c1c; }
    .reference-marker-list { display: flex; flex-direction: column; gap: 3px; max-height: 130px; overflow-y: auto; margin-top: 6px; }
    .reference-marker-row { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 10px; color: #334155; }
    .reference-marker-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .reference-marker-name > span, .reference-marker-note { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .reference-marker-note { margin-top: 1px; color: #64748b; font-size: 9px; }
    .reference-marker-delete { border: 0; padding: 0 3px; background: transparent; color: #94a3b8; cursor: pointer; font-size: 13px; line-height: 1; }
    .reference-marker-delete:hover { color: #dc2626; }
    .reference-marker-edit { border: 1px solid #cbd5e0; border-radius: 5px; padding: 2px 5px; background: #fff; color: #2563eb; cursor: pointer; font-size: 9px; line-height: 1.2; white-space: nowrap; }
    .reference-marker-edit:hover { border-color: #2563eb; background: #eff6ff; }
    .reference-marker-icon { width: 20px; height: 20px; position: relative; }
    .reference-marker-icon::before { content: ""; position: absolute; left: 2px; top: 1px; width: 15px; height: 15px; border: 2px solid #fff; border-radius: 50% 50% 50% 0; background: #e11d48; box-shadow: 0 0 0 2px rgba(225,29,72,.26), 0 2px 6px rgba(15,23,42,.3); transform: rotate(-45deg); }
    .reference-marker-icon::after { content: ""; position: absolute; left: 8px; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: #fff; }
    .leaflet-tooltip.reference-label { border: 1px solid rgba(225,29,72,.28); border-radius: 7px; background: rgba(255,255,255,.96); color: #881337; box-shadow: 0 3px 10px rgba(15,23,42,.14); font-size: 10px; line-height: 1.3; padding: 3px 6px; }
    .reference-label-name { font-weight: 700; }
    .reference-label-note { margin-top: 2px; color: #64748b; max-width: 180px; white-space: normal; word-break: break-word; }
    .marker-dialog-backdrop { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; background: rgba(15,23,42,.28); }
    .marker-dialog-backdrop[hidden] { display: none; }
    .marker-dialog-card { width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px; border: 1px solid rgba(203,213,225,.92); border-radius: 12px; background: rgba(255,255,255,.98); box-shadow: 0 16px 42px rgba(15,23,42,.22); }
    .marker-dialog-title { margin: 0; color: #1f2937; font-size: 15px; font-weight: 700; }
    .marker-dialog-description { margin: 4px 0 12px; color: #64748b; font-size: 11px; line-height: 1.4; }
    .marker-dialog-field { display: grid; gap: 5px; margin-top: 9px; color: #475569; font-size: 11px; font-weight: 600; }
    .marker-dialog-field input, .marker-dialog-field textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e0; border-radius: 7px; padding: 7px 8px; color: #1f2937; background: #fff; font: inherit; font-weight: 400; outline: none; resize: vertical; }
    .marker-dialog-field input:focus, .marker-dialog-field textarea:focus { border-color: #3182ce; box-shadow: 0 0 0 2px rgba(49,130,206,.14); }
    .marker-dialog-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
    .marker-dialog-actions .map-tool-primary { border-color: #2563eb; background: #2563eb; color: #fff; }
    .marker-dialog-actions .map-tool-primary:hover { border-color: #1d4ed8; background: #1d4ed8; }
    .distance-panel { position: absolute; z-index: 1000; right: 12px; bottom: 12px; width: min(560px, calc(100vw - 320px)); max-height: min(300px, calc(100% - 130px)); overflow: auto; box-sizing: border-box; padding: 8px 10px; background: rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,.10); }
    .distance-panel[hidden] { display: none; }
    .distance-panel-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; color: #1f2937; font-size: 12px; font-weight: 700; }
    .distance-panel-close { border: 0; padding: 0 3px; background: transparent; color: #94a3b8; cursor: pointer; font-size: 16px; line-height: 1; }
    .distance-panel-note { margin-bottom: 2px; color: #64748b; font-size: 10px; line-height: 1.35; }
    .leaflet-tooltip.distance-label { border: 1px solid rgba(249,115,22,.35); border-radius: 999px; background: rgba(255,247,237,.96); color: #c2410c; box-shadow: 0 2px 8px rgba(15,23,42,.16); font-size: 10px; font-weight: 800; padding: 2px 6px; white-space: nowrap; }
    .distance-empty { color: #64748b; font-size: 10px; }
    .marker-wrap { width: 18px; height: 18px; position: relative; }
    .marker-pin { width: 14px; height: 14px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid rgba(255,255,255,.95); box-shadow: 0 0 0 1px rgba(0,0,0,.18); }
    .marker-dot { width: 6px; height: 6px; border: 2px solid; border-radius: 50%; position: absolute; left: 4px; top: 4px; background: rgba(255,255,255,.92); }
    .marker-wrap.marker-highlight { filter: drop-shadow(0 0 4px rgba(249,115,22,.95)); }
    .work-panel { position: absolute; z-index: 1000; left: 12px; top: 12px; width: 292px; height: calc(100% - 24px); max-height: none; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; background: rgba(255,255,255,.96); border-radius: 12px; padding: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.10); transition: all .18s ease; }
    .work-panel.collapsed { top: 12px; width: 155px; height: auto; max-height: none; padding: 7px 9px; overflow: hidden; }
    .floating-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .panel-toggle { border: 1px solid #cbd5e0; background: #fff; color: #2d3748; border-radius: 999px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
    .panel-toggle:hover { background: #f7fafc; }
    .panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .panel-body.hidden { display: none; }
    .work-panel h3 { margin: 0 0 6px; font-size: 13px; }
    .list-tabs { display: flex; gap: 3px; padding: 2px; margin-bottom: 6px; background: #f1f5f9; border-radius: 8px; }
    .list-tab { flex: 1; border: 0; border-radius: 6px; padding: 5px 6px; background: transparent; color: #64748b; font-size: 11px; cursor: pointer; }
    .list-tab.active { background: #fff; color: #1e3a8a; font-weight: 700; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
    .list-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .list-section.hidden { display: none; }
    .case-search { width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 6px 8px; border: 1px solid #cbd5e0; border-radius: 8px; font-size: 11px; outline: none; }
    .case-search:focus, .case-sort:focus { border-color: #3182ce; box-shadow: 0 0 0 2px rgba(49,130,206,.12); }
    .case-toolbar { display: flex; gap: 5px; align-items: center; margin-bottom: 6px; }
    .case-sort { flex: 1; min-width: 0; border: 1px solid #cbd5e0; border-radius: 8px; padding: 5px 7px; font-size: 11px; color: #374151; background: #fff; outline: none; }
    .case-meta { font-size: 10px; color: #4a5568; margin-bottom: 6px; line-height: 1.3; }
    .case-list { flex: 1; min-height: 0; list-style: none; padding: 0 2px 0 0; margin: 0; overflow-y: auto; }
    .case-item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 7px; margin-bottom: 5px; background: #fff; cursor: pointer; transition: all .15s ease; }
    .case-item:hover { border-color: #63b3ed; box-shadow: 0 4px 12px rgba(66,153,225,.10); }
    .case-item.active { border-color: #3182ce; box-shadow: 0 4px 16px rgba(49,130,206,.18); }
    .case-item-title { font-size: 11px; font-weight: 700; color: #1f2937; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .case-item-sub { margin-top: 2px; font-size: 10px; color: #4b5563; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .case-item-footer { margin-top: 3px; display: flex; align-items: center; justify-content: space-between; gap: 5px; flex-wrap: nowrap; }
    .case-item-price { font-size: 11px; font-weight: 800; color: #b91c1c; }
    .case-item-tag { display: inline-block; max-width: 112px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 5px; border-radius: 999px; background: #edf2f7; color: #4a5568; font-size: 9px; }
    .case-item-link, .panel a { color: #2563eb; text-decoration: none; font-size: 10px; }
    .case-item-link:hover, .panel a:hover { text-decoration: underline; }
    .unlocated-list { flex: 1; min-height: 0; margin: 0; padding-left: 18px; overflow-y: auto; }
    .unlocated-list li { margin-bottom: 5px; font-size: 11px; line-height: 1.35; }
    .leaflet-popup-content table th { text-align: left; vertical-align: top; width: 88px; color: #4a5568; padding: 2px 6px 2px 0; }
    .leaflet-popup-content table td { padding: 2px 0; word-break: break-word; }
    .leaflet-tooltip.case-label { background: rgba(255,255,255,.96); border: 1px solid rgba(59,130,246,.22); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.12); color: #1f2937; cursor: pointer; font-size: 11px; line-height: 1.3; padding: 5px 7px; pointer-events: auto; }
    .leaflet-tooltip.case-label::before { border-top-color: rgba(59,130,246,.22); }
    .case-label-wrap { min-width: 120px; max-width: 220px; }
    .case-label-title { font-size: 11px; font-weight: 700; color: #1f2937; line-height: 1.35; white-space: normal; word-break: break-word; }
    .case-label-price { margin-top: 3px; font-size: 12px; font-weight: 800; color: #b91c1c; }
    .case-label-count { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 999px; background: #1e3a8a; color: #fff; font-size: 10px; line-height: 16px; vertical-align: middle; }
    @media (max-width: 760px) { .legend-panel { right: 12px; max-width: calc(100vw - 24px); } .distance-panel { right: 12px; width: calc(100vw - 24px); max-height: 240px; } .work-panel { top: 58px; width: 244px; height: calc(100% - 70px); max-height: none; } .work-panel.collapsed { top: 58px; height: auto; } }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="map-setup-notice" role="status" style="position:fixed;z-index:1500;left:10px;right:10px;top:10px;padding:9px 12px;border:1px solid #f6d58a;border-radius:8px;background:#fff8e6;color:#854d0e;line-height:1.6;font-size:12px;overflow-wrap:anywhere" __MAP_NOTICE_HIDDEN__>尚未配置地图。请前往首页 → 地图基础配置，填写高德 JS API Key 并保存，再重新生成地图。</div>
  <div class="legend-panel" aria-label="土地用途图例"><div id="legend" class="legend"></div><div class="map-tool-row"><button id="add-reference-marker" class="map-tool" type="button">插入位置标记</button><button id="clear-reference-markers" class="map-tool" type="button" disabled>清除标记</button></div><div id="map-tool-status" class="map-tool-status">点击“插入位置标记”后，再点击地图放置标记。</div><div id="reference-marker-list" class="reference-marker-list"></div></div>
  <div id="distance-panel" class="distance-panel" hidden><div class="distance-panel-title"><span>选中位置到标记点距离</span><button id="close-distance-panel" class="distance-panel-close" type="button" aria-label="关闭距离结果">×</button></div><div id="distance-panel-note" class="distance-panel-note"></div><div id="distance-results"></div></div>
  <div id="marker-dialog" class="marker-dialog-backdrop" hidden><form id="marker-dialog-form" class="marker-dialog-card" role="dialog" aria-modal="true" aria-labelledby="marker-dialog-title"><h2 id="marker-dialog-title" class="marker-dialog-title">添加位置标记</h2><p class="marker-dialog-description">为地图上的位置填写名称，也可以补充备注。</p><label class="marker-dialog-field"><span>标记名称</span><input id="marker-dialog-name" type="text" maxlength="80" required autocomplete="off" /></label><label class="marker-dialog-field"><span>备注（可选）</span><textarea id="marker-dialog-note" rows="2" maxlength="160" placeholder="留空则不显示"></textarea></label><div class="marker-dialog-actions"><button id="marker-dialog-cancel" class="map-tool" type="button">取消</button><button class="map-tool map-tool-primary" type="submit">确定</button></div></form></div>
  <div class="work-panel collapsed" id="work-panel"><div class="floating-title"><h3 style="margin:0;">数据清单</h3><button class="panel-toggle" id="work-toggle" type="button">展开</button></div><div class="panel-body hidden" id="work-body"><div class="list-tabs" role="tablist" aria-label="数据清单类型"><button class="list-tab active" id="case-tab" type="button" role="tab" aria-selected="true">案例 <span id="case-tab-count">0</span></button><button class="list-tab" id="unlocated-tab" type="button" role="tab" aria-selected="false">未定位 <span id="unlocated-tab-count">0</span></button></div><section class="list-section" id="case-section"><input id="case-search" class="case-search" type="text" placeholder="输入位置 / 用途 / 日期筛选" /><div class="case-toolbar"><select id="case-sort" class="case-sort" title="案例排序"><option value="date_desc">时间：新到旧</option><option value="date_asc">时间：旧到新</option><option value="price_desc">单价：高到低</option><option value="price_asc">单价：低到高</option></select></div><div class="case-meta">共 <span id="case-count">0</span> 个展示点，点击任意条即可定位到地图。</div><ul id="case-list" class="case-list"></ul></section><section class="list-section hidden" id="unlocated-section"><div class="case-meta">共 <span id="unlocated-count">0</span> 条，未返回坐标的记录保留在这里。</div><ul id="unlocated-list" class="unlocated-list"></ul></section></div></div>
  <script>
    window.reportLandMapStatus = function(message, kind) {
      const notice = document.getElementById('map-setup-notice');
      const embedded = window.parent !== window;
      if (notice) { notice.hidden = embedded || kind === 'ok'; notice.textContent = message; }
      if (window.parent !== window) window.parent.postMessage({type:'ZJ_LAND_MAP_STATUS',message,kind}, '*');
    };
    __AMAP_CLIENT__
    AppraisalAmap.watch(__MAP_CONFIG__, window.reportLandMapStatus);
  </script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script>
  (function initializeLandMap() {
    if (!window.L) { window.reportLandMapStatus('地图组件未能加载。请检查网络，并前往工具箱首页 → 地图基础配置保存高德配置后重新生成地图。', 'error'); return; }
    const DATA = __DATA__;
    const map = AppraisalAmap.createMap('map', { zoomControl: false }, DATA.mapConfig, window.reportLandMapStatus).setView([DATA.center.lat, DATA.center.lon], 8);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const cluster = typeof L.markerClusterGroup === 'function'
      ? L.markerClusterGroup({ disableClusteringAtZoom: 15, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 48 })
      : L.layerGroup();
    const bounds = [], markerRecords = [], pointMarkers = [];
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function safeHref(value) { const url = String(value || '').trim(); return /^https?:\/\//i.test(url) ? escapeHtml(url) : ''; }
    function valueText(value) { return value === null || value === undefined || value === '' ? '—' : escapeHtml(value); }
    function numberText(value) { const parsed = Number(String(value ?? '').replace(/,/g, '').trim()); return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { maximumFractionDigits: 20 }) : escapeHtml(value); }
    function linkText(value, label) { const href = safeHref(value); return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : '—'; }
    function markerIcon(item, highlighted) { const color = highlighted ? '#f97316' : item.color; const markerClass = highlighted ? 'marker-wrap marker-highlight' : 'marker-wrap'; return L.divIcon({ className: '', html: `<div class="${markerClass}"><div class="marker-pin" style="background:${color}"></div><div class="marker-dot" style="border-color:${color}"></div></div>`, iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -16] }); }
    function referenceMarkerIcon() { return L.divIcon({ className: '', html: '<div class="reference-marker-icon" aria-label="自定义位置标记"></div>', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] }); }
    const selectedSourceCodes = new Set();
    const referenceMarkerData = [];
    const referenceMarkerLayers = new Map();
    let placementMode = false;
    let distanceLinesVisible = false;
    let pendingMarkerPosition = null;
    const distanceLayer = L.layerGroup().addTo(map);
    function markerStorageKey() { return `zj-land-reference-markers:${location.pathname}`; }
    function saveReferenceMarkers() { try { localStorage.setItem(markerStorageKey(), JSON.stringify(referenceMarkerData.map(({ editing, ...item }) => item))); } catch (_) {} }
    function referenceMarkerById(id) { return referenceMarkerData.find((item) => item.id === id); }
    function referenceMarkerLabel(item) { return `<div class="reference-label-name">${escapeHtml(item.name)}</div>${item.note ? `<div class="reference-label-note">${escapeHtml(item.note)}</div>` : ''}`; }
    function referenceMarkerPopup(item) { return `<div style="min-width:150px;">${referenceMarkerLabel(item)}<div style="margin-top:4px;color:#64748b;font-size:10px;">${item.editing ? '编辑状态：可拖动' : '位置已锁定，点击“编辑”后可移动'}</div></div>`; }
    function renderReferenceMarkerList() {
      const list = document.getElementById('reference-marker-list'), clear = document.getElementById('clear-reference-markers');
      if (!list) return;
      list.innerHTML = referenceMarkerData.map((item) => `<div class="reference-marker-row"><span class="reference-marker-name" data-marker-id="${escapeHtml(item.id)}" title="${escapeHtml(item.note ? `${item.name}：${item.note}` : item.name)}"><span>${escapeHtml(item.name)}</span>${item.note ? `<small class="reference-marker-note">${escapeHtml(item.note)}</small>` : ''}</span><button class="reference-marker-edit" type="button" data-edit-marker-id="${escapeHtml(item.id)}" aria-label="${item.editing ? '完成编辑' : '编辑位置'}">${item.editing ? '完成' : '编辑'}</button><button class="reference-marker-delete" type="button" data-delete-marker-id="${escapeHtml(item.id)}" aria-label="删除 ${escapeHtml(item.name)}" title="删除">×</button></div>`).join('');
      list.querySelectorAll('.reference-marker-name').forEach((element) => element.addEventListener('click', () => { const marker = referenceMarkerLayers.get(element.dataset.markerId); if (!marker) return; map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: .5 }); marker.openPopup(); }));
      list.querySelectorAll('[data-edit-marker-id]').forEach((element) => element.addEventListener('click', () => { const item = referenceMarkerById(element.dataset.editMarkerId); if (item) setReferenceMarkerEditing(item.id, !item.editing); }));
      list.querySelectorAll('[data-delete-marker-id]').forEach((element) => element.addEventListener('click', () => removeReferenceMarker(element.dataset.deleteMarkerId)));
      if (clear) clear.disabled = referenceMarkerData.length === 0;
    }
    function setReferenceMarkerEditing(id, editing) {
      const item = referenceMarkerById(id), marker = referenceMarkerLayers.get(id);
      if (!item || !marker) return;
      item.editing = Boolean(editing);
      if (item.editing) marker.dragging?.enable();
      else marker.dragging?.disable();
      marker.setPopupContent(referenceMarkerPopup(item));
      renderReferenceMarkerList();
      updateReferenceMarkerStatus(item.editing ? `“${item.name}”已进入编辑状态，可拖动位置；调整完成后点击“完成”。` : `“${item.name}”已锁定，位置已保存。`);
    }
    function updateReferenceMarkerStatus(text) { const element = document.getElementById('map-tool-status'); if (element) element.textContent = text; }
    function setPlacementMode(enabled) {
      placementMode = Boolean(enabled);
      const button = document.getElementById('add-reference-marker');
      button?.classList.toggle('active', placementMode);
      if (button) button.textContent = placementMode ? '取消放置标记' : '插入位置标记';
      map.getContainer().style.cursor = placementMode ? 'crosshair' : '';
      updateReferenceMarkerStatus(placementMode ? '请点击地图选择位置，然后输入标记名称。' : '标记默认锁定；点击清单中的“编辑”后才可以移动。');
    }
    function addReferenceMarker(data, persist = true) {
      const item = { id: String(data.id || `marker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`), name: String(data.name || '位置标记'), note: String(data.note || '').trim(), lat: Number(data.lat), lon: Number(data.lon), editing: false };
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
      referenceMarkerData.push(item);
      const marker = L.marker([item.lat, item.lon], { icon: referenceMarkerIcon(), draggable: true }).addTo(map);
      marker.dragging?.disable();
      marker.bindPopup(referenceMarkerPopup(item));
      marker.bindTooltip(referenceMarkerLabel(item), { permanent: true, direction: 'top', offset: [0, -12], opacity: .98, className: 'reference-label', sticky: false });
      marker.on('dragend', () => { const position = marker.getLatLng(), current = referenceMarkerById(item.id); if (!current) return; current.lat = position.lat; current.lon = position.lng; marker.setPopupContent(referenceMarkerPopup(current)); marker.setTooltipContent(referenceMarkerLabel(current)); saveReferenceMarkers(); if (distanceLinesVisible) renderDistanceResults([...selectedSourceCodes]); });
      referenceMarkerLayers.set(item.id, marker);
      if (persist) saveReferenceMarkers();
      renderReferenceMarkerList();
    }
    function removeReferenceMarker(id) { const marker = referenceMarkerLayers.get(id); marker?.remove(); referenceMarkerLayers.delete(id); const index = referenceMarkerData.findIndex((item) => item.id === id); if (index >= 0) referenceMarkerData.splice(index, 1); saveReferenceMarkers(); renderReferenceMarkerList(); if (distanceLinesVisible) renderDistanceResults([...selectedSourceCodes]); }
    function loadReferenceMarkers() { try { const saved = JSON.parse(localStorage.getItem(markerStorageKey()) || '[]'); if (Array.isArray(saved)) saved.filter((item) => item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))).forEach((item) => addReferenceMarker(item, false)); } catch (_) {} renderReferenceMarkerList(); }
    function haversineKm(lat1, lon1, lat2, lon2) { const radians = Math.PI / 180, dLat = (lat2 - lat1) * radians, dLon = (lon2 - lon1) * radians, a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2; return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))); }
    function selectedMapRows(sourceCodes) { const keys = new Set((Array.isArray(sourceCodes) ? sourceCodes : []).map((value) => String(value))); const rows = []; (DATA.points || []).forEach((point) => (point.items || []).forEach((row) => { const key = String(row.sourceCode || ''); if (keys.has(key) && !rows.some((item) => item.sourceCode === key)) rows.push({ ...row, lat: Number(point.lat), lon: Number(point.lon) }); })); return rows; }
    function clearDistanceLines() { distanceLayer.clearLayers(); }
    function renderDistanceResults(sourceCodes) {
      const panel = document.getElementById('distance-panel'), note = document.getElementById('distance-panel-note'), results = document.getElementById('distance-results');
      if (!panel || !note || !results) return;
      panel.hidden = false;
      const rows = selectedMapRows(sourceCodes);
      clearDistanceLines();
      if (!referenceMarkerData.length) { distanceLinesVisible = false; note.textContent = '请先点击“插入位置标记”，在地图上放置至少一个标记点。'; results.innerHTML = '<div class="distance-empty">当前没有可计算的标记点。</div>'; return; }
      if (!rows.length) { distanceLinesVisible = false; note.textContent = '请先在结果表中勾选有坐标的记录。'; results.innerHTML = '<div class="distance-empty">当前没有选中的可定位位置。</div>'; return; }
      distanceLinesVisible = true;
      let lineCount = 0;
      rows.forEach((row) => referenceMarkerData.forEach((marker) => { const distance = haversineKm(row.lat, row.lon, marker.lat, marker.lon); const line = L.polyline([[marker.lat, marker.lon], [row.lat, row.lon]], { color: '#f97316', weight: 2, opacity: .9, dashArray: '7 5' }).addTo(distanceLayer); line.bindTooltip(`${distance.toFixed(2)} km`, { permanent: true, direction: 'center', opacity: .98, className: 'distance-label', sticky: false }); lineCount += 1; }));
      note.textContent = `已绘制 ${lineCount} 条距离线；标记点默认锁定，进入编辑状态后拖动会自动更新。`;
      results.innerHTML = '';
    }
    function closeMarkerDialog() { const dialog = document.getElementById('marker-dialog'); if (dialog) dialog.hidden = true; pendingMarkerPosition = null; setPlacementMode(false); }
    function openMarkerDialog(latlng) { const dialog = document.getElementById('marker-dialog'), name = document.getElementById('marker-dialog-name'), note = document.getElementById('marker-dialog-note'); if (!dialog || !name || !note) return; pendingMarkerPosition = { lat: Number(latlng.lat), lon: Number(latlng.lng) }; name.value = `位置标记 ${referenceMarkerData.length + 1}`; note.value = ''; dialog.hidden = false; requestAnimationFrame(() => { name.focus(); name.select(); }); }
    function confirmMarkerDialog(event) { event.preventDefault(); const name = document.getElementById('marker-dialog-name'), note = document.getElementById('marker-dialog-note'); const trimmed = String(name?.value || '').trim(); if (!trimmed) { name?.focus(); return; } if (!pendingMarkerPosition) { closeMarkerDialog(); return; } addReferenceMarker({ name: trimmed, note: String(note?.value || '').trim(), lat: pendingMarkerPosition.lat, lon: pendingMarkerPosition.lon }); closeMarkerDialog(); updateReferenceMarkerStatus(`已添加“${trimmed}”，位置已锁定；如需调整请点击“编辑”。`); }
    function initReferenceMarkers() {
      document.getElementById('add-reference-marker')?.addEventListener('click', () => setPlacementMode(!placementMode));
      document.getElementById('clear-reference-markers')?.addEventListener('click', () => { referenceMarkerData.slice().forEach((item) => removeReferenceMarker(item.id)); updateReferenceMarkerStatus('标记已清除。点击“插入位置标记”后可重新放置。'); });
      document.getElementById('close-distance-panel')?.addEventListener('click', () => { const panel = document.getElementById('distance-panel'); if (panel) panel.hidden = true; });
      document.getElementById('marker-dialog-form')?.addEventListener('submit', confirmMarkerDialog);
      document.getElementById('marker-dialog-cancel')?.addEventListener('click', closeMarkerDialog);
      document.getElementById('marker-dialog')?.addEventListener('click', (event) => { if (event.target?.id === 'marker-dialog') closeMarkerDialog(); });
      document.addEventListener('keydown', (event) => { const dialog = document.getElementById('marker-dialog'); if (event.key === 'Escape' && dialog && !dialog.hidden) closeMarkerDialog(); });
      map.on('click', (event) => { if (!placementMode) return; openMarkerDialog(event.latlng); });
      loadReferenceMarkers();
    }
    function buildPopup(item) {
      const entries = item.items || [], title = escapeHtml(item.labelTitle || item.title || '土地成交案例'), price = escapeHtml(item.labelPrice || '暂无成交单价');
      let body = '';
      if (entries.length > 1) {
        body = `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th>项目位置</th><th>交易日期</th><th>土地用途</th><th>成交单价</th><th>网址</th></tr></thead><tbody>${entries.slice(0, 12).map((row) => `<tr><td>${valueText(row.location)}</td><td>${valueText(row.date)}</td><td>${valueText(row.landUse)}</td><td>${row.dealUnitPriceYuanSqm ? `${numberText(row.dealUnitPriceYuanSqm)} 元/㎡` : '—'}</td><td>${linkText(row.url, '打开')}</td></tr>`).join('')}</tbody></table>${entries.length > 12 ? `<div style="margin-top:6px;color:#718096;font-size:11px;">仅展示前 12 条，其余 ${entries.length - 12} 条请查看 Excel。</div>` : ''}`;
      } else {
        const row = entries[0] || {};
        const details = [['公示编号', row.sourceCode], ['行政区', row.district], ['项目位置', row.location], ['土地用途', row.landUse], ['交易方式', row.tradeMethod], ['土地面积', row.areaSqm ? `${numberText(row.areaSqm)} 平方米` : (row.areaMu ? `${numberText(row.areaMu)} 亩` : '')], ['成交单价', row.dealUnitPriceYuanSqm ? `${numberText(row.dealUnitPriceYuanSqm)} 元/㎡` : ''], ['成交总价', row.dealTotalPriceWan ? `${numberText(row.dealTotalPriceWan)} 万元` : ''], ['发布时间', row.date], ['详情网址', linkText(row.url, '打开详情')], ['坐标类型', row.coordType], ['坐标', `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`]];
        body = `<table style="width:100%;border-collapse:collapse;font-size:12px;">${details.filter(([, value]) => value !== '' && value !== null && value !== undefined).map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${typeof value === 'string' && value.includes('<a ') ? value : valueText(value)}</td></tr>`).join('')}</table>`;
      }
      return `<div style="min-width:300px;max-width:560px;"><div style="font-size:15px;font-weight:700;margin-bottom:6px;">${title}</div><div style="margin-bottom:8px;color:#2d3748;font-size:12px;line-height:1.45;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#edf2f7;margin-right:6px;">${item.labelCount > 1 ? `同位置 ${item.labelCount} 条` : valueText(item.labelLandUse)}</span><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#ebf8ff;">单价：${price}</span></div>${body}</div>`;
    }
    function renderLegend() { document.getElementById('legend').innerHTML = (DATA.legend || []).map((item) => `<span class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${escapeHtml(item.label)}</span>`).join(''); }
    function initCollapsiblePanels() { const button = document.getElementById('work-toggle'), body = document.getElementById('work-body'), root = document.getElementById('work-panel'); if (!button || !body || !root) return; body.classList.add('hidden'); button.addEventListener('click', () => { const hidden = body.classList.toggle('hidden'); root.classList.toggle('collapsed', hidden); button.textContent = hidden ? '展开' : '收起'; }); }
    function initListTabs() { const tabs = [['case-tab', 'case-section'], ['unlocated-tab', 'unlocated-section']]; tabs.forEach(([tabId, sectionId]) => { const tab = document.getElementById(tabId), section = document.getElementById(sectionId); if (!tab || !section) return; tab.addEventListener('click', () => { tabs.forEach(([otherTabId, otherSectionId]) => { const otherTab = document.getElementById(otherTabId), otherSection = document.getElementById(otherSectionId), active = otherTabId === tabId; otherTab.classList.toggle('active', active); otherTab.setAttribute('aria-selected', active ? 'true' : 'false'); otherSection.classList.toggle('hidden', !active); }); }); }); }
    function pointContainsSourceCodes(entry, sourceCodes) { const keys = new Set(sourceCodes.map((value) => String(value))); return (entry.item.items || []).some((row) => keys.has(String(row.sourceCode || ''))); }
    function setSelectedSourceCodes(sourceCodes) { selectedSourceCodes.clear(); (Array.isArray(sourceCodes) ? sourceCodes : []).forEach((value) => selectedSourceCodes.add(String(value))); const keys = [...selectedSourceCodes]; markerRecords.forEach((entry) => entry.marker.setIcon(markerIcon(entry.item, pointContainsSourceCodes(entry, keys)))); if (distanceLinesVisible) renderDistanceResults(keys); }
    function focusSourceCodes(sourceCodes) { const keys = new Set((Array.isArray(sourceCodes) ? sourceCodes : []).map((value) => String(value))); const entry = markerRecords.find((candidate) => (candidate.item.items || []).some((row) => keys.has(String(row.sourceCode || '')))); if (!entry) return; map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: .7 }); entry.marker.openPopup(); }
    function focusMarker(entry) { map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: .7 }); entry.marker.openPopup(); const index = pointMarkers.indexOf(entry); document.querySelectorAll('.case-item').forEach((element) => element.classList.remove('active')); const active = document.querySelector(`.case-item[data-index="${index}"]`); if (active) active.classList.add('active'); }
    function priceNumber(item) { const value = item.items && item.items[0] ? Number(item.items[0].dealUnitPriceYuanSqm) : NaN; return Number.isFinite(value) ? value : -Infinity; }
    function renderCaseList() { const items = DATA.points || [], search = document.getElementById('case-search'), sort = document.getElementById('case-sort'), list = document.getElementById('case-list'); document.getElementById('case-count').textContent = items.length; document.getElementById('case-tab-count').textContent = items.length; function draw() { const query = String(search.value || '').trim().toLowerCase(), direction = sort.value || 'date_desc'; const filtered = items.map((item, index) => ({ item, index })).filter(({ item }) => !query || [item.labelTitle, item.labelLandUse, item.labelPrice, item.labelDate, item.title].join(' ').toLowerCase().includes(query)); filtered.sort((left, right) => { if (direction === 'price_desc' || direction === 'price_asc') return (direction === 'price_desc' ? 1 : -1) * (priceNumber(left.item) - priceNumber(right.item)); const compared = String(left.item.labelDate || '').localeCompare(String(right.item.labelDate || '')); return direction === 'date_asc' ? compared : -compared; }); list.innerHTML = filtered.map(({ item, index }) => `<li class="case-item" data-index="${index}"><div class="case-item-title">${escapeHtml(item.labelTitle || '')}${item.labelCount > 1 ? `<span class="case-label-count">×${item.labelCount}</span>` : ''}</div><div class="case-item-sub">${escapeHtml([item.labelLandUse, item.labelDate].filter(Boolean).join(' · '))}</div><div class="case-item-footer"><div class="case-item-price">${escapeHtml(item.labelPrice || '')}</div><span class="case-item-tag">${escapeHtml(item.labelLandUse || '')}</span><a class="case-item-link" href="javascript:void(0)">定位</a></div></li>`).join('') || '<li class="case-item"><div class="case-item-title">没有匹配到案例</div></li>'; list.querySelectorAll('.case-item').forEach((element) => { const index = Number(element.dataset.index); if (Number.isFinite(index) && pointMarkers[index]) element.addEventListener('click', () => focusMarker(pointMarkers[index])); }); } search.addEventListener('input', draw); sort.addEventListener('change', draw); draw(); }
    function syncLabels() { const mode = map.getZoom() >= 11 ? 'compact' : 'none'; markerRecords.forEach((entry) => { if (mode === 'none') { if (entry.marker.getTooltip()) entry.marker.unbindTooltip(); entry.mode = mode; return; } if (entry.mode === mode && entry.marker.getTooltip()) return; if (entry.marker.getTooltip()) entry.marker.unbindTooltip(); entry.marker.bindTooltip(`<div class="case-label-wrap"><div class="case-label-title">${escapeHtml(entry.item.labelTitle || '')}${entry.item.labelCount > 1 ? `<span class="case-label-count">×${entry.item.labelCount}</span>` : ''}</div><div class="case-label-price">${escapeHtml(entry.item.labelPrice || '')}</div></div>`, { permanent: true, direction: 'top', offset: [0, -18], opacity: .98, className: 'case-label', sticky: false }); entry.mode = mode; }); }
    renderLegend(); initCollapsiblePanels(); initListTabs(); initReferenceMarkers();
    (DATA.points || []).forEach((item) => { const marker = L.marker([item.lat, item.lon], { icon: markerIcon(item, false) }); marker.bindPopup(buildPopup(item), { maxWidth: 560 }); markerRecords.push({ marker, item, mode: '' }); pointMarkers.push({ marker, item }); cluster.addLayer(marker); bounds.push([item.lat, item.lon]); });
    window.addEventListener('message', (event) => { const message = event.data || {}; if (message.type === 'ZJ_LAND_MAP_SET_SELECTED') setSelectedSourceCodes(message.sourceCodes); if (message.type === 'ZJ_LAND_MAP_FOCUS') focusSourceCodes(message.sourceCodes); if (message.type === 'ZJ_LAND_MAP_DISTANCE_REQUEST') { setSelectedSourceCodes(message.sourceCodes); renderDistanceResults(message.sourceCodes); } });
    map.addLayer(cluster); map.on('zoomend', syncLabels); syncLabels(); if (bounds.length) { map.fitBounds(bounds, { padding: [30, 30] }); syncLabels(); } renderCaseList();
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(document.getElementById('map'));
    const unlocated = DATA.unlocated || []; document.getElementById('unlocated-count').textContent = unlocated.length; document.getElementById('unlocated-tab-count').textContent = unlocated.length; document.getElementById('unlocated-list').innerHTML = unlocated.slice(0, 200).map((item) => `<li><strong>${escapeHtml(item.location || item.sourceCode || '未填写位置')}</strong><br/>${escapeHtml([item.landUse, item.tradeMethod, item.date].filter(Boolean).join('｜'))} ${linkText(item.url, '详情')}</li>`).join('') || '<li>没有未定位记录，太好了。</li>';
    if (window.parent !== window) window.parent.postMessage({ type: 'ZJ_LAND_MAP_READY' }, '*');
  })();
  </script>
</body>
</html>
"""
    with open(map_html, 'w', encoding='utf-8') as f:
        f.write(html.replace('__DATA__', payload_json).replace('__MAP_NOTICE_HIDDEN__', 'hidden' if payload['mapConfig']['amapEnabled'] else '').replace('__AMAP_CLIENT__', browser_script()).replace('__MAP_CONFIG__', json.dumps(payload['mapConfig'], ensure_ascii=False).replace('<', '\\u003c')))

    return {
        'coord_json': coord_json,
        'points_js': points_js,
        'map_html': map_html,
        'point_count': len(points),
    }


# ============================================================
#  核心抓取逻辑
# ============================================================

def clean_text(text):
    if not text:
        return ''
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def parse_content_fields(content):
    """用td标签解析土地详情"""
    result = {
        '宗地编号': '',
        '地块位置': '',
        '土地用途': '',
        '土地面积(亩)': '',
        '出让年限': '',
        '成交结果': '',
        '受让单位': '',
    }

    tds = re.findall(r'<td[^>]*>(.*?)</td>', content, re.DOTALL)
    if not tds:
        return result

    cells = []
    for td in tds:
        text = re.sub(r'<[^>]+>', '', td)
        text = clean_text(text)
        cells.append(text)

    label_keywords = [
        ('宗地编号', '宗地编号'),
        ('地块位置', '地块位置'),
        ('土地用途', '土地用途'),
        ('土地面积', '土地面积(亩)'),
        ('出让年限', '出让年限'),
        ('成交结果', '成交结果'),
        ('成交价', '成交结果'),
        ('受让单位', '受让单位'),
        ('受让人', '受让单位'),
    ]

    for i, cell in enumerate(cells):
        if not cell or cell in ['明细用途', '用途名称', '面积（亩）']:
            continue
        for kw, field_name in label_keywords:
            if kw in cell and not result[field_name]:
                if field_name == '土地面积(亩)':
                    val = cells[i+1] if i+1 < len(cells) else ''
                    m = re.search(r'(\d+\.?\d*)', val)
                    result[field_name] = m.group(1) if m else val
                elif field_name == '出让年限':
                    val = cells[i+1] if i+1 < len(cells) else ''
                    m = re.search(r'(\d+)\s*年', val)
                    result[field_name] = m.group(1) + '年' if m else val
                else:
                    result[field_name] = cells[i+1] if i+1 < len(cells) else ''
                break

    return result


def extract_number(text):
    """从文本中提取首个数值，提取不到返回 None。"""
    if text is None:
        return None
    m = re.search(r'(\d+\.?\d*)', str(text))
    return float(m.group(1)) if m else None


def calc_total_price_wan(unit_price_yuan_sqm, area_mu=None, area_sqm=None):
    """按单价(元/㎡)和面积计算总价(万元)。"""
    unit = extract_number(unit_price_yuan_sqm)
    if unit is None:
        return ''

    sqm = extract_number(area_sqm)
    if sqm is None and area_mu is not None:
        mu = extract_number(area_mu)
        if mu is not None:
            sqm = mu * 666.67

    if sqm is None:
        return ''

    return round(unit * sqm / 10000, 2)


def _release_date_key(value):
    text = str(value or "")
    match = re.search(r"(\d{4})\D*(\d{1,2})\D*(\d{1,2})", text)
    if not match:
        return None
    try:
        return tuple(int(part) for part in match.groups())
    except ValueError:
        return None


def _region_text(value):
    return re.sub(r"[\s（）()]", "", str(value or "")).casefold()


def _collect_region_codes(node):
    codes = []
    code = str(node.get("districtCode") or "").strip()
    if code:
        codes.append(code)
    for child in node.get("children") or []:
        codes.extend(_collect_region_codes(child))
    return codes


def fetch_region_codes(region_name):
    """读取官网行政区树，返回列表接口可接受的区域代码集合。

    所有候选端点均严格校验（HTTP/Content-Type/JSON/结构/业务 code）；
    全部失败时抛出 LandSourceError（LAND_REGION_SOURCE_UNAVAILABLE 及最近诊断），
    不再静默返回空集合。匹配不到目标行政区仍是 LAND_REGION_FILTER_RESOLUTION_FAILED。
    """
    if not region_name:
        return []
    urls = (
        "https://www.zjzrzyjy.com/trade/uniportal/index/districtList",
        "https://www.zjzrzyjy.com/trade/uniread/index/districtList",
        "https://www.zjzrzyjy.com/trade/view/preApply/preAnnouncement/districtList",
    )
    wanted = _region_text(region_name)
    last_error: Exception | None = None
    for url in urls:
        try:
            data, _diagnostics = land_http.fetch_json(
                url, "REGION", timeout=20, allow_missing_business_code=True
            )
            land_http.validate_region_catalog(data)
            roots = data.get("data") or []
            queue = list(roots)
            while queue:
                node = queue.pop(0)
                if _region_text(node.get("districtName")) == wanted:
                    return list(dict.fromkeys(_collect_region_codes(node)))
                queue.extend(node.get("children") or [])
        except land_http.LandSourceError as error:
            last_error = error
            continue
    if last_error is not None:
        raise last_error
    raise land_http.LandSourceError(
        "LAND_REGION_FILTER_RESOLUTION_FAILED",
        f"LAND_REGION_FILTER_RESOLUTION_FAILED: 未匹配到行政区 {region_name!r}",
    )


def _land_bidding_json_list(value):
    """解析 land-bidding 接口中的 JSON 数组字段。"""
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _land_bidding_use_names(record):
    names = []
    for item in _land_bidding_json_list(record.get("planUse")):
        if not isinstance(item, dict):
            continue
        name = str(item.get("NAME_") or item.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    for value in (record.get("primaryLandUse"), record.get("landUse")):
        name = str(value or "").strip()
        if name and name not in names:
            names.append(name)
    return "、".join(names)


def _land_bidding_transaction_label(record):
    mode = str(record.get("transactionMode") or record.get("tradeMode") or "").upper()
    transaction_type = str(record.get("transactionType") or "").upper()
    is_lease = transaction_type in {"ZL", "LEASE", "RENT"} or "租" in str(record.get("resourceNumber") or "")
    if mode == "GP":
        return "挂牌租赁" if is_lease else "挂牌出让"
    if mode == "PM":
        return "拍卖租赁" if is_lease else "拍卖出让"
    return str(record.get("tradeType") or record.get("transactionMode") or "").strip()


def normalize_land_bidding_record(record):
    """将 land-bidding 列表记录转换为运行器使用的统一字段。"""
    normalized = dict(record or {})
    resource_number = str(record.get("resourceNumber") or record.get("sourceCode") or "").strip()
    release_time = (
        record.get("ggPubTime")
        or record.get("pubTime")
        or record.get("announcementPubTime")
        or record.get("releaseTime")
        or ""
    )
    resource_stage = str(record.get("resourceStage") or record.get("tradeStage") or "").strip().upper()
    normalized.update({
        "publicityId": record.get("publicityId") or resource_number,
        "sourceId": record.get("resourceId") or record.get("sourceId") or "",
        "sourceCode": resource_number,
        "districtName": record.get("xzqName") or record.get("districtName") or "",
        "districtCode": record.get("regionCode") or record.get("districtCode") or "",
        "releaseTime": release_time,
        # The website filters this list by enrollment/listing start time. Keep
        # it separately from ggPubTime, which is the date shown in the result.
        "_queryDate": record.get("enrollStartTime") or record.get("listingStartTime") or release_time,
        "quoteStartTime": record.get("listingStartTime") or record.get("enrollStartTime") or record.get("quoteStartTime") or "",
        "content": record.get("content") or "",
        "landUse": _land_bidding_use_names(record),
        "assignmentPurpose": _land_bidding_use_names(record),
        "tradeType": _land_bidding_transaction_label(record),
        "tradeStage": "结果公示" if resource_stage == "CJ" else (record.get("tradeStage") or resource_stage),
        "tradeForm": record.get("tradeForm") or ("国有土地" if record.get("resourceCategory") == "TD" else ""),
        "_sourceEndpoint": "landbidding",
    })
    return normalized


def fetch_land_bidding_records(
    district_filter=None,
    max_pages=200,
    record_filter=None,
    stop_before=None,
    server_filters=None,
):
    """读取官网 land-bidding 页面实际使用的成交结果列表接口。

    该接口与旧的 queryPublicityList 字段和分页参数不同，必须使用
    currentPage/pageSize、enrollStartTime/nowTime 和 resourceStage=CJ。
    返回值已归一化为旧运行器兼容的字段名。
    """
    all_records = []
    page = 1
    # The website accepts larger pages; 500 avoids truncating province-wide
    # queries while keeping the request count reasonable.
    page_size = 500
    stop_key = _release_date_key(stop_before)
    query_filters = dict(server_filters or {})
    region_name = query_filters.pop("regionName", "")
    fallback_region_name = query_filters.pop("fallbackRegionName", "")
    if region_name and not query_filters.get("regionCode"):
        region_codes = fetch_region_codes(region_name)
        if not region_codes and fallback_region_name:
            region_codes = fetch_region_codes(fallback_region_name)
        if not region_codes:
            raise RuntimeError("LAND_REGION_FILTER_RESOLUTION_FAILED")
        query_filters["regionCode"] = ",".join(region_codes)

    while page <= max_pages:
        params = {
            "currentPage": page,
            "pageSize": page_size,
            "resourceStage": "CJ",
        }
        params.update({key: value for key, value in query_filters.items() if value not in (None, "")})
        url = (
            "https://www.zjzrzyjy.com/trade/view/landbidding/querylandbidding?"
            + urlencode(params)
        )
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.zjzrzyjy.com/landView/land-bidding",
        }
        # 严格校验：HTTP/Content-Type/JSON/结构/业务 code 任一失败都结构化上抛，
        # 不再把失败伪装成零结果成功。
        _payload, _diagnostics = land_http.fetch_json(url, "LIST", timeout=30)
        records, total = land_http.validate_list_payload(_payload)
        if len(records) > page_size:
            raise land_http.LandSourceError(
                "LAND_LIST_RESPONSE_SCHEMA_INVALID",
                f"LAND_LIST_RESPONSE_SCHEMA_INVALID: 第{page}页 records({len(records)}) 超过 pageSize({page_size})",
            )
        if not records:
            if page == 1:
                # 首个有效页为空：合法空结果（筛选过窄或上游确无数据）。
                # 全省+不限日期的 0 条由 runner 侧高风险门禁另行拦截。
                print(f"成交列表第{page}页为有效空列表: total={total}")
            break

        normalized_records = [normalize_land_bidding_record(record) for record in records]
        for record in normalized_records:
            district = str(record.get("districtName") or "")
            district_code = str(record.get("districtCode") or "")
            matched = True
            if district_filter:
                name_kw = str(district_filter.get("name") or "")
                code_kw = str(district_filter.get("code") or "")
                exact = bool(district_filter.get("exact", False))
                if exact:
                    matched = (bool(name_kw) and name_kw == district) or (bool(code_kw) and code_kw == district_code)
                else:
                    matched = (bool(name_kw) and name_kw in district) or (bool(code_kw) and code_kw in district_code)
            if matched and (record_filter is None or record_filter(record)):
                all_records.append(record)

        print(f"成交列表第{page}页: {len(records)}条, 累计{len(all_records)}条")
        last_key = _release_date_key(normalized_records[-1].get("_queryDate") or normalized_records[-1].get("releaseTime"))
        if stop_key and last_key and last_key < stop_key:
            break
        if len(records) < page_size or (total and page * page_size >= total):
            break
        page += 1
        time.sleep(0.3)

    return all_records


def fetch_records(district_filter=None, max_pages=200, record_filter=None, stop_before=None, server_filters=None):
    """分页读取成交公示列表，并在详情请求前执行可证明安全的候选过滤。

    Args:
        district_filter: dict，键为 'name' 或 'code'，值为匹配字符串
            例如: {'name': '兰溪'} 或 {'code': '330781'}
        max_pages: 最大页数
        record_filter: 可选的列表记录过滤函数；未知字段应返回 True，交由详情阶段复核
        stop_before: 可选日期字符串；列表按发布时间倒序且当前页最末记录早于该日期时停止翻页
        server_filters: 网站列表接口支持的业务筛选参数
    """
    all_records = []
    page = 1
    # The endpoint supports region/date filters; keep a large page size for the
    # remaining local checks without turning them into unverified query params.
    page_size = 500
    stop_key = _release_date_key(stop_before)
    query_filters = dict(server_filters or {})
    region_name = query_filters.pop("regionName", "")
    fallback_region_name = query_filters.pop("fallbackRegionName", "")
    if region_name and not query_filters.get("regionCode"):
        region_codes = fetch_region_codes(region_name)
        if not region_codes and fallback_region_name:
            region_codes = fetch_region_codes(fallback_region_name)
        if not region_codes:
            raise RuntimeError("LAND_REGION_FILTER_RESOLUTION_FAILED")
        query_filters["regionCode"] = ",".join(region_codes)

    while page <= max_pages:
        params = {"type": 3, "current": page, "size": page_size, "sort": "desc"}
        if query_filters:
            params.update({key: value for key, value in query_filters.items() if value not in (None, "")})
        url = ("https://www.zjzrzyjy.com/trade/view/publicity/queryPublicityList?"
               + urlencode(params))
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.zjzrzyjy.com/landWeb/publicityList"
        }
        # 严格校验：本函数为旧版公示接口路径，同样不允许把失败伪装成零结果。
        _payload, _diagnostics = land_http.fetch_json(url, "LIST", timeout=30)
        records, _total = land_http.validate_list_payload(_payload)
        if not records:
            break

        for r in records:
            district = str(r.get('districtName', ''))
            district_code = str(r.get('districtCode', ''))
            matched = True
            if district_filter:
                name_kw = district_filter.get('name', '')
                code_kw = district_filter.get('code', '')
                exact = bool(district_filter.get('exact', False))
                if exact:
                    matched = (bool(name_kw) and name_kw == district) or (bool(code_kw) and code_kw == district_code)
                else:
                    matched = (bool(name_kw) and name_kw in district) or (bool(code_kw) and code_kw in district_code)
            if matched and (record_filter is None or record_filter(r)):
                all_records.append(r)

        print(f"第{page}页: {len(records)}条, 累计{len(all_records)}条")
        last_key = _release_date_key(records[-1].get("releaseTime"))
        if stop_key and last_key and last_key < stop_key:
            break
        page += 1
        time.sleep(0.3)

    return all_records


def fetch_and_render_coordinates(source_id, temp_dir='/tmp'):
    """获取地块的勘测定界图 PDF 并渲染为图像

    Args:
        source_id: 地块 resourceId
        temp_dir: 临时目录

    Returns:
        dict: {
            'pdf_path': str,   # PDF 本地路径（下载后）
            'rendered_image': str,  # 渲染图路径
            'file_id': str,    # 文件 ID
            'file_name': str,  # 原文件名
            'status': str,     # 'ok' | 'no_pdf' | 'download_failed'
        }
    """
    attachments = fetch_attachment_list(source_id)

    # 找宗地界址图
    map_file = None
    for att in attachments:
        dt = att.get('dataType', '')
        fname = att.get('fileName', '')
        url = att.get('url', '')
        if '宗地界址图' in dt or '勘测' in fname or '勘界' in fname:
            map_file = att
            break

    if not map_file:
        # 没有界址图，尝试第一份 PDF
        for att in attachments:
            if att.get('url', '').endswith('.pdf'):
                map_file = att
                break

    if not map_file or not map_file.get('url'):
        return {'status': 'no_pdf', 'note': '未找到宗地界址图附件'}

    url = map_file['url']
    file_id = map_file.get('fileId', '')
    file_name = map_file.get('fileName', '勘测图.pdf')

    # 下载 PDF
    safe_name = re.sub(r'[^\w\u4e00-\u9fff-]', '_', file_name)
    pdf_path = os.path.join(temp_dir, f"kandui_{source_id}_{safe_name}")

    if download_pdf(url, pdf_path):
        # 渲染
        result = extract_coordinates_from_pdf(pdf_path)
        result['pdf_path'] = pdf_path
        result['file_id'] = file_id
        result['file_name'] = file_name
        result['source_id'] = source_id
        if result['status'] == 'ok':
            result['status'] = 'rendered'
        return result
    else:
        return {'status': 'download_failed', 'note': f'下载失败: {url}'}


def save_to_excel(records, output_path, sheet_name="成交公示",
                  include_coords=False, include_map=False, temp_dir='/tmp'):
    """保存到Excel

    Args:
        records: 公示记录列表
        output_path: 输出文件路径
        sheet_name: 工作表名
        include_coords: 是否下载并渲染勘测图（慢，建议只对少量记录使用）
        temp_dir: 临时目录
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name

    # 根据是否包含坐标决定列
    if include_coords:
        columns = [
            '公示编号', '公示标题', '行政区',
            '地块编号（宗地编码）', '地块位置',
            '土地用途', '土地面积(亩)', '土地面积(平方米)',
            '出让年限', '起始单价(元/平方米)', '起始总价(万元)',
            '成交单价(元/平方米)', '成交总价(万元)', '受让单位',
            '发布时间', '详情页网址',
            '坐标类型', '坐标中心经度', '坐标中心纬度',
            'X坐标起点', 'Y坐标起点', '边界点组数', '边界点总数',
            '坐标数据文件',
        ]
        if include_map:
            columns.append('地图文件')
    else:
        columns = [
            '公示编号', '公示标题', '行政区',
            '地块编号（宗地编码）', '地块位置',
            '土地用途', '土地面积(亩)', '土地面积(平方米)',
            '出让年限', '起始单价(元/平方米)', '起始总价(万元)',
            '成交单价(元/平方米)', '成交总价(万元)', '受让单位',
            '发布时间', '详情页网址',
        ]

    for col, header in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal='center')

    coord_rows = []
    for row_idx, r in enumerate(records, 2):
        detail = parse_content_fields(r.get('content', ''))
        source_code = r.get('sourceCode', '')
        publicity_id = r.get('publicityId', '')
        source_id = r.get('sourceId', '')

        # 计算平方米
        area_mu = detail.get('土地面积(亩)', '')
        area_sqm = ''
        area_sqm_num = None
        if area_mu:
            try:
                area_sqm_num = round(float(re.search(r'\d+\.?\d*', area_mu).group()) * 666.67, 2)
                area_sqm = area_sqm_num
            except Exception:
                area_sqm = ''
                area_sqm_num = None

        # 清洗单价
        start_unit_price = ''
        start_total_price = ''
        deal_unit_price = extract_number(detail.get('成交结果', ''))
        deal_total_price = calc_total_price_wan(deal_unit_price, area_mu=area_mu, area_sqm=area_sqm_num)

        # 详情页 URL（source-detail 格式）
        detail_url = (
            f"https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={source_id}"
            if source_id else ''
        )

        coord = {}
        if include_coords and source_id:
            detail_data = fetch_resource_detail(source_id)
            coord = normalize_resource_coordinate(detail_data.get('resourceCoordinate', ''))
            detail_area_sqm = extract_number(detail_data.get('assignmentArea'))
            if detail_area_sqm is None:
                detail_area_sqm = area_sqm_num
            start_unit_price = extract_number(detail_data.get('startPrice', ''))
            deal_unit_price = extract_number(detail_data.get('dealPrice', deal_unit_price))
            start_total_price = calc_total_price_wan(start_unit_price, area_mu=area_mu, area_sqm=detail_area_sqm)
            deal_total_price = calc_total_price_wan(deal_unit_price, area_mu=area_mu, area_sqm=detail_area_sqm)
            coord_rows.append({
                'sourceCode': source_code,
                'districtName': r.get('districtName', ''),
                'releaseTime': r.get('releaseTime', ''),
                '_detail_url': detail_url,
                '_location': detail_data.get('resourceLocation', detail.get('地块位置', '')),
                '_area_mu': area_mu,
                '_use': detail_data.get('assignmentPeriod', detail.get('土地用途', '')),
                '_start_unit_price': start_unit_price if start_unit_price is not None else '',
                '_start_total_price_wan': start_total_price,
                '_deal_unit_price': deal_unit_price if deal_unit_price is not None else '',
                '_deal_total_price_wan': deal_total_price,
                '_assignment_area_sqm': detail_area_sqm if detail_area_sqm is not None else '',
                '_coord': coord,
            })
        else:
            detail_data = {}
            coord = {}

        coord_json_file = ''
        map_file = ''
        if include_coords and not include_map and source_id and coord:
            # 仅导出坐标时也保留一份本地 JSON，方便后续制图
            pass

        if include_coords:
            center = coord.get('center', {})
            row_data = [
                publicity_id,
                source_code,
                r.get('districtName', ''),
                source_code,
                detail.get('地块位置', ''),
                detail.get('土地用途', ''),
                area_mu,
                area_sqm,
                detail.get('出让年限', ''),
                start_unit_price,
                start_total_price,
                deal_unit_price,
                deal_total_price,
                detail.get('受让单位', ''),
                r.get('releaseTime', ''),
                detail_url,
                coord.get('locationType', ''),
                center.get('lng', ''),
                center.get('lat', ''),
                center.get('originLng', ''),
                center.get('originLat', ''),
                coord.get('group_count', ''),
                coord.get('point_count', ''),
                coord_json_file,
            ]
            if include_map:
                row_data.append(map_file)
        else:
            row_data = [
                publicity_id,
                source_code,
                r.get('districtName', ''),
                source_code,
                detail.get('地块位置', ''),
                detail.get('土地用途', ''),
                area_mu,
                area_sqm,
                detail.get('出让年限', ''),
                start_unit_price,
                start_total_price,
                deal_unit_price,
                deal_total_price,
                detail.get('受让单位', ''),
                r.get('releaseTime', ''),
                detail_url,
            ]

        for col, val in enumerate(row_data, 1):
            ws.cell(row=row_idx, column=col, value=val)

        if (row_idx - 1) % 20 == 0:
            print(f"  已处理 {row_idx - 1} 条记录...")

    map_assets = None
    if include_coords and include_map:
        map_assets = build_map_assets(coord_rows, output_path)
        # 回填坐标数据文件和地图文件
        for row_idx in range(2, len(records) + 2):
            ws.cell(row=row_idx, column=columns.index('坐标数据文件') + 1).value = map_assets['coord_json']
            ws.cell(row=row_idx, column=columns.index('地图文件') + 1).value = map_assets['map_html']

    elif include_coords:
        # 仅导出坐标时，也写一个 JSON 文件便于下游复用
        coord_json_path = str(Path(output_path).with_suffix('')) + "_coords.json"
        with open(coord_json_path, 'w', encoding='utf-8') as f:
            json.dump(coord_rows, f, ensure_ascii=False, indent=2)
        for row_idx in range(2, len(records) + 2):
            ws.cell(row=row_idx, column=columns.index('坐标数据文件') + 1).value = coord_json_path

    # 自动调整列宽
    for col_idx in range(1, len(columns) + 1):
        max_len = max(
            len(str(ws.cell(row=r, column=col_idx).value or ''))
            for r in range(1, len(records) + 2)
        )
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 2, 50)

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    wb.save(output_path)
    print(f"\n✅ 已保存: {output_path}")
    return len(records)


# ============================================================
#  主入口
# ============================================================

if __name__ == "__main__":
    # 默认抓取绍兴市，可通过参数指定
    # 用法:
    #   python scrape_zj_land.py
    #   python scrape_zj_land.py 绍兴
    #   python scrape_zj_land.py 绍兴 2025
    #   python scrape_zj_land.py 绍兴 2025 /path/to/output.xlsx
    #   python scrape_zj_land.py 绍兴 2025 /path/to/output.xlsx --coords --map
    #   python scrape_zj_land.py 某区 2023 /path/to/output.xlsx --coords --map --district-exact

    parser = argparse.ArgumentParser(description="抓取浙江自然资源土地成交公示")
    parser.add_argument("district_name", nargs="?", default=None, help="行政区关键词，例如 绍兴、镇海区")
    parser.add_argument("start_year", nargs="?", default=None, help="起始年份，例如 2025")
    parser.add_argument("output_path", nargs="?", default=None, help="输出 Excel 路径")
    parser.add_argument("--coords", action="store_true", help="导出坐标字段，并生成坐标 JSON")
    parser.add_argument("--map", dest="include_map", action="store_true", help="生成地图 HTML/JS（会同时导出坐标）")
    parser.add_argument("--district-exact", action="store_true", help="按 districtName 精确匹配")
    args = parser.parse_args()

    district_name = args.district_name
    start_year = args.start_year
    output_path = args.output_path
    include_coords = bool(args.coords or args.include_map)
    include_map = bool(args.include_map)

    if not district_name or not start_year:
        print("请先提供以下信息后再抓取：")
        print("1. 行政区名称（例如 绍兴、镇海区）")
        print("2. 起始年份（例如 2025）")
        print("3. 是否需要精确匹配 districtName（可选，适合区县名）")
        print("4. 是否导出坐标/地图（可选，使用 --coords / --map）")
        print("5. 输出文件路径（可选，不填则自动命名）")
        print("\n示例：")
        print('python scrape_zj_land.py 绍兴 2025 "/path/to/output.xlsx" --coords --map')
        raise SystemExit(2)

    if output_path is None:
        import platform
        if platform.system() == 'Darwin':
            output_path = f"/Volumes/A区/下载/{district_name}工业用地成交公示_{start_year}以来.xlsx"
        else:
            output_path = rf"C:\Users\Administrator\Desktop\{district_name}工业用地成交公示_{start_year}以来.xlsx"

    print(f"开始抓取 - {district_name}市 {start_year}年以来成交公示")
    print(f"坐标导出: {'开启' if include_coords else '关闭'}")
    print(f"地图输出: {'开启' if include_map else '关闭'}")
    print("=" * 60)

    records = fetch_records(district_filter={'name': district_name, 'exact': args.district_exact})
    print(f"\n共获取: {len(records)} 条记录")

    # 按年份过滤（如果 releaseTime 格式为 2026年04月17日）
    if start_year:
        filtered = []
        for r in records:
            rt = r.get('releaseTime', '')
            if rt and rt.startswith(start_year):
                filtered.append(r)
        print(f"过滤 {start_year} 年后: {len(filtered)} 条")
        records = filtered

    if records:
        count = save_to_excel(
            records, output_path,
            sheet_name=f"{district_name}成交公示",
            include_coords=include_coords,
            include_map=include_map,
        )
        print(f"\n完成！共 {count} 条记录")
        if include_map:
            stem = str(Path(output_path).with_suffix(''))
            print(f"地图文件: {stem}_map.html")
            print(f"坐标JSON: {stem}_coords.json")
    else:
        print("\n⚠️ 未获取到任何记录，请检查行政区名称是否正确")
