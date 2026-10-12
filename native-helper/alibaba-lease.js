"use strict";

const fs = require("node:fs");
const amapMaps = require("./amap-map.js");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");

// 阿里资产租赁模块的本地产物层：写结果 JSON/HTML/地图/历史清单与 Excel 导出。
// 与阿里司法拍卖模块职责相同但互不依赖；地图点位直接来自详情页明确坐标，
// 不做地理编码，未定位记录显式降级而不是猜测位置。

const { resolvePythonBin } = require("./runtime_config.js");
const { pythonExportFailure } = require("./diagnostics.js");
const PYTHON_BIN = resolvePythonBin();

const RESULT_ROOT = path.join(process.env.LOCALAPPDATA || os.homedir(), "AppraisalToolbox", "outputs", "alibaba-lease");
const RESULT_HTML_NAME = "latest.html";
const RESULT_EXCEL_NAME = "latest.xlsx";
const RESULT_JSON_NAME = "latest.json";
const RESULT_COORDS_NAME = "latest_coords.json";
const RESULT_POINTS_NAME = "latest_points.js";
const RESULT_MAP_NAME = "latest_map.html";
const RESULT_HISTORY_NAME = "latest_history.json";
const MAP_ASSET_RELATIVE_PATHS = Object.freeze([
  "leaflet.js",
  "leaflet.css",
  "leaflet.markercluster.js",
  "MarkerCluster.css",
  "MarkerCluster.Default.css",
  "images/layers.png",
  "images/layers-2x.png",
  "images/marker-icon.png",
  "images/marker-icon-2x.png",
  "images/marker-shadow.png",
]);
const MAP_ASSET_SOURCE_DIRECTORY = path.join(nativeHelperDataDirectory(__dirname), "map-assets");
const DEFAULT_MAP_CONFIG_PATH = path.join(process.env.LOCALAPPDATA || os.homedir(), "AppraisalToolbox", "map-config.json");

// 详情页脚本里的坐标并不稳定（同一条目首访与复访都可能不同），因此未带坐标的
// 记录会退回“标的物位置”文本搜索定位：高德 poiTips（免钥）为主、Nominatim 兜底。
// 与阿里司法拍卖模块同一套公开接口，缓存与预算逻辑保持一致，避免慢查询拖住产物生成。
const GEOCODE_CACHE_VERSION = 1;
const DEFAULT_GEOCODE_CACHE_PATH = path.join(process.env.LOCALAPPDATA || os.homedir(), "AppraisalToolbox", "cache", "alibaba-lease-geocode.json");
const GEOCODE_REQUEST_TIMEOUT_MS = 4500;
const GEOCODE_TOTAL_BUDGET_MS = 12000;
const GEOCODE_MIN_INTERVAL_MS = 300;
const AMAP_GEOCODE_ENDPOINT = "https://www.amap.com/service/poiTips";
const NOMINATIM_GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";

const geocodeCache = new Map();
const geocodeFailureCache = new Set();
let geocodeCacheLoadedPath = "";
let geocodeCacheDirty = false;
let lastGeocodeAt = 0;

const RESULT_EXCEL_COLUMNS = Object.freeze([
  ["标的名称", "title"], ["省份", "province"], ["城市", "city"], ["区县", "district"],
  ["标的物位置", "location"], ["流转方式", "transferMode"], ["房屋用途", "houseUsage"],
  ["建筑面积（m²）", "buildingArea"], ["成交价（首年租金，元）", "transactionAmount"], ["起始价（元）", "startPrice"],
  ["评估价（元）", "valuationAmount"], ["月租金单价（元/m²·月）", "monthlyUnitPrice"], ["租期（年）", "leaseTermYears"],
  ["租金支付方式", "rentPaymentTerms"], ["租金递增", "rentEscalation"], ["押金（元）", "depositAmount"],
  ["朝向", "orientation"], ["户型", "layout"], ["所在楼层", "floor"], ["总楼层", "totalFloors"], ["装修程度", "decoration"],
  ["出价次数", "bidCount"], ["报名人数", "signupCount"], ["围观次数", "viewCount"],
  ["结束时间", "endTime"], ["结果状态", "resultStatus"],
  ["坐标状态", "coordinateStatus"], ["经度", "longitude"], ["纬度", "latitude"],
  ["案例平台", "platform"], ["核验状态", "verificationStatus"], ["案例网址", "url"],
]);

const RESULT_EXCEL_NUMERIC_FIELDS = new Set([
  "buildingArea", "transactionAmount", "startPrice", "valuationAmount", "monthlyUnitPrice",
  "depositAmount", "floor", "totalFloors", "bidCount", "signupCount", "viewCount",
  "longitude", "latitude",
]);

const RESULT_EXCEL_SCRIPT = String.raw`
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

payload_path, target_path = sys.argv[1:3]
with open(payload_path, "r", encoding="utf-8") as stream:
    payload = json.load(stream)

columns = payload["columns"]
numeric_fields = set(payload["numericFields"])
rows = payload["rows"]
temporary_path = target_path + ".tmp.xlsx"
os.makedirs(os.path.dirname(target_path), exist_ok=True)

workbook = Workbook()
sheet = workbook.active
sheet.title = "租赁案例"
sheet.sheet_view.showGridLines = False
header_fill = PatternFill("solid", fgColor="EAF1F8")
header_font = Font(name="宋体", size=10, bold=True, color="1F2328")
body_font = Font(name="宋体", size=10, color="1F2328")
right_alignment = Alignment(horizontal="right", vertical="center")
left_alignment = Alignment(horizontal="left", vertical="center", wrap_text=False)

for column_index, (label, _) in enumerate(columns, 1):
    cell = sheet.cell(row=1, column=column_index, value=label)
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

for row_index, row in enumerate(rows, 2):
    for column_index, (_, field) in enumerate(columns, 1):
        value = row.get(field)
        if value == "":
            value = None
        cell = sheet.cell(row=row_index, column=column_index, value=value)
        cell.font = body_font
        cell.alignment = right_alignment if field in numeric_fields else left_alignment
        if field in numeric_fields and value is not None:
            cell.number_format = "#,##0.##"
        if field == "url" and value:
            cell.hyperlink = value
            cell.style = "Hyperlink"

sheet.freeze_panes = "A2"
if rows:
    sheet.auto_filter.ref = sheet.dimensions
widths = [34, 9, 9, 10, 30, 9, 10, 12, 16, 12, 12, 16, 9, 18, 20, 12, 8, 12, 9, 8, 10, 9, 9, 9, 12, 8, 16, 12, 12, 9, 9, 46]
for column_index, width in enumerate(widths, 1):
    sheet.column_dimensions[chr(64 + column_index) if column_index <= 26 else "A"].width = width
sheet.row_dimensions[1].height = 22
workbook.properties.creator = "Tianyuan Workbench"

try:
    workbook.save(temporary_path)
    os.replace(temporary_path, target_path)
except Exception:
    if os.path.exists(temporary_path):
        os.remove(temporary_path)
    raise

print(json.dumps({"ok": True, "rows": len(rows)}, ensure_ascii=False))
`;

function security() {
  return { credentialsReturned: false };
}

function safeText(value, max = 400) {
  return String(value || "").replace(/cookie|authorization|password|验证码|token/gi, "[REDACTED]").slice(0, max);
}

function safeError(error) {
  return safeText(error?.message || String(error));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function numericOrEmpty(value) {
  if (value === null || value === undefined || value === "") return "";
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : "";
}

function safeExportUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)taobao\.com$/i.test(url.hostname)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|cookie|authorization|password|secret|access[_-]?token|session|signature|sign|auth/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return "";
  }
}

function normalizeRequest(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const outputDirectory = String(source.outputDirectory || RESULT_ROOT).trim();
  if (!outputDirectory || outputDirectory.includes("\0") || !path.isAbsolute(outputDirectory)) {
    throw new Error("ALIBABA_LEASE_OUTPUT_DIRECTORY_INVALID");
  }
  const sourceUrl = String(source.sourceUrl || "").trim();
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!/^https:$/.test(url.protocol) || url.hostname.toLowerCase() !== "zc-paimai.taobao.com") {
        throw new Error("ALIBABA_LEASE_SOURCE_URL_HOST_NOT_ALLOWED");
      }
    } catch (error) {
      if (error?.message === "ALIBABA_LEASE_SOURCE_URL_HOST_NOT_ALLOWED") throw error;
      throw new Error("ALIBABA_LEASE_SOURCE_URL_INVALID");
    }
  }
  return {
    province: safeText(source.province, 40),
    provinceCode: safeText(source.provinceCode, 12),
    city: safeText(source.city, 40),
    cityCode: safeText(source.cityCode, 12),
    district: safeText(source.district, 40),
    districtCode: safeText(source.districtCode, 12),
    status: source.status === "all" ? "all" : "finished",
    keyword: safeText(source.keyword, 100),
    startDate: normalizeDate(source.startDate),
    endDate: normalizeDate(source.endDate),
    maxPages: boundedNumber(source.maxPages, 1, 1, 5),
    outputDirectory: path.resolve(outputDirectory),
    generateMap: source.generateMap !== false,
    sourceUrl,
  };
}

function isInsideDirectory(root, value) {
  const resolved = path.resolve(value);
  const relative = path.relative(root, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function outputDirectoryFor(request = {}) {
  const raw = String(request.outputDirectory || RESULT_ROOT).trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_LEASE_OUTPUT_DIRECTORY_INVALID");
  fs.mkdirSync(raw, { recursive: true, mode: 0o700 });
  const resolved = fs.realpathSync(raw);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("ALIBABA_LEASE_OUTPUT_DIRECTORY_NOT_DIRECTORY");
  return resolved;
}

function writeUtf8Atomic(target, content) {
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

function normalizeResultRow(item) {
  const longitude = Number(item?.longitude);
  const latitude = Number(item?.latitude);
  const hasCoordinate = Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= 70 && longitude <= 140 && latitude >= 3 && latitude <= 55;
  const buildingArea = numericOrEmpty(item?.buildingArea);
  const transactionAmount = numericOrEmpty(item?.transactionAmount);
  const leaseTermYears = numericOrEmpty(item?.leaseTermYears);
  const monthlyUnitPrice = buildingArea !== "" && transactionAmount !== "" && leaseTermYears !== "" && Number(leaseTermYears) > 0
    ? Math.round((Number(transactionAmount) / (Number(leaseTermYears) * 12) / Number(buildingArea)) * 100) / 100
    : numericOrEmpty(item?.monthlyUnitPrice);
  return {
    title: safeText(item?.title, 200),
    province: safeText(item?.province, 40),
    city: safeText(item?.city, 40),
    district: safeText(item?.district, 40),
    community: safeText(item?.community, 80),
    // 防御：历史数据或直传数据可能仍带免责文案，行归一时再剥一次。
    location: safeText(String(item?.location || "")
      .replace(/地图标注[^。；]{0,40}?为准[。.]?/g, "")
      .replace(/地图标注仅供参考/g, "")
      .replace(/[，,、；;\s]+$/g, ""), 120),
    transferMode: safeText(item?.transferMode, 20),
    propertyType: safeText(item?.propertyType, 40),
    houseUsage: safeText(item?.houseUsage, 40),
    buildingArea,
    transactionAmount,
    startPrice: numericOrEmpty(item?.startPrice),
    valuationAmount: numericOrEmpty(item?.valuationAmount),
    monthlyUnitPrice,
    leaseTermYears,
    rentPaymentTerms: safeText(item?.rentPaymentTerms, 80),
    rentEscalation: safeText(item?.rentEscalation, 80),
    depositAmount: numericOrEmpty(item?.depositAmount),
    orientation: safeText(item?.orientation, 20),
    layout: safeText(item?.layout, 30),
    floor: safeText(item?.floor, 20),
    totalFloors: safeText(item?.totalFloors, 20),
    decoration: safeText(item?.decoration, 30),
    bidCount: numericOrEmpty(item?.bidCount),
    signupCount: numericOrEmpty(item?.signupCount),
    viewCount: numericOrEmpty(item?.viewCount),
    endTime: normalizeDate(item?.endTime),
    resultStatus: item?.resultStatus === "流拍" ? "流拍" : item?.resultStatus === "未成交" ? "未成交" : "成交",
    longitude: hasCoordinate ? longitude : null,
    latitude: hasCoordinate ? latitude : null,
    coordinateStatus: hasCoordinate ? safeText(item?.coordinateStatus, 60) || "已定位（详情页坐标）" : "未定位",
    coordinateProvider: safeText(item?.coordinateProvider, 20),
    coordinatePrecision: safeText(item?.coordinatePrecision, 20),
    platform: "阿里资产",
    verificationStatus: safeText(item?.verificationStatus, 20) || "已核验",
    url: safeExportUrl(item?.url),
  };
}

function loadMapConfig() { return amapMaps.loadMapConfig(); }

function mapRowsFromResults(results) {
  return (Array.isArray(results) ? results : []).map((item, index) => ({
    id: String(index + 1),
    title: String(item?.title || "").trim(),
    district: String(item?.district || "").trim(),
    community: String(item?.community || "").trim(),
    address: String(item?.location || [item?.community, item?.district].filter(Boolean).join(" ")).trim(),
    propertyType: String(item?.propertyType || "").trim(),
    houseUsage: String(item?.houseUsage || "").trim(),
    coordinateProvider: String(item?.coordinateProvider || "").trim(),
    coordinatePrecision: String(item?.coordinatePrecision || "").trim(),
    transactionAmount: item?.transactionAmount ?? "",
    monthlyUnitPrice: item?.monthlyUnitPrice ?? "",
    buildingArea: item?.buildingArea ?? "",
    leaseTermYears: item?.leaseTermYears ?? "",
    endTime: normalizeDate(item?.endTime),
    resultStatus: String(item?.resultStatus || "").trim(),
    coordinateStatus: String(item?.coordinateStatus || "").trim(),
    longitude: item?.longitude ?? null,
    latitude: item?.latitude ?? null,
    url: safeExportUrl(item?.url),
  }));
}

function renderLeaseMapHtml(mapData, request = {}) {
  const dataJson = JSON.stringify(mapData, (_key, value) => value === undefined ? null : value)
    .replace(/<\//g, "<\\/");
  const title = escapeHtml(request.city || request.district || "浙江省");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>阿里资产租赁地图</title>
<link rel="stylesheet" href="leaflet.css">
<link rel="stylesheet" href="MarkerCluster.css">
<link rel="stylesheet" href="MarkerCluster.Default.css">
<style>
html,body,#map{height:100%;margin:0}body{font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937}#map{background:#eef2f7}.legend-panel,.work-panel,.distance-panel{position:absolute;z-index:1000;background:rgba(255,255,255,.96);border:1px solid rgba(148,163,184,.28);box-shadow:0 4px 16px rgba(15,23,42,.12);border-radius:9px}.legend-panel{top:12px;right:12px;max-width:calc(100vw - 340px);padding:8px 10px}.legend{display:flex;gap:9px;flex-wrap:wrap;color:#475569}.legend span{white-space:nowrap}.legend i{display:inline-block;width:8px;height:8px;margin-right:3px;border-radius:50%}.legend .residential{background:#2563eb}.legend .commercial{background:#16a34a}.legend .selected{background:#f97316}.legend .reference{background:#dc2626}.tile-status{margin-top:4px;color:#64748b;font-size:10px;line-height:1.35}.tile-status[data-kind="error"]{color:#b91c1c}.map-tool-row{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.map-tool{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;background:#fff;color:#2457c5;font-size:11px;cursor:pointer}.map-tool:hover,.map-tool.active{border-color:#2563eb;background:#eff6ff}.map-tool:disabled{opacity:.45;cursor:default}.map-tool-status{margin-top:5px;color:#64748b;font-size:10px;line-height:1.4}.reference-marker-list{display:flex;flex-direction:column;gap:3px;max-height:120px;overflow-y:auto;margin-top:6px}.reference-marker-row{display:flex;align-items:center;gap:5px;min-width:0;font-size:10px;color:#334155}.reference-marker-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.reference-marker-name>span,.reference-marker-note{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reference-marker-note{margin-top:1px;color:#64748b;font-size:9px}.reference-marker-delete{border:0;padding:0 3px;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px;line-height:1}.reference-marker-delete:hover{color:#dc2626}.reference-marker-icon{width:20px;height:20px;position:relative}.reference-marker-icon:before{content:"";position:absolute;left:2px;top:1px;width:15px;height:15px;border:2px solid #fff;border-radius:50% 50% 50% 0;background:#e11d48;box-shadow:0 0 0 2px rgba(225,29,72,.26),0 2px 6px rgba(15,23,42,.3);transform:rotate(-45deg)}.reference-marker-icon:after{content:"";position:absolute;left:8px;top:7px;width:5px;height:5px;border-radius:50%;background:#fff}.leaflet-tooltip.reference-label{border:1px solid rgba(225,29,72,.28);border-radius:7px;background:rgba(255,255,255,.96);color:#881337;box-shadow:0 3px 10px rgba(15,23,42,.14);font-size:10px;line-height:1.3;padding:3px 6px}.reference-label-name{font-weight:700}.reference-label-note{margin-top:2px;color:#64748b;max-width:180px;white-space:normal;word-break:break-word}.work-panel{left:12px;top:12px;width:292px;height:calc(100% - 24px);display:flex;flex-direction:column;overflow:hidden;padding:8px;transition:all .18s ease}.work-panel.collapsed{width:155px;height:auto;padding:7px 9px}.work-panel.collapsed .panel-body{display:none}.floating-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 1px 7px;color:#344054;font-weight:700}.panel-toggle{border:1px solid #cbd5e1;border-radius:999px;padding:3px 8px;background:#fff;color:#475569;font-size:11px;cursor:pointer}.panel-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.list-tabs{display:flex;gap:4px;margin-bottom:7px}.list-tab{flex:1;border:0;border-radius:6px;padding:5px 8px;background:#f1f5f9;color:#475569;cursor:pointer}.list-tab.active{background:#e8f0ff;color:#1d4ed8;font-weight:700}.list-section{flex:1;min-height:0;display:flex;flex-direction:column}.list-section.hidden{display:none}.case-search{width:100%;box-sizing:border-box;margin-bottom:6px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit}.case-meta{color:#64748b;margin-bottom:6px;font-size:10px}.case-list,.unlocated-list{flex:1;min-height:0;overflow-y:auto;margin:0;padding:0;list-style:none}.case-item{padding:7px 4px;border-bottom:1px solid #eef2f7;cursor:pointer}.case-item:hover,.case-item.active{background:#fff4df}.case-item-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.case-item-sub,.case-item-distance{display:block;margin-top:2px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.case-item-distance{color:#b42318;font-weight:700}.unlocated-list{padding-left:18px}.unlocated-list li{margin-bottom:5px;line-height:1.35}.distance-panel{right:12px;bottom:12px;width:min(380px,calc(100vw - 332px));max-height:260px;overflow:auto;box-sizing:border-box;padding:8px 10px}.distance-panel[hidden],.marker-dialog-backdrop[hidden]{display:none}.distance-panel-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;font-weight:700}.distance-panel-close{border:0;padding:0 3px;background:transparent;color:#94a3b8;cursor:pointer;font-size:16px}.distance-panel-note{margin-bottom:2px;color:#64748b;font-size:10px}.distance-empty{color:#64748b;font-size:10px}.leaflet-tooltip.distance-label{border:1px solid rgba(249,115,22,.35);border-radius:999px;background:rgba(255,247,237,.96);color:#c2410c;box-shadow:0 2px 8px rgba(15,23,42,.16);font-size:10px;font-weight:800;padding:2px 6px;white-space:nowrap}.case-pin,.reference-pin{background:transparent;border:0}.case-pin span{display:block;width:16px;height:16px;border:2px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 2px 7px rgba(15,23,42,.35);transform:rotate(-45deg)}.case-pin span.residential{background:#2563eb}.case-pin span.commercial{background:#16a34a}.case-pin span.selected{background:#f97316;box-shadow:0 0 0 4px rgba(249,115,22,.25),0 2px 7px rgba(15,23,42,.35)}.reference-pin span{display:block;width:18px;height:18px;border:3px solid #fff;border-radius:50% 50% 50% 0;background:#dc2626;box-shadow:0 2px 8px rgba(127,29,29,.45);transform:rotate(-45deg)}.marker-dialog-backdrop{position:fixed;z-index:2000;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(15,23,42,.28)}.marker-dialog-card{width:min(360px,calc(100vw - 32px));box-sizing:border-box;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 16px 42px rgba(15,23,42,.22)}.marker-dialog-title{margin:0;color:#1f2937;font-size:15px}.marker-dialog-description{margin:4px 0 12px;color:#64748b;font-size:11px}.marker-dialog-field{display:grid;gap:5px;margin-top:9px;color:#475569;font-size:11px;font-weight:600}.marker-dialog-field input,.marker-dialog-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:7px 8px;font:inherit;font-weight:400;resize:vertical}.marker-dialog-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:14px}.marker-dialog-actions .primary{border-color:#2563eb;background:#2563eb;color:#fff}.leaflet-popup-content{min-width:230px;max-width:420px}#map.placing-reference{cursor:crosshair}@media(max-width:760px){.legend-panel{right:12px;max-width:calc(100vw - 24px)}.work-panel{top:58px;width:244px;height:calc(100% - 70px)}.work-panel.collapsed{top:58px;height:auto}.distance-panel{right:12px;width:calc(100vw - 24px);max-height:220px}}
</style><style id="land-map-parity">
.legend-panel{max-width:min(560px,calc(100vw - 320px));border-radius:10px;padding:7px 9px;box-shadow:0 4px 14px rgba(0,0,0,.10)}
.map-tool{border-color:#cbd5e0;border-radius:7px;padding:4px 7px;color:#1e3a8a;font-size:10px}
.work-panel{box-sizing:border-box;border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.10)}
.floating-title{margin-bottom:8px}.list-tabs{gap:3px;padding:2px;margin-bottom:6px;background:#f1f5f9;border-radius:8px}
.list-tab{padding:5px 6px;background:transparent;font-size:11px}.list-tab.active{background:#fff;color:#1e3a8a;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.case-search,.case-sort{width:100%;box-sizing:border-box;margin-bottom:6px;padding:6px 8px;border:1px solid #cbd5e0;border-radius:8px;background:#fff;color:#374151;font:inherit;font-size:11px;outline:none}
.case-search:focus,.case-sort:focus{border-color:#3182ce;box-shadow:0 0 0 2px rgba(49,130,206,.12)}
.case-item{margin-bottom:5px;padding:6px 7px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;transition:all .15s ease}
.case-item:hover{border-color:#63b3ed;background:#fff;box-shadow:0 4px 12px rgba(66,153,225,.10)}
.case-item.active{border-color:#3182ce;background:#fff;box-shadow:0 4px 16px rgba(49,130,206,.18)}
.case-item-title{font-size:11px;line-height:1.25}.case-item-sub{font-size:10px;line-height:1.25}
.case-item-footer{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-top:4px}
.case-item-price{overflow:hidden;color:#b91c1c;font-size:11px;font-weight:800;text-overflow:ellipsis;white-space:nowrap}
.case-item-link{flex:none;color:#2563eb;font-size:10px}.unlocated-reason{display:block;margin-top:2px;color:#b45309;font-size:10px}
.leaflet-tooltip.case-label{background:rgba(255,255,255,.96);border:1px solid rgba(59,130,246,.22);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);color:#1f2937;cursor:pointer;font-size:11px;line-height:1.3;padding:5px 7px;pointer-events:auto}.case-label-wrap{min-width:120px;max-width:220px}.case-label-index,.case-item-index{display:inline-block;margin-right:4px;color:#1e3a8a;font-weight:800}.case-label-title{font-size:11px;font-weight:700;line-height:1.35;white-space:normal;word-break:break-word}.case-label-price{margin-top:3px;color:#b91c1c;font-size:12px;font-weight:800}
</style></head><body><div id="map"></div>
<div class="legend-panel"><div class="legend"><span><i class="residential"></i>成交</span><span><i class="commercial"></i>未成交</span><span><i class="selected"></i>已选案例</span><span><i class="reference"></i>自定义标记</span></div><div id="tile-status" class="tile-status">正在加载地图底图…</div><div class="map-tool-row"><button id="add-reference-marker" class="map-tool" type="button">插入位置标记</button><button id="clear-reference-markers" class="map-tool" type="button" disabled>清除标记</button></div><div id="map-tool-status" class="map-tool-status">点击“插入位置标记”后，再点击地图放置标记。</div><div id="reference-marker-list" class="reference-marker-list"></div></div>
<div id="distance-panel" class="distance-panel" hidden><div class="distance-panel-title"><span>选中案例到标记点距离</span><button id="close-distance-panel" class="distance-panel-close" type="button" aria-label="关闭距离结果">×</button></div><div id="distance-panel-note" class="distance-panel-note"></div><div id="distance-results"></div></div>
<div id="marker-dialog" class="marker-dialog-backdrop" hidden><form id="marker-dialog-form" class="marker-dialog-card" role="dialog" aria-modal="true" aria-labelledby="marker-dialog-title"><h2 id="marker-dialog-title" class="marker-dialog-title">添加位置标记</h2><p class="marker-dialog-description">为地图上的位置填写名称，也可以补充备注。</p><label class="marker-dialog-field"><span>标记名称</span><input id="marker-dialog-name" type="text" maxlength="80" required autocomplete="off"></label><label class="marker-dialog-field"><span>备注（可选）</span><textarea id="marker-dialog-note" rows="2" maxlength="160" placeholder="留空则不显示"></textarea></label><div class="marker-dialog-actions"><button id="marker-dialog-cancel" class="map-tool" type="button">取消</button><button class="map-tool primary" type="submit">确定</button></div></form></div>
<div class="work-panel collapsed" id="work-panel"><div class="floating-title"><span>案例清单</span><button class="panel-toggle" id="work-toggle" type="button">展开</button></div><div class="panel-body" id="work-body"><div class="list-tabs"><button class="list-tab active" id="case-tab" type="button">案例 <span id="case-tab-count">0</span></button><button class="list-tab" id="unlocated-tab" type="button">未定位 <span id="unlocated-tab-count">0</span></button></div><section class="list-section" id="case-section"><input id="case-search" class="case-search" type="search" placeholder="搜索标题、位置、房屋用途……"><select id="case-sort" class="case-sort" aria-label="案例排序"><option value="date_desc">时间：新到旧</option><option value="date_asc">时间：旧到新</option><option value="price_desc">首年租金：高到低</option><option value="price_asc">首年租金：低到低</option></select><div id="case-meta" class="case-meta"></div><ul id="case-list" class="case-list"></ul></section><section class="list-section hidden" id="unlocated-section"><div id="unlocated-meta" class="case-meta"></div><ul id="unlocated-list" class="unlocated-list"></ul></section></div></div>
<script>const DATA=${dataJson};${amapMaps.browserScript()}
AppraisalAmap.watch(DATA.mapConfig);</script>
<script src="leaflet.js"></script><script src="leaflet.markercluster.js"></script>
<script>
(function(){if(!window.L){AppraisalAmap.report("地图组件未能加载，请检查网络后刷新页面。");return;}
const map=AppraisalAmap.createMap("map",{preferCanvas:true,zoomControl:false},DATA.mapConfig,(message,kind)=>{const status=document.getElementById("tile-status");if(status){status.textContent=message;status.hidden=kind==="ok";}}).setView([30.25,120.16],9);L.control.zoom({position:"bottomright"}).addTo(map);
const cluster=window.L&&L.markerClusterGroup?L.markerClusterGroup({disableClusteringAtZoom:15,showCoverageOnHover:false}):L.layerGroup();const markers=new Map();const located=DATA.points||[];const unlocated=DATA.unlocated||[];const selectedKeys=new Set();const referenceMarkerData=[];const referenceMarkerLayers=new Map();const distanceLayer=L.layerGroup().addTo(map);let distanceLinesVisible=false;let placementMode=false;let pendingMarkerPosition=null;const esc=v=>String(v??"").replace(/[&<>"']/g,m=>m==="&"?"&amp;":m==="<"?"&lt;":m===">"?"&gt;":m.charCodeAt(0)===34?"&quot;":"&#39;");const numberText=v=>{const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n.toLocaleString("zh-CN",{maximumFractionDigits:2}):esc(v)};const markerKind=item=>String(item.resultStatus||"")==="成交"?"residential":"commercial";const storageKey="tianyuan-alibaba-lease-map-reference-v1:"+String(location.pathname||"default");
function radians(value){return Number(value)*Math.PI/180}function distanceKm(a,b,c,d){const lat1=Number(a),lon1=Number(b),lat2=Number(c),lon2=Number(d);if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return null;const dLat=radians(lat2-lat1),dLon=radians(lon2-lon1),x=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLon/2)**2;return 6371.0088*2*Math.atan2(Math.sqrt(Math.min(1,x)),Math.sqrt(Math.max(0,1-x)))}function distanceText(value){return value<1?Math.round(value*1000)+" m":value.toFixed(2)+" km"}function itemDistance(item,marker){return distanceKm(item.latitude,item.longitude,marker.lat,marker.lon)}
function iconFor(item){return L.divIcon({className:"case-pin",html:"<span class='"+(selectedKeys.has(String(item.id))?"selected":markerKind(item))+"'></span>",iconSize:[20,20],iconAnchor:[10,18]})}function referenceIcon(){return L.divIcon({className:"reference-pin",html:"<span></span>",iconSize:[24,24],iconAnchor:[12,22]})}function markerById(id){return referenceMarkerData.find(item=>item.id===String(id))}
function referencePopup(item){return "<div class='case-popup-title'>"+esc(item.name)+"</div><div class='case-popup-meta'>"+(item.note?esc(item.note)+"<br>":"")+"纬度："+item.lat.toFixed(6)+"<br>经度："+item.lon.toFixed(6)+"<br>"+(item.editing?"编辑状态：可拖动":"位置已锁定，点击“编辑”后可移动")+"</div>"}function referenceLabel(item){return "<div class='reference-label-name'>"+esc(item.name)+"</div>"+(item.note?"<div class='reference-label-note'>"+esc(item.note)+"</div>":"")}
function saveReferenceMarkers(){try{localStorage.setItem(storageKey,JSON.stringify(referenceMarkerData.map(({editing,...item})=>item)))}catch{}}function renderReferenceMarkerList(){const list=document.getElementById("reference-marker-list"),clear=document.getElementById("clear-reference-markers");if(!list)return;list.innerHTML=referenceMarkerData.map(item=>"<div class='reference-marker-row'><span class='reference-marker-name' data-marker-id='"+esc(item.id)+"' title='"+esc(item.note?item.name+"："+item.note:item.name)+"'><span>"+esc(item.name)+"</span>"+(item.note?"<small class='reference-marker-note'>"+esc(item.note)+"</small>":"")+"</span><button class='map-tool reference-marker-edit' type='button' data-edit-marker-id='"+esc(item.id)+"' aria-label='"+(item.editing?"完成编辑":"编辑位置")+"'>"+(item.editing?"完成":"编辑")+"</button><button class='reference-marker-delete' type='button' data-delete-marker-id='"+esc(item.id)+"' aria-label='删除 "+esc(item.name)+"'>×</button></div>").join("");list.querySelectorAll(".reference-marker-name").forEach(node=>node.addEventListener("click",()=>{const marker=referenceMarkerLayers.get(node.dataset.markerId);if(marker){map.flyTo(marker.getLatLng(),Math.max(map.getZoom(),14),{duration:.5});marker.openPopup()}}));list.querySelectorAll("[data-edit-marker-id]").forEach(node=>node.addEventListener("click",()=>{const item=markerById(node.dataset.editMarkerId);if(item)setReferenceMarkerEditing(item.id,!item.editing)}));list.querySelectorAll("[data-delete-marker-id]").forEach(node=>node.addEventListener("click",()=>removeReferenceMarker(node.dataset.deleteMarkerId)));if(clear)clear.disabled=referenceMarkerData.length===0}
function setReferenceMarkerEditing(id,editing){const item=markerById(id),marker=referenceMarkerLayers.get(String(id));if(!item||!marker)return;item.editing=Boolean(editing);if(item.editing)marker.dragging?.enable();else marker.dragging?.disable();marker.setPopupContent(referencePopup(item));renderReferenceMarkerList();updateStatus(item.editing?"“"+item.name+"”已进入编辑状态，可拖动位置；调整完成后点击“完成”。":"“"+item.name+"”已锁定，位置已保存。")}
function updateStatus(text){const node=document.getElementById("map-tool-status");if(node)node.textContent=text}function setPlacementMode(enabled){placementMode=Boolean(enabled);const button=document.getElementById("add-reference-marker");button?.classList.toggle("active",placementMode);if(button)button.textContent=placementMode?"取消放置标记":"插入位置标记";map.getContainer().classList.toggle("placing-reference",placementMode);updateStatus(placementMode?"请点击地图选择位置，然后输入标记名称。":"标记默认锁定；点击清单中的“编辑”后才可以移动。")}
function addReferenceMarker(data,persist=true){const item={id:String(data.id||("marker-"+Date.now()+"-"+Math.random().toString(36).slice(2,7))),name:String(data.name||"位置标记"),note:String(data.note||"").trim(),lat:Number(data.lat),lon:Number(data.lon),editing:false};if(!Number.isFinite(item.lat)||!Number.isFinite(item.lon))return;referenceMarkerData.push(item);const marker=L.marker([item.lat,item.lon],{icon:referenceIcon(),draggable:true,zIndexOffset:2000}).addTo(map);marker.dragging?.disable();marker.bindPopup(referencePopup(item));marker.bindTooltip(referenceLabel(item),{permanent:true,direction:"top",offset:[0,-12],opacity:.98,className:"reference-label",sticky:false});marker.on("dragend",()=>{const position=marker.getLatLng(),current=markerById(item.id);if(!current)return;current.lat=position.lat;current.lon=position.lng;marker.setPopupContent(referencePopup(current));marker.setTooltipContent(referenceLabel(current));saveReferenceMarkers();if(distanceLinesVisible)renderDistanceResults([...selectedKeys])});referenceMarkerLayers.set(item.id,marker);if(persist)saveReferenceMarkers();renderReferenceMarkerList()}
function removeReferenceMarker(id){const marker=referenceMarkerLayers.get(String(id));marker?.remove();referenceMarkerLayers.delete(String(id));const index=referenceMarkerData.findIndex(item=>item.id===String(id));if(index>=0)referenceMarkerData.splice(index,1);saveReferenceMarkers();renderReferenceMarkerList();if(distanceLinesVisible)renderDistanceResults([...selectedKeys])}function loadReferenceMarkers(){try{const saved=JSON.parse(localStorage.getItem(storageKey)||"[]");if(Array.isArray(saved))saved.filter(item=>item&&Number.isFinite(Number(item.lat))&&Number.isFinite(Number(item.lon))).forEach(item=>addReferenceMarker(item,false))}catch{}renderReferenceMarkerList()}
function selectedRows(ids){const keys=new Set((Array.isArray(ids)?ids:[]).map(value=>String(value)));return located.filter(item=>keys.has(String(item.id)))}function clearDistanceLines(){distanceLayer.clearLayers()}function renderDistanceResults(ids){const panel=document.getElementById("distance-panel"),note=document.getElementById("distance-panel-note"),results=document.getElementById("distance-results");if(!panel||!note||!results)return;panel.hidden=false;clearDistanceLines();const rows=selectedRows(ids);if(!referenceMarkerData.length){distanceLinesVisible=false;note.textContent="请先点击“插入位置标记”，在地图上放置至少一个标记点。";results.innerHTML="<div class='distance-empty'>当前没有可计算的标记点。</div>";return}if(!rows.length){distanceLinesVisible=false;note.textContent="请先在结果表中勾选有坐标的案例。";results.innerHTML="<div class='distance-empty'>当前没有选中的可定位案例。</div>";return}distanceLinesVisible=true;let lineCount=0;const lines=[];rows.forEach(row=>referenceMarkerData.forEach(marker=>{const distance=itemDistance(row,marker);if(distance===null)return;const line=L.polyline([[marker.lat,marker.lon],[row.latitude,row.longitude]],{color:"#f97316",weight:2,opacity:.9,dashArray:"7 5"}).addTo(distanceLayer);line.bindTooltip(distanceText(distance),{permanent:true,direction:"center",opacity:.98,className:"distance-label",sticky:false});lines.push(marker.name+" → "+(row.title||row.address||("案例 "+row.id))+"："+distanceText(distance));lineCount++}));note.textContent="已绘制 "+lineCount+" 条距离线；标记点默认锁定，进入编辑状态后拖动会自动更新。";results.innerHTML=lines.map(line=>"<div>"+esc(line)+"</div>").join("")||"<div class='distance-empty'>选中案例缺少有效坐标。</div>";updateMarkers()}
function closeMarkerDialog(){const dialog=document.getElementById("marker-dialog");if(dialog)dialog.hidden=true;pendingMarkerPosition=null;setPlacementMode(false)}function openMarkerDialog(latlng){const dialog=document.getElementById("marker-dialog"),name=document.getElementById("marker-dialog-name"),note=document.getElementById("marker-dialog-note");if(!dialog||!name||!note)return;pendingMarkerPosition={lat:Number(latlng.lat),lon:Number(latlng.lng)};name.value="位置标记 "+(referenceMarkerData.length+1);note.value="";dialog.hidden=false;requestAnimationFrame(()=>{name.focus();name.select()})}function confirmMarkerDialog(event){event.preventDefault();const name=document.getElementById("marker-dialog-name"),note=document.getElementById("marker-dialog-note"),trimmed=String(name?.value||"").trim();if(!trimmed){name?.focus();return}if(!pendingMarkerPosition){closeMarkerDialog();return}addReferenceMarker({name:trimmed,note:String(note?.value||"").trim(),lat:pendingMarkerPosition.lat,lon:pendingMarkerPosition.lon});closeMarkerDialog();updateStatus("已添加“"+trimmed+"”，位置已锁定；如需调整请点击“编辑”。")}
function initReferenceMarkers(){document.getElementById("add-reference-marker")?.addEventListener("click",()=>setPlacementMode(!placementMode));document.getElementById("clear-reference-markers")?.addEventListener("click",()=>{referenceMarkerData.slice().forEach(item=>removeReferenceMarker(item.id));updateStatus("标记已清除。点击“插入位置标记”后可重新放置。")});document.getElementById("close-distance-panel")?.addEventListener("click",()=>{const panel=document.getElementById("distance-panel");if(panel)panel.hidden=true});document.getElementById("marker-dialog-form")?.addEventListener("submit",confirmMarkerDialog);document.getElementById("marker-dialog-cancel")?.addEventListener("click",closeMarkerDialog);document.getElementById("marker-dialog")?.addEventListener("click",event=>{if(event.target?.id==="marker-dialog")closeMarkerDialog()});document.addEventListener("keydown",event=>{const dialog=document.getElementById("marker-dialog");if(event.key==="Escape"&&dialog&&!dialog.hidden)closeMarkerDialog()});map.on("click",event=>{if(placementMode)openMarkerDialog(event.latlng)});loadReferenceMarkers()}
  function popup(item){const coordinateSource=item.coordinateProvider==="amap"?"高德坐落位置搜索":item.coordinateProvider==="nominatim"?"Nominatim 备用搜索":item.coordinateSource==="address-search"?"坐落位置搜索":"详情页明确坐标";const precision=item.coordinatePrecision==="poi"?"POI 精确点":item.coordinatePrecision==="address"?"地址点":"详情页坐标";const distances=distanceLinesVisible&&selectedKeys.has(String(item.id))?referenceMarkerData.map(marker=>itemDistance(item,marker)).filter(Number.isFinite):[];const distanceLine=distances.length?"<br>距位置标记："+distances.map(distanceText).join(" / "):"";return "<div class='case-popup-title'><span class='case-label-index'>序号 "+esc(item.id)+"</span>"+esc(item.title||"阿里资产租赁案例")+"</div><div class='case-popup-meta'>房屋用途："+esc(item.houseUsage||item.propertyType||"未填写")+"<br>坐落位置："+esc(item.address||"未填写")+"<br>结束时间："+esc(item.endTime||"未填写")+"<br>成交价（首年租金）："+(item.transactionAmount===0||item.transactionAmount?numberText(item.transactionAmount)+" 元":"未填写")+"<br>建筑面积："+numberText(item.buildingArea||"")+" m²<br>租期："+esc(item.leaseTermYears?item.leaseTermYears+" 年":"未填写")+"<br>结果状态："+esc(item.resultStatus||"未填写")+distanceLine+"<br>坐标来源："+coordinateSource+"（"+precision+"）<br><a href='"+esc(item.url||"#")+"' target='_blank' rel='noopener noreferrer'>打开详情页</a></div>"}
function focus(item){const marker=markers.get(String(item?.id));if(!marker)return;const show=()=>{map.flyTo(marker.getLatLng(),Math.max(map.getZoom(),15),{duration:.45});marker.openPopup()};if(cluster.zoomToShowLayer)cluster.zoomToShowLayer(marker,show);else show()}
const basePopup=popup;const popupUnitPrice=value=>value===null||value===undefined||String(value).trim()===""?"未填写":numberText(value)+" 元/m²·月";popup=item=>basePopup(item);
function sortAmount(value){const parsed=Number(String(value??"").replace(/,/g,"").trim());return Number.isFinite(parsed)?parsed:0}
  function renderCaseList(){const query=String(document.getElementById("case-search")?.value||"").trim().toLowerCase(),sort=String(document.getElementById("case-sort")?.value||"date_desc"),rows=located.filter(item=>!query||[item.title,item.address,item.propertyType,item.endTime,item.district].join(" ").toLowerCase().includes(query)).slice().sort((a,b)=>sort.startsWith("price")?(sortAmount(a.transactionAmount)-sortAmount(b.transactionAmount))*(sort.endsWith("desc")?-1:1):String(a.transactionTime||"").localeCompare(String(b.transactionTime||""))*(sort.endsWith("desc")?-1:1));document.getElementById("case-meta").textContent="共 "+rows.length+" 条，点击案例可定位地图；点击地图标记可多选/取消并同步高亮表格；先在结果明细中勾选案例，再点击“显示到标记距离”。";document.getElementById("case-tab-count").textContent=located.length;document.getElementById("case-list").innerHTML=rows.map(item=>{const distances=distanceLinesVisible&&selectedKeys.has(String(item.id))?referenceMarkerData.map(marker=>itemDistance(item,marker)).filter(Number.isFinite):[];const distance=distances.length?"<span class='case-item-distance'>距标记 "+distances.map(distanceText).join(" / ")+"</span>":"";const amount=sortAmount(item.transactionAmount),amountText=amount?"首年租金 "+amount.toLocaleString("zh-CN",{maximumFractionDigits:2})+" 元":"首年租金未填写";return "<li class='case-item"+(selectedKeys.has(String(item.id))?" active":"")+"' data-id='"+esc(item.id)+"'><div class='case-item-title'><span class='case-item-index'>序号 "+esc(item.id)+"</span>"+esc(item.title||item.address||"未填写标题")+"</div><span class='case-item-sub'>"+esc([item.houseUsage||item.propertyType,item.address,item.endTime].filter(Boolean).join(" · "))+"</span>"+distance+"<div class='case-item-footer'><span class='case-item-price'>"+esc(amountText)+"</span><span class='case-item-link'>定位</span></div></li>"}).join("")||"<li class='case-item'>没有匹配记录</li>";document.querySelectorAll("#case-list .case-item[data-id]").forEach(node=>node.addEventListener("click",()=>focus(located.find(item=>String(item.id)===node.dataset.id))))}
const baseRenderCaseList=renderCaseList;const listUnitPrice=value=>{const number=Number(String(value??"").replace(/,/g,"").trim());return Number.isFinite(number)?number.toLocaleString("zh-CN",{maximumFractionDigits:2}):String(value||"未填写")};renderCaseList=()=>{baseRenderCaseList();document.querySelectorAll("#case-list .case-item[data-id]").forEach(node=>{const item=located.find(row=>String(row.id)===String(node.dataset.id));const footer=node.querySelector(".case-item-footer"),link=footer?.querySelector(".case-item-link");if(!item||!footer||!link)return;const unit=document.createElement("span");unit.className="case-item-unit-price";unit.textContent="月租金 "+listUnitPrice(item.monthlyUnitPrice)+" 元/m²·月";unit.style.color="#475569";unit.style.fontWeight="600";footer.insertBefore(unit,link)})};function updateMarkers(){located.forEach(item=>{const marker=markers.get(String(item.id));if(marker){marker.setIcon(iconFor(item));marker.setPopupContent(popup(item))}});renderCaseList()}function setSelected(ids){selectedKeys.clear();(Array.isArray(ids)?ids:[]).forEach(id=>selectedKeys.add(String(id)));updateMarkers();if(distanceLinesVisible)renderDistanceResults([...selectedKeys])}
  function syncCaseLabels(){const mode=map.getZoom()>=11?"compact":"none";located.forEach(item=>{const marker=markers.get(String(item.id));if(!marker)return;if(mode==="none"){if(marker.getTooltip())marker.unbindTooltip();return}if(marker.getTooltip())return;marker.bindTooltip("<div class='case-label-wrap'><div class='case-label-title'><span class='case-label-index'>序号 "+esc(item.id)+"</span>"+esc(item.address||"未填写位置")+"</div><div class='case-label-price'>月租金单价："+popupUnitPrice(item.monthlyUnitPrice)+"</div></div>",{permanent:true,direction:"top",offset:[0,-18],opacity:.98,className:"case-label",sticky:false})});}queueMicrotask(()=>{map.on("zoomend",syncCaseLabels);syncCaseLabels()});
function initLists(){document.getElementById("case-search")?.addEventListener("input",renderCaseList);document.getElementById("case-sort")?.addEventListener("change",renderCaseList);document.getElementById("work-toggle")?.addEventListener("click",()=>{const root=document.getElementById("work-panel"),collapsed=root.classList.toggle("collapsed");document.getElementById("work-toggle").textContent=collapsed?"展开":"收起"});[["case-tab","case-section"],["unlocated-tab","unlocated-section"]].forEach(([tabId,sectionId])=>document.getElementById(tabId)?.addEventListener("click",()=>{[["case-tab","case-section"],["unlocated-tab","unlocated-section"]].forEach(([otherTab,otherSection])=>{const active=otherTab===tabId;document.getElementById(otherTab)?.classList.toggle("active",active);document.getElementById(otherSection)?.classList.toggle("hidden",!active)})}));document.getElementById("unlocated-meta").textContent="共 "+unlocated.length+" 条，未返回坐标的记录保留在这里。";document.getElementById("unlocated-tab-count").textContent=unlocated.length;document.getElementById("unlocated-list").innerHTML=unlocated.slice(0,200).map(item=>"<li><strong>"+esc(item.title||item.address||"未填写标题")+"</strong><br>"+esc([item.houseUsage||item.propertyType,item.endTime].filter(Boolean).join("｜"))+"<span class='unlocated-reason'>"+esc(item.coordinateStatus||"未定位（缺少有效坐标）")+"</span></li>").join("")||"<li>没有未定位记录。</li>"}
  located.forEach(item=>{const marker=L.marker([item.latitude,item.longitude],{icon:iconFor(item)});marker.bindPopup(popup(item));marker.on("click",()=>{const key=String(item.id);if(selectedKeys.has(key))selectedKeys.delete(key);else selectedKeys.add(key);updateMarkers();if(window.parent!==window)window.parent.postMessage({type:"ALIBABA_MAP_SELECTION_CHANGED",ids:[...selectedKeys],focusId:key},"*")});markers.set(String(item.id),marker);cluster.addLayer(marker)});map.addLayer(cluster);const bounds=located.map(item=>[item.latitude,item.longitude]);if(bounds.length)map.fitBounds(bounds,{padding:[30,30]});initLists();initReferenceMarkers();renderCaseList();window.addEventListener("message",event=>{const message=event.data||{};if(message.type==="ALIBABA_MAP_SET_SELECTED")setSelected(message.ids);if(message.type==="ALIBABA_MAP_FOCUS")focus(located.find(item=>String(item.id)===String(Array.isArray(message.ids)?message.ids[0]:message.id)));if(message.type==="ALIBABA_MAP_DISTANCE_REQUEST"){setSelected(message.ids);renderDistanceResults(message.ids)}});if(window.parent!==window)window.parent.postMessage({type:"ALIBABA_MAP_READY"},"*");if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize()).observe(document.body);
})();
</script></body></html>`;
}

function writeMapAssets(results, request = {}) {
  for (const relativePath of MAP_ASSET_RELATIVE_PATHS) {
    const source = path.join(MAP_ASSET_SOURCE_DIRECTORY, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`ALIBABA_LEASE_MAP_ASSET_MISSING: ${relativePath}`);
  }
  const outputDirectory = outputDirectoryFor(request);
  for (const relativePath of MAP_ASSET_RELATIVE_PATHS) {
    const source = path.join(MAP_ASSET_SOURCE_DIRECTORY, relativePath);
    const target = path.join(outputDirectory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp-${process.pid}`;
    fs.copyFileSync(source, temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
  }
  const rows = mapRowsFromResults(results);
  const points = rows.filter((item) => item.longitude !== null && item.latitude !== null);
  const unlocated = rows.filter((item) => item.longitude === null || item.latitude === null);
  const mapData = {
    stats: { total: rows.length, located: points.length, unlocated: unlocated.length },
    points,
    unlocated,
    mapConfig: loadMapConfig(),
  };
  const coordsPath = path.join(outputDirectory, RESULT_COORDS_NAME);
  const pointsJsPath = path.join(outputDirectory, RESULT_POINTS_NAME);
  const mapPath = path.join(outputDirectory, RESULT_MAP_NAME);
  writeUtf8Atomic(coordsPath, `${JSON.stringify(points, null, 2)}\n`);
  writeUtf8Atomic(pointsJsPath, `window.ALIBABA_LEASE_POINTS = ${JSON.stringify(points)};\n`);
  writeUtf8Atomic(mapPath, renderLeaseMapHtml(mapData, request));
  return { coordsPath, pointsJsPath, mapPath, locatedCount: points.length, unlocatedCount: unlocated.length };
}

function removeMapAssets(request = {}) {
  const outputDirectory = outputDirectoryFor(request);
  for (const name of [RESULT_COORDS_NAME, RESULT_POINTS_NAME, RESULT_MAP_NAME, ...MAP_ASSET_RELATIVE_PATHS]) {
    try { fs.unlinkSync(path.join(outputDirectory, name)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  try { fs.rmdirSync(path.join(outputDirectory, "images")); } catch (error) { if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error; }
}

function renderResultHtml(results, request, metadata = {}) {
  const columns = RESULT_EXCEL_COLUMNS;
  const numericFields = RESULT_EXCEL_NUMERIC_FIELDS;
  const formatCellNumber = (field, value) => {
    if (!numericFields.has(field)) return null;
    const number = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(number) && String(value ?? "").trim() !== ""
      ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
      : null;
  };
  const header = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const locatedCount = (Array.isArray(results) ? results : []).filter((item) => item?.longitude != null && item?.latitude != null).length;
  const rows = (Array.isArray(results) ? results : []).map((item, rowIndex) => {
    const mapKey = String(rowIndex + 1);
    const hasCoordinate = item?.longitude != null && item?.latitude != null;
    const checkbox = `<input class="result-select" type="checkbox" data-map-key="${mapKey}" aria-label="选择第 ${rowIndex + 1} 条案例"${hasCoordinate ? "" : " disabled title=\"该记录没有坐标，无法在地图上定位\""}>`;
    const cells = columns.map(([, field]) => {
      const value = field === "url" && item?.[field] && safeExportUrl(item[field])
        ? `<a href="${escapeHtml(safeExportUrl(item[field]))}" target="_blank" rel="noopener noreferrer">打开详情</a>`
        : escapeHtml(formatCellNumber(field, item?.[field]) ?? (item?.[field] === null || item?.[field] === undefined ? "" : item[field]));
      return `<td class="${numericFields.has(field) ? "numeric-cell" : ""}">${value}</td>`;
    }).join("");
    return `<tr data-map-key="${mapKey}"${hasCoordinate ? "" : " class=\"no-coordinate\""}><td class="sequence-cell">${mapKey}</td><td class="select-cell">${checkbox}</td>${cells}</tr>`;
  }).join("");
  const sourceUrl = escapeHtml(safeExportUrl(request.sourceUrl));
  const generatedAt = escapeHtml(new Date().toLocaleString("zh-CN", { hour12: false }));
  const skipped = Number(metadata.skipped || 0);
  const candidates = Number(metadata.candidates || results.length);
  const mapName = request.generateMap === false || !locatedCount ? "" : "latest_map.html";
  const mapLink = mapName
    ? `<a class="button secondary" href="${mapName}" target="_blank" rel="noopener noreferrer">打开独立地图</a>`
    : '<span class="inline-muted">本次未生成地图（未勾选生成，或没有可定位记录）。</span>';
  const mapPreview = mapName
    ? `<div class="map-frame-shell" aria-label="可调整大小的地图区域"><iframe id="alibaba-lease-map-frame" title="阿里资产租赁地图" src="${mapName}"></iframe><div id="alibaba-lease-map-resize-handle" class="map-resize-handle" role="separator" aria-orientation="vertical" aria-label="拖动调整地图高度" title="拖动调整地图高度"></div></div>`
    : '<div class="map-empty">本次未生成地图；结果表仍保留坐标状态。</div>';
  const excelActions = `<div class="actions"><a class="button" href="${RESULT_JSON_NAME}" download>下载 JSON</a>${mapLink}</div>`;
  const emptyNotice = results.length ? "" : '<div class="inline-notice"><strong>暂未找到符合条件的租赁成交案例</strong><p>请检查地区、标的状态、结束时间范围，或确认候选列表中存在租赁/使用权条目。</p></div>';
  const filterScript = `<script>
(() => {
  const frame = document.getElementById("alibaba-lease-map-frame");
  const shell = document.querySelector(".map-frame-shell");
  const resizeHandle = document.getElementById("alibaba-lease-map-resize-handle");
  const filter = document.getElementById("result-filter");
  const count = document.getElementById("result-count");
  const clearSelection = document.getElementById("clear-selection");
  const clearFilters = document.getElementById("clear-filters");
  const distanceButton = document.getElementById("show-selected-distances");
  const rows = Array.from(document.querySelectorAll("#result-table tbody tr[data-map-key]"));
  const selected = new Set();
  let resizeState = null;
  function send(message) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, "*"); }
  function updateSelection() {
    document.querySelectorAll(".result-select").forEach((input) => input.closest("tr")?.classList.toggle("selected-row", input.checked));
    if (count) count.textContent = "显示 " + rows.filter((row) => !row.hidden).length + " 条，已选 " + selected.size + " 条";
    if (clearSelection) clearSelection.disabled = selected.size === 0;
    if (distanceButton) distanceButton.disabled = selected.size === 0 || !frame?.contentWindow;
    send({ type: "ALIBABA_MAP_SET_SELECTED", ids: [...selected] });
  }
  function applyMapSelection(ids, focusId) {
    selected.clear();
    const validKeys = new Set(rows.map((row) => String(row.dataset.mapKey || "")));
    (Array.isArray(ids) ? ids : []).forEach((id) => { const key = String(id); if (validKeys.has(key)) selected.add(key); });
    document.querySelectorAll(".result-select").forEach((input) => { input.checked = selected.has(String(input.dataset.mapKey || "")); });
    updateSelection();
    const target = rows.find((row) => String(row.dataset.mapKey || "") === String(focusId || ""));
    if (target && !target.hidden) { target.classList.add("selected-row"); target.scrollIntoView?.({ block: "nearest" }); }
  }
  function applyFilters() {
    const query = String(filter?.value || "").trim().toLowerCase();
    rows.forEach((row) => { row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query); });
    updateSelection();
  }
  function stopResize(event) {
    if (!resizeState) return;
    resizeState = null;
    document.body.classList.remove("resizing-map");
  }
  resizeHandle?.addEventListener("pointerdown", (event) => {
    if (!shell) return;
    event.preventDefault();
    resizeState = { y: event.clientY, height: shell.getBoundingClientRect().height };
    resizeHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("resizing-map");
  });
  resizeHandle?.addEventListener("pointermove", (event) => {
    if (!resizeState || !shell) return;
    shell.style.height = Math.max(window.innerWidth < 820 ? 320 : 380, Math.round(resizeState.height + event.clientY - resizeState.y)) + "px";
  });
  resizeHandle?.addEventListener("pointerup", stopResize);
  resizeHandle?.addEventListener("pointercancel", stopResize);
  rows.forEach((row) => {
    const checkbox = row.querySelector(".result-select");
    checkbox?.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.mapKey;
      if (!key) return;
      if (event.currentTarget.checked) selected.add(key); else selected.delete(key);
      updateSelection();
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("input, a, button")) return;
      send({ type: "ALIBABA_MAP_FOCUS", ids: [row.dataset.mapKey] });
    });
  });
  filter?.addEventListener("input", applyFilters);
  clearFilters?.addEventListener("click", () => { if (filter) filter.value = ""; applyFilters(); });
  clearSelection?.addEventListener("click", () => {
    selected.clear();
    document.querySelectorAll(".result-select").forEach((input) => { input.checked = false; });
    updateSelection();
  });
  distanceButton?.addEventListener("click", () => {
    if (selected.size) send({ type: "ALIBABA_MAP_DISTANCE_REQUEST", ids: [...selected] });
  });
  frame?.addEventListener("load", () => {
    send({ type: "ALIBABA_MAP_SET_SELECTED", ids: [...selected] });
    if (distanceButton) distanceButton.disabled = selected.size === 0;
  });
  window.addEventListener("message", (event) => {
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    const message = event.data || {};
    if (message.type === "ALIBABA_MAP_SELECTION_CHANGED") applyMapSelection(message.ids, message.focusId);
  });
  applyFilters();
})();
</script>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>阿里资产租赁抓取结果</title>
<style>
:root{color-scheme:light;--text:#1c2430;--muted:#667085;--line:#e5e9f0;--soft:#f8fafc;--blue:#2457c5}*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1480px;margin:0 auto;padding:12px 20px 24px}h1{margin:0;font-size:20px}h2{margin:0;font-size:16px}.muted{color:var(--muted)}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px}.head p{margin:1px 0;color:var(--muted)}.head-right{text-align:right;color:var(--muted);font-size:12px}.summary-strip{display:flex;align-items:center;flex-wrap:wrap;gap:3px 12px;padding:4px 8px;margin-bottom:4px;background:#fff;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:12px;line-height:1.35}.summary-strip strong{color:var(--text)}.source{min-width:0;overflow:hidden;display:flex;align-items:center;gap:5px}.source-label{flex:0 0 auto}.source a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source a,a{color:var(--blue);text-decoration:none}.source a:hover,a:hover{text-decoration:underline}.card{background:#fff;border:1px solid var(--line);border-radius:9px;box-shadow:0 3px 12px rgba(29,41,57,.04);padding:10px;margin:8px 0}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}.actions{display:flex;gap:7px;flex-wrap:wrap}.button{display:inline-block;padding:6px 10px;border:0;border-radius:7px;background:var(--blue);color:#fff;text-decoration:none;font-size:12px;white-space:nowrap;cursor:pointer}.button.secondary{background:#eef3ff;color:var(--blue)}.inline-muted{color:var(--muted);font-size:12px}.map-frame-shell{position:relative;width:100%;height:440px;min-height:380px;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:#f8fafc}.map-frame-shell iframe{display:block;width:100%;height:100%;border:0;border-radius:inherit}.map-resize-handle{position:absolute;z-index:4;left:0;right:0;bottom:0;height:14px;cursor:ns-resize;touch-action:none;background:linear-gradient(to bottom,transparent 0,transparent 45%,rgba(36,87,197,.15) 46%,rgba(36,87,197,.15) 54%,transparent 55%)}.map-resize-handle:after{content:"";position:absolute;left:50%;bottom:4px;width:34px;height:3px;transform:translateX(-50%);border-radius:4px;background:#98a2b3}.map-empty,.inline-notice{padding:12px;color:var(--muted);background:#f8fafc;border-radius:7px}.inline-notice{margin-bottom:8px;color:#8b5e00;background:#fff8e6}.inline-notice p{margin:3px 0 0}.table-toolbar{display:flex;align-items:center;gap:7px;margin:-1px 0 8px}.result-filter{width:300px;max-width:100%;padding:6px 8px;border:1px solid #d0d7e2;border-radius:7px;font:inherit;font-size:12px}.result-filter:focus{outline:2px solid #c7d7ff;border-color:var(--blue)}.result-count{color:var(--muted);font-size:12px}.clear-selection,.clear-filters,.show-distance{border:0;border-radius:7px;padding:6px 9px;background:#eef3ff;color:var(--blue);font-size:12px;cursor:pointer}.clear-selection:disabled{opacity:.45;cursor:default}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:7px;max-height:60vh}table{border-collapse:collapse;width:max-content;min-width:100%;white-space:nowrap;font-size:12px}th,td{padding:7px 9px;border-bottom:1px solid #edf0f5;text-align:left;vertical-align:middle}th{position:sticky;top:0;z-index:3;background:var(--soft);font-weight:700}td.numeric-cell{text-align:right;font-variant-numeric:tabular-nums}th.sequence-column,td.sequence-cell{width:48px;text-align:center;color:#475467;font-variant-numeric:tabular-nums}th:first-child,td.select-cell{width:36px;text-align:center;padding-left:6px;padding-right:6px}.result-select{width:14px;height:14px;accent-color:#f97316}tr[data-map-key]{cursor:pointer}tr[data-map-key]:hover{background:#f5f8ff}tr.selected-row{background:#fff4df!important}tr.no-coordinate{background:#fffaf0}a{color:var(--blue)}tr.empty td{padding:26px 14px;color:var(--muted);text-align:center}.foot{margin-top:8px;color:var(--muted);font-size:12px}body.resizing-map{user-select:none;cursor:ns-resize}body.resizing-map iframe{pointer-events:none}@media (max-width:820px){main{padding:10px 12px 20px}.head{display:block}.head-right{text-align:left}.map-frame-shell{height:360px;min-height:320px}.table-toolbar{flex-wrap:wrap}}
</style></head><body><main>
<div class="head"><div><h1>阿里资产租赁抓取结果</h1><p>本地脚本读取租赁列表并逐条核验详情；结果仅保存在本机。</p></div><div class="head-right">生成于 ${generatedAt}</div></div>
<div class="summary-strip"><span>核验通过：<strong>${results.length}</strong> 条</span><span>页面记录：<strong>${candidates}</strong> 条</span><span>跳过：<strong>${skipped}</strong> 条</span><span>可定位：<strong>${locatedCount}</strong> 条</span><span>区域：<strong>${escapeHtml([request.province, request.city, request.district].filter(Boolean).join(" ") || "不限")}</strong></span><span>物业类型：<strong>${escapeHtml(request.propertyType === "commercial" ? "商业用房" : "住宅用房")}</strong></span><span>状态：<strong>${request.status === "finished" ? "已结束" : "全部状态"}</strong></span><span>结束时间：<strong>${escapeHtml(request.startDate || "不限")} 至 ${escapeHtml(request.endDate || "不限")}</strong></span>${sourceUrl ? `<span class="source"><span class="source-label">检索来源：</span><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceUrl}</a></span>` : ""}</div>
<section class="card"><div class="section-heading"><h2>地图（${locatedCount} 条可定位结果）</h2>${excelActions}</div>${mapPreview}</section>
<section class="card"><div class="section-heading"><h2>租赁案例明细</h2></div>${emptyNotice}<div class="table-toolbar"><input id="result-filter" class="result-filter" type="search" placeholder="筛选标题、位置、房屋用途……" aria-label="筛选租赁案例"><span id="result-count" class="result-count"></span><button id="clear-filters" class="clear-filters" type="button">清除筛选</button><button id="show-selected-distances" class="show-distance" type="button" disabled>显示到标记距离</button><button id="clear-selection" class="clear-selection" type="button" disabled>清除勾选</button></div><div class="table-wrap"><table id="result-table"><thead><tr><th class="sequence-column">序号</th><th>选择</th>${header}</tr></thead><tbody>${rows || `<tr class="empty"><td colspan="${columns.length + 2}">暂未找到符合条件的租赁案例</td></tr>`}</tbody></table></div></section>
<div class="foot">仅保留详情页确认成交且出价大于 0 的记录；点击行可在地图中定位，勾选有坐标的案例后可突出显示并计算到位置标记的距离。</div>
${filterScript}</main></body></html>`;
}

function writeResultHtml(results, request, metadata) {
  const target = path.join(outputDirectoryFor(request), RESULT_HTML_NAME);
  writeUtf8Atomic(target, renderResultHtml(results, request, metadata));
  return target;
}

function writeHistoryManifest(results, request, metadata = {}, outputs = {}) {
  const outputDirectory = outputDirectoryFor(request);
  const target = path.join(outputDirectory, RESULT_HISTORY_NAME);
  const payload = {
    type: "alibaba-lease-history",
    version: 1,
    generatedAt: new Date().toISOString(),
    request: { ...request },
    metadata: {
      candidates: Number(metadata.candidates || results.length),
      skipped: Number(metadata.skipped || 0),
      locatedCount: Number(outputs.locatedCount || 0),
    },
    outputs: {
      html: outputs.html ? path.basename(outputs.html) : RESULT_HTML_NAME,
      json: RESULT_JSON_NAME,
      map: outputs.map ? path.basename(outputs.map) : "",
      coords: outputs.coords ? path.basename(outputs.coords) : "",
    },
    results,
  };
  writeUtf8Atomic(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

function validCoordinatePair(value) {
  const longitude = Number(value?.longitude);
  const latitude = Number(value?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < 70 || longitude > 140 || latitude < 3 || latitude > 55) return null;
  return { longitude, latitude };
}

function normalizeGeocodeText(value) {
  return String(value || "")
    .replace(/[\u00a0\t\r\n]+/g, " ")
    .replace(/[，,、；;|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressSearchVariants(address, request = {}) {
  const raw = normalizeGeocodeText(address);
  if (!raw) return [];
  const context = [request.province, request.city, request.district]
    .map(normalizeGeocodeText)
    .filter(Boolean);
  const full = normalizeGeocodeText([...context, raw].join(" "));
  const noParenthetical = normalizeGeocodeText(raw.replace(/[（(][^）)]{0,100}[）)]/g, " "));
  const coarse = normalizeGeocodeText(noParenthetical
    .replace(/\d{1,5}\s*(?:号|幢|栋|座|单元|室|层|楼)/g, " ")
    .replace(/(?:第\s*)?\d{1,5}\s*(?:号楼|号院)/g, " "));
  const variants = [
    full,
    normalizeGeocodeText([...context, noParenthetical].join(" ")),
    normalizeGeocodeText([...context, coarse].join(" ")),
    normalizeGeocodeText([request.city, request.district, coarse].filter(Boolean).join(" ")),
    raw,
  ];
  return [...new Set(variants.filter(Boolean))];
}

function outOfChina(longitude, latitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(longitude, latitude) {
  const value = -100 + 2 * longitude + 3 * latitude + 0.2 * latitude * latitude
    + 0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
  return value + (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3
    + (20 * Math.sin(latitude * Math.PI) + 40 * Math.sin(latitude / 3 * Math.PI)) * 2 / 3
    + (160 * Math.sin(latitude / 12 * Math.PI) + 320 * Math.sin(latitude * Math.PI / 30)) * 2 / 3;
}

function transformLongitude(longitude, latitude) {
  const value = 300 + longitude + 2 * latitude + 0.1 * longitude * longitude
    + 0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
  return value + (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3
    + (20 * Math.sin(longitude * Math.PI) + 40 * Math.sin(longitude / 3 * Math.PI)) * 2 / 3
    + (150 * Math.sin(longitude / 12 * Math.PI) + 300 * Math.sin(longitude / 30 * Math.PI)) * 2 / 3;
}

function gcj02ToWgs84(longitude, latitude) {
  const pair = validCoordinatePair({ longitude, latitude });
  if (!pair || outOfChina(pair.longitude, pair.latitude)) return pair;
  const dLatitude = transformLatitude(pair.longitude - 105, pair.latitude - 35);
  const dLongitude = transformLongitude(pair.longitude - 105, pair.latitude - 35);
  const radLatitude = pair.latitude / 180 * Math.PI;
  let magic = Math.sin(radLatitude);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    longitude: Number((pair.longitude - (dLongitude * 180 / (6378245 * sqrtMagic * Math.cos(radLatitude) * Math.PI))).toFixed(6)),
    latitude: Number((pair.latitude - (dLatitude * 180 / (6335552.717 * magic * sqrtMagic * Math.PI))).toFixed(6)),
  };
}

function amapCityCode(request = {}) {
  for (const value of [request.districtCode, request.cityCode]) {
    if (/^\d{6}$/.test(String(value || "").trim())) return String(value).trim();
  }
  return "";
}

function amapCandidates(payload) {
  const list = payload?.data?.tip_list;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => entry?.tip || entry).filter((entry) => entry && typeof entry === "object");
}

function candidateScore(candidate, query, request = {}, address = "") {
  const text = normalizeGeocodeText([
    candidate?.name, candidate?.address, candidate?.district, candidate?.cityname,
  ].filter(Boolean).join(" "));
  const compactText = text.replace(/\s+/g, "");
  const compactAddress = normalizeGeocodeText(address).replace(/\s+/g, "");
  const compactQuery = normalizeGeocodeText(query).replace(/\s+/g, "");
  let score = 0;
  if (compactAddress && (compactText.includes(compactAddress) || compactAddress.includes(compactText))) score += 40;
  if (compactQuery && compactText.includes(compactQuery)) score += 30;
  for (const value of [request.city, request.district]) {
    const token = normalizeGeocodeText(value).replace(/[省市区县]$/g, "");
    if (!token) continue;
    if (text.includes(token)) score += 12;
    else score -= 12;
  }
  if (candidate?.name && compactAddress && compactAddress.includes(normalizeGeocodeText(candidate.name).replace(/\s+/g, ""))) score += 8;
  return score;
}

function parseAmapCoordinate(payload, query, request = {}, address = "") {
  const candidates = amapCandidates(payload)
    .map((candidate) => ({
      candidate,
      coordinates: gcj02ToWgs84(candidate?.x, candidate?.y),
      score: candidateScore(candidate, query, request, address),
    }))
    .filter((entry) => entry.coordinates)
    .sort((left, right) => right.score - left.score);
  const selected = candidates[0];
  if (!selected) return null;
  return {
    ...selected.coordinates,
    coordinateSource: "address-search",
    coordinateProvider: "amap",
    coordinatePrecision: selected.score >= 40 ? "poi" : "address",
  };
}

function parseNominatimCoordinate(payload) {
  const first = Array.isArray(payload) ? payload[0] : null;
  const result = validCoordinatePair({ longitude: first?.lon, latitude: first?.lat });
  return result ? { ...result, coordinateSource: "address-search", coordinateProvider: "nominatim", coordinatePrecision: "address" } : null;
}

function geocodeCachePath() {
  const configured = String(process.env.TIANYUAN_ALIBABA_LEASE_GEOCODE_CACHE_PATH || "").trim();
  return configured && path.isAbsolute(configured) ? configured : DEFAULT_GEOCODE_CACHE_PATH;
}

function loadPersistentGeocodeCache() {
  const target = geocodeCachePath();
  if (geocodeCacheLoadedPath === target) return;
  geocodeCache.clear();
  geocodeFailureCache.clear();
  geocodeCacheLoadedPath = target;
  geocodeCacheDirty = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    if (parsed?.version !== GEOCODE_CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") return;
    for (const [key, value] of Object.entries(parsed.entries)) {
      const cacheKey = String(key || "").trim();
      const coordinates = validCoordinatePair(value);
      if (cacheKey && coordinates) geocodeCache.set(cacheKey, coordinates);
    }
  } catch {
    // 缓存缺失或损坏不致命，下次成功查询会原子重写。
  }
}

function persistGeocodeCache() {
  if (!geocodeCacheDirty) return;
  const target = geocodeCachePath();
  const entries = {};
  for (const [key, value] of geocodeCache.entries()) {
    const coordinates = validCoordinatePair(value);
    if (coordinates) entries[key] = coordinates;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeUtf8Atomic(target, `${JSON.stringify({ version: GEOCODE_CACHE_VERSION, entries }, null, 2)}\n`);
    geocodeCacheDirty = false;
  } catch {
    // 定位失败不阻塞结果生成；本次内存值保留，下次重试。
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(value, timeoutMs, controller) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      const error = new Error("GEOCODE_TIMEOUT");
      error.code = "GEOCODE_TIMEOUT";
      reject(error);
    }, Math.max(1, timeoutMs));
  });
  return Promise.race([Promise.resolve(value), timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function geocodeAddress(address, request = {}, options = {}) {
  const rawAddress = String(address || "").replace(/\s+/g, " ").trim();
  const queries = addressSearchVariants(rawAddress, request);
  if (!rawAddress || !queries.length || typeof fetch !== "function") {
    return { result: null, cacheHit: false, requested: false, timedOut: false };
  }
  loadPersistentGeocodeCache();
  const deadlineAt = Number.isFinite(Number(options.deadlineAt))
    ? Number(options.deadlineAt)
    : Date.now() + GEOCODE_TOTAL_BUDGET_MS;
  const providers = [
    {
      name: "amap",
      buildEndpoint(query) {
        const endpoint = new URL(AMAP_GEOCODE_ENDPOINT);
        endpoint.searchParams.set("words", query);
        endpoint.searchParams.set("datatype", "poi");
        const cityCode = amapCityCode(request);
        if (cityCode) endpoint.searchParams.set("city", cityCode);
        return endpoint;
      },
      parse(payload, query) {
        return parseAmapCoordinate(payload, query, request, rawAddress) || parseNominatimCoordinate(payload);
      },
    },
    {
      name: "nominatim",
      buildEndpoint(query) {
        const endpoint = new URL(NOMINATIM_GEOCODE_ENDPOINT);
        endpoint.searchParams.set("format", "jsonv2");
        endpoint.searchParams.set("limit", "1");
        endpoint.searchParams.set("countrycodes", "cn");
        endpoint.searchParams.set("q", query);
        return endpoint;
      },
      parse: parseNominatimCoordinate,
    },
  ];
  let requested = 0;
  let cacheHits = 0;
  let timedOut = false;
  for (const provider of providers) {
    for (const query of queries) {
      const cacheKey = `${provider.name}:${query.toLowerCase()}`;
      const cachedValue = geocodeCache.get(cacheKey);
      if (cachedValue) {
        cacheHits += 1;
        return {
          result: { ...cachedValue, coordinateSource: "address-search", coordinateProvider: provider.name },
          cacheHit: true,
          requested: requested > 0 ? 1 : 0,
          timedOut,
        };
      }
      if (geocodeFailureCache.has(cacheKey)) continue;
      if (Date.now() >= deadlineAt) return { result: null, cacheHit: cacheHits > 0, requested: requested > 0 ? 1 : 0, timedOut: true };

      const waitForRateLimit = GEOCODE_MIN_INTERVAL_MS - (Date.now() - lastGeocodeAt);
      if (waitForRateLimit > 0) {
        if (Date.now() + waitForRateLimit >= deadlineAt) return { result: null, cacheHit: cacheHits > 0, requested: requested > 0 ? 1 : 0, timedOut: true };
        await wait(waitForRateLimit);
      }
      if (Date.now() >= deadlineAt) return { result: null, cacheHit: cacheHits > 0, requested: requested > 0 ? 1 : 0, timedOut: true };

      lastGeocodeAt = Date.now();
      const controller = new AbortController();
      const requestDeadlineAt = Date.now() + Math.max(1, Math.min(GEOCODE_REQUEST_TIMEOUT_MS, deadlineAt - Date.now()));
      try {
        const endpoint = provider.buildEndpoint(query);
        const response = await withTimeout(fetch(endpoint, {
          headers: {
            accept: "application/json",
            "accept-language": "zh-CN",
            "user-agent": "AppraisalToolbox local map export",
          },
          signal: controller.signal,
        }), requestDeadlineAt - Date.now(), controller);
        requested += 1;
        if (!response.ok) throw new Error(`GEOCODE_HTTP_${response.status}`);
        const payload = await withTimeout(response.json(), requestDeadlineAt - Date.now(), controller);
        const result = provider.parse(payload, query);
        if (!result) {
          geocodeFailureCache.add(cacheKey);
          continue;
        }
        const coordinates = validCoordinatePair(result);
        if (!coordinates) {
          geocodeFailureCache.add(cacheKey);
          continue;
        }
        geocodeCache.set(cacheKey, { ...coordinates });
        geocodeFailureCache.delete(cacheKey);
        geocodeCacheDirty = true;
        persistGeocodeCache();
        return { result: { ...coordinates, ...result, coordinateSource: "address-search", coordinateProvider: result.coordinateProvider || provider.name }, cacheHit: cacheHits > 0, requested: requested > 0 ? 1 : 0, timedOut };
      } catch (error) {
        requested += 1;
        timedOut = timedOut || error?.code === "GEOCODE_TIMEOUT" || controller.signal.aborted;
        geocodeFailureCache.add(cacheKey);
      }
    }
  }
  return { result: null, cacheHit: cacheHits > 0, requested: requested > 0 ? 1 : 0, timedOut };
}

const emptyGeocodeStats = () => ({
  geocodeRequested: 0,
  geocodeCacheHits: 0,
  geocodeResolved: 0,
  geocodeFailed: 0,
  geocodeTimedOut: 0,
  geocodeDurationMs: 0,
});

function geocodeQueryFor(item, request = {}) {
  return String(item?.location || "").trim()
    || [item?.community, request.district, request.city].filter(Boolean).join(" ");
}

async function enrichResultsWithCoordinates(results, request = {}) {
  const startedAt = Date.now();
  const output = (Array.isArray(results) ? results : []).map((item) => ({
    ...item,
    endTime: normalizeDate(item?.endTime),
  }));
  const stats = emptyGeocodeStats();
  loadPersistentGeocodeCache();
  geocodeFailureCache.clear();
  const deadlineAt = startedAt + GEOCODE_TOTAL_BUDGET_MS;
  for (const item of output) {
    if (item.longitude != null && item.latitude != null) continue;
    const address = geocodeQueryFor(item, request);
    if (!address) continue;
    if (Date.now() >= deadlineAt) {
      stats.geocodeTimedOut += 1;
      break;
    }
    const lookup = await geocodeAddress(address, {
      ...request,
      province: item.province || request.province,
      city: item.city || request.city,
      district: item.district || request.district,
    }, { deadlineAt });
    stats.geocodeRequested += Number(lookup.requested || 0);
    if (lookup.cacheHit && lookup.result) stats.geocodeCacheHits += 1;
    if (lookup.timedOut) stats.geocodeTimedOut += 1;
    if (lookup.requested && !lookup.result && !lookup.timedOut) stats.geocodeFailed += 1;
    if (!lookup.result) continue;
    item.longitude = lookup.result.longitude;
    item.latitude = lookup.result.latitude;
    item.coordinateStatus = "已定位（坐落位置搜索）";
    item.coordinateSource = lookup.result.coordinateSource || "address-search";
    item.coordinateProvider = lookup.result.coordinateProvider || "";
    item.coordinatePrecision = lookup.result.coordinatePrecision || "address";
    stats.geocodeResolved += 1;
  }
  const attempted = stats.geocodeRequested || stats.geocodeCacheHits || stats.geocodeResolved || stats.geocodeFailed || stats.geocodeTimedOut;
  stats.geocodeDurationMs = attempted ? Date.now() - startedAt : 0;
  return { results: output, stats };
}

async function writeResultArtifacts(results, request, metadata = {}) {
  const baseResults = (Array.isArray(results) ? results : []).map(normalizeResultRow);
  let enrichedResults = baseResults;
  let geocodeStats = emptyGeocodeStats();
  if (request.generateMap !== false) {
    try {
      const enrichment = await enrichResultsWithCoordinates(baseResults, request);
      enrichedResults = enrichment.results;
      geocodeStats = enrichment.stats;
    } catch {
      // 定位管线异常不阻塞结果产物生成。
      enrichedResults = baseResults.map((item) => ({ ...item, endTime: normalizeDate(item?.endTime) }));
      geocodeStats = emptyGeocodeStats();
    }
  }
  const outputDirectory = outputDirectoryFor(request);
  const jsonPath = path.join(outputDirectory, RESULT_JSON_NAME);
  writeUtf8Atomic(jsonPath, `${JSON.stringify({
    type: "alibaba-lease-result",
    version: 1,
    generatedAt: new Date().toISOString(),
    request: { ...request },
    metadata: { ...metadata, ...geocodeStats },
    results: enrichedResults,
  }, null, 2)}\n`);
  const htmlPath = writeResultHtml(enrichedResults, request, metadata);
  let mapArtifacts = { mapPath: "", coordsPath: "", pointsJsPath: "", locatedCount: 0, unlocatedCount: enrichedResults.length };
  if (request.generateMap === false) {
    removeMapAssets(request);
  } else {
    const located = enrichedResults.filter((item) => item.longitude != null && item.latitude != null).length;
    if (!located) {
      removeMapAssets(request);
    } else {
      try {
        mapArtifacts = writeMapAssets(enrichedResults, request);
      } catch (error) {
        if (!String(error?.message || "").startsWith("ALIBABA_LEASE_MAP_ASSET_MISSING")) throw error;
        mapArtifacts = { mapPath: "", coordsPath: "", pointsJsPath: "", locatedCount: located, unlocatedCount: enrichedResults.length - located };
      }
    }
  }
  const historyPath = writeHistoryManifest(enrichedResults, request, metadata, mapArtifacts);
  return {
    htmlPath,
    jsonPath,
    historyPath,
    results: enrichedResults,
    ...mapArtifacts,
    ...geocodeStats,
    mapGeneration: mapArtifacts.mapPath
      ? "generated"
      : request.generateMap === false
        ? "disabled"
        : "skipped_no_coordinates",
  };
}

function validateResultOutputPath(value, outputDirectory = RESULT_ROOT, extensions = [".html", ".xlsx"]) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_LEASE_RESULT_PATH_INVALID");
  const resolved = path.resolve(raw);
  let root;
  try { root = fs.realpathSync(outputDirectory); } catch { throw new Error("ALIBABA_LEASE_OUTPUT_DIRECTORY_INVALID"); }
  if (!isInsideDirectory(root, resolved) || !extensions.includes(path.extname(resolved).toLowerCase())) {
    throw new Error("ALIBABA_LEASE_RESULT_PATH_NOT_ALLOWED");
  }
  return resolved;
}

function normalizeExcelRows(results) {
  return (Array.isArray(results) ? results : []).map(normalizeResultRow);
}

async function runCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      timeout: options.timeout || 180000,
      maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || "");
        error.stderr = String(stderr || "");
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function writeResultExcel(results, request, metadata = {}, outputPath = "") {
  const rows = normalizeExcelRows(results);
  if (!rows.length) throw new Error("ALIBABA_LEASE_EXCEL_NO_RESULTS");
  const outputDirectory = outputDirectoryFor(request);
  const target = validateResultOutputPath(outputPath || path.join(outputDirectory, RESULT_EXCEL_NAME), outputDirectory, [".xlsx"]);
  const payloadPath = path.join(outputDirectory, `.lease-excel-export-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({
    columns: RESULT_EXCEL_COLUMNS,
    numericFields: [...RESULT_EXCEL_NUMERIC_FIELDS],
    rows,
    metadata: {
      candidates: Number(metadata.candidates || rows.length),
      skipped: Number(metadata.skipped || 0),
    },
  }), { encoding: "utf8", mode: 0o600 });
  try {
    const execution = await runCommand(PYTHON_BIN, ["-X", "utf8", "-c", RESULT_EXCEL_SCRIPT, payloadPath, target], { timeout: 180000 });
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size <= 0) throw new Error("ALIBABA_LEASE_EXCEL_READBACK_FAILED");
    return {
      ok: true,
      action: "write_alibaba_lease_excel",
      excelPath: target,
      rowCount: rows.length,
      fileSize: stat.size,
      pythonEngine: String(execution.stdout || "").trim(),
      security: security(),
    };
  } catch (error) {
    throw pythonExportFailure(error, "ALIBABA_LEASE_EXCEL_EXPORT_FAILED");
  } finally {
    try { fs.unlinkSync(payloadPath); } catch { /* already removed */ }
  }
}

function openResultPath(value, outputDirectory = RESULT_ROOT) {
  return validateResultOutputPath(value, outputDirectory, [".html", ".xlsx", ".json"]);
}

module.exports = {
  RESULT_ROOT,
  RESULT_EXCEL_COLUMNS,
  addressSearchVariants,
  gcj02ToWgs84,
  geocodeAddress,
  enrichResultsWithCoordinates,
  normalizeRequest,
  normalizeResultRow,
  normalizeDate,
  outputDirectoryFor,
  parseAmapCoordinate,
  parseNominatimCoordinate,
  renderResultHtml,
  renderLeaseMapHtml,
  writeResultArtifacts,
  writeResultExcel,
  openResultPath,
  safeError,
  security,
};
