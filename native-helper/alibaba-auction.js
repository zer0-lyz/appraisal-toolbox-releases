"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const amapMaps = require("./amap-map.js");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");

const { resolvePythonBin } = require("./runtime_config.js");
const { pythonExportFailure } = require("./diagnostics.js");
const PYTHON_BIN = resolvePythonBin();
const DEFAULT_SESSION = "alibaba-auction";
const DEFAULT_SOURCE_URL = "https://sf.taobao.com/list/50025969__2.htm";
const RESULT_ROOT = path.join(process.env.LOCALAPPDATA || os.homedir(), "AppraisalToolbox", "outputs", "alibaba-auction");
const RESULT_HTML_NAME = "latest.html";
const RESULT_EXCEL_NAME = "latest.xlsx";
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
const GEOCODE_CACHE_VERSION = 1;
const DEFAULT_GEOCODE_CACHE_PATH = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "AppraisalToolbox",
  "cache",
  "alibaba-auction-geocode.json",
);
const GEOCODE_REQUEST_TIMEOUT_MS = 4500;
const GEOCODE_TOTAL_BUDGET_MS = 12000;
const GEOCODE_MIN_INTERVAL_MS = 300;
const AMAP_GEOCODE_ENDPOINT = "https://www.amap.com/service/poiTips";
const NOMINATIM_GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const SAFE_MAX_PAGES = 50;
const MANUAL_VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_BROWSER_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TIMEOUT_MS = 30000;
const OCR_TIMEOUT_MS = 120000;
const OCR_MAX_PAGES = 20;
const OCR_MAX_TEXT_LENGTH = 200000;
const PROPERTY_LABELS = {
  residential: "住宅用房",
  commercial: "商业房",
};
const RESULT_EXCEL_COLUMNS = Object.freeze([
  ["案例标题", "title"],
  ["省份", "province"],
  ["城市", "city"],
  ["区县", "district"],
  ["物业类型", "propertyType"],
  ["坐落位置", "address"],
  ["交易时间", "transactionTime"],
  ["交易金额（元）", "transactionAmount"],
  ["评估价", "valuationAmount"],
  ["建筑面积（m²）", "buildingArea"],
  ["单价", "unitPrice"],
  ["所在楼层", "floor"],
  ["总层数", "totalFloors"],
  ["装修", "decoration"],
  ["租赁情况", "leaseStatus"],
  ["案例平台", "platform"],
  ["出价次数", "bidCount"],
  ["核验状态", "verificationStatus"],
  ["坐标状态", "coordinateStatus"],
  ["经度", "longitude"],
  ["纬度", "latitude"],
  ["案例网址", "url"],
]);
const RESULT_EXCEL_NUMERIC_FIELDS = new Set([
  "longitude", "latitude", "transactionAmount", "valuationAmount", "buildingArea", "unitPrice", "totalFloors", "bidCount",
]);
const PDF_TEXT_SCRIPT = String.raw`
import json
import sys

pdf_path = sys.argv[1]
extractors = []

try:
    from pypdf import PdfReader
    extractors.append(lambda: "\n".join((page.extract_text() or "") for page in PdfReader(pdf_path).pages))
except Exception:
    pass

try:
    from PyPDF2 import PdfReader as PyPdf2Reader
    extractors.append(lambda: "\n".join((page.extract_text() or "") for page in PyPdf2Reader(pdf_path).pages))
except Exception:
    pass

try:
    import pdfplumber
    def pdfplumber_extract():
        with pdfplumber.open(pdf_path) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)
    extractors.append(pdfplumber_extract)
except Exception:
    pass

for extractor in extractors:
    try:
        text = extractor()
        print(json.dumps({"ok": True, "text": text[:200000]}, ensure_ascii=False))
        break
    except Exception:
        continue
else:
    print(json.dumps({"ok": False, "error": "PDF_TEXT_EXTRACTOR_UNAVAILABLE"}, ensure_ascii=False))
`;
const PDF_OCR_SCRIPT = String.raw`
import json
import os
import re
import sys

pdf_path = sys.argv[1]
page_limit = max(1, int(sys.argv[2] if len(sys.argv) > 2 else 20))
page_texts = []

try:
    import fitz
    from rapidocr_onnxruntime import RapidOCR

    document = fitz.open(pdf_path)
    page_count = min(document.page_count, page_limit)
    engine = RapidOCR()
    for page_index in range(page_count):
        image_path = os.path.join(os.path.dirname(pdf_path), "ocr-page-" + str(page_index + 1) + ".png")
        try:
            pixmap = document[page_index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            pixmap.save(image_path)
            result, _ = engine(image_path)
            if result:
                page_texts.append("\n".join(str(item[1]) for item in result if len(item) > 1 and item[1]))
                recognized = "\n\n".join(page_texts)
                has_area = re.search(r"(?:建筑|房屋|产权)?面积[^\d]{0,80}\d+(?:[.,]\d+)?\s*(?:平方米|平米|㎡|m²|m2)", recognized, re.I)
                has_floor = re.search(r"(?:所在|总|建筑物|建筑|房屋)?(?:楼层|层数|总楼层)[^\d一二两三四五六七八九十百零]{0,40}[\d一二两三四五六七八九十百零]+\s*层?", recognized)
                if has_area and has_floor:
                    break
        finally:
            try:
                os.remove(image_path)
            except OSError:
                pass
    document.close()
    print(json.dumps({
        "ok": True,
        "engine": "rapidocr_onnxruntime",
        "pages": page_count,
        "text": "\n\n".join(page_texts)[:200000],
    }, ensure_ascii=False))
except Exception as error:
    print(json.dumps({
        "ok": False,
        "error": "PDF_OCR_UNAVAILABLE",
        "detail": type(error).__name__,
    }, ensure_ascii=False))
`;
const BROWSER_ATTACHMENT_SCRIPT = String.raw`(async (href) => {
  const response = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", href, true);
    request.responseType = "arraybuffer";
    request.withCredentials = true;
    request.onload = () => resolve(request);
    request.onerror = () => reject(new Error("ALIBABA_BROWSER_ATTACHMENT_REQUEST_FAILED"));
    request.ontimeout = () => reject(new Error("ALIBABA_BROWSER_ATTACHMENT_TIMEOUT"));
    request.timeout = 30000;
    request.send();
  });
  const bytes = new Uint8Array(response.response || new ArrayBuffer(0));
  if (bytes.length > 20971520) return { ok: false, error: "ALIBABA_ATTACHMENT_TOO_LARGE" };
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return {
    ok: response.status === 200 && bytes.length > 0,
    status: response.status,
    contentType: response.getResponseHeader("content-type") || "",
    base64: btoa(binary),
  };
})`;
const BROWSER_LOCATION_SCRIPT = String.raw`(() => ({
  url: location.href,
  readyState: document.readyState,
}))()`;
const RESULT_EXCEL_SCRIPT = String.raw`
import json
import os
import sys

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

payload_path, target_path = sys.argv[1:3]
with open(payload_path, "r", encoding="utf-8") as stream:
    payload = json.load(stream)

columns = payload["columns"]
numeric_fields = set(payload["numericFields"])
rows = payload["rows"]
temporary_path = target_path + ".tmp.xlsx"
os.makedirs(os.path.dirname(target_path), exist_ok=True)

try:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "成交案例"
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
    widths = [32, 10, 10, 12, 12, 32, 20, 16, 16, 14, 14, 12, 10, 10, 14, 12, 10, 16, 24, 12, 12, 52]
    for column_index, width in enumerate(widths, 1):
        sheet.column_dimensions[chr(64 + column_index) if column_index <= 26 else "A"].width = width
    sheet.row_dimensions[1].height = 22
    workbook.properties.creator = "Tianyuan Workbench"
    workbook.save(temporary_path)
    workbook.close()

    check_workbook = load_workbook(temporary_path, read_only=True, data_only=True)
    check_sheet = check_workbook["成交案例"]
    if check_sheet.max_row != len(rows) + 1 or check_sheet.max_column != len(columns):
        raise RuntimeError("ALIBABA_EXCEL_READBACK_FAILED")
    check_workbook.close()
    os.replace(temporary_path, target_path)
finally:
    if os.path.exists(temporary_path):
        os.remove(temporary_path)
`;

const LIST_EXTRACT_SCRIPT = String.raw`(() => {
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : element.getClientRects?.().length > 0;
  };
  const items = [];
  const seen = new Set();
  for (const anchor of [...document.querySelectorAll('a[href*="/sf_item/"]')].filter(isVisible)) {
    const href = anchor.href || "";
    if (!href || seen.has(href)) continue;
    const text = clean(anchor.innerText || anchor.textContent || "");
    if (!text) continue;
    seen.add(href);
    const listedAmount = text.match(/(?:成交价|拍下价|最终成交价|成交金额|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*[\d,]+(?:\.\d+)?\s*(?:万|亿|元)?/i)?.[0] || "";
    const listedBidCount = Number(text.match(/(\d+)\s*次出价/i)?.[1] || 0);
    items.push({ href, text, listedAmount, listedBidCount, listedHasEndedText: /已结束/.test(text), listedHasExplicitSoldPrice: /(?:成交价|拍下价|最终成交价|成交金额)/.test(text) });
  }
  const body = document.body?.innerText || "";
  const totalMatch = body.match(/共找到\\s*([\\d,]+)\\s*条/);
  return {
    url: location.href,
    title: document.title,
    total: totalMatch ? totalMatch[1] : "",
    items,
    pageText: clean(body.slice(0, 1200)),
    verificationRequired: [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
      || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body),
  };
})()`;

const DETAIL_EXTRACT_SCRIPT = String.raw`(async () => {
  const clean = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : element.getClientRects?.().length > 0;
  };
  const coordinate = (value, minimum, maximum) => {
    const number = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  };
  const pair = (longitude, latitude, source) => {
    const lng = coordinate(longitude, 70, 140);
    const lat = coordinate(latitude, 3, 55);
    return lng !== null && lat !== null ? { longitude: lng, latitude: lat, coordinateSource: source } : null;
  };
  const fromText = (value, source) => {
    const text = String(value || "");
    const patterns = [
      /(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["'\s,;，；\]}]{0,80}(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["'\s,;，；\]}]{0,80}(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    ];
    for (const [index, pattern] of patterns.entries()) {
      const match = text.match(pattern);
      if (!match) continue;
      const result = index === 1 ? pair(match[2], match[1], source) : pair(match[1], match[2], source);
      if (result) return result;
    }
    return null;
  };
  const extractBuildingArea = (value) => {
    const text = clean(value)
      .replace(/[，]/g, ",")
      .replace(/[：]/g, ":")
      .replace(/(?:专有|分摊|套内|共有|使用权)建筑面积/g, (match) => match.replace("建筑", ""));
    const patterns = [
      /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*[（(]\s*(?:平方米|平米|㎡|m²|m2|平方公尺)\s*[）)]\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)/i,
      /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约|合计|共计)\s*)?(?:为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?=$|[,。；;])/i,
      /(?:房屋|房产|不动产|建筑物)?(?:建筑|房屋|房产|产权)面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:合计建筑面积|建筑总面积|房屋建筑总面积|标的物建筑面积|证载建筑面积|房产证建筑面积|不动产建筑面积)\s*(?:[:=：]\s*)?(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:标的物|拍卖标的|房屋|房地产|不动产)\s*面积\s*(?:为|是|[:：])?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:房屋|房地产|不动产)\s*[，,]\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:^|[；;。\n（(]|\d[、.])\s*面积\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].replace(/\s+/g, " ").trim();
    }
    return "";
  };
  let coordinates = null;
  for (const element of document.querySelectorAll("[data-lng], [data-lat], [data-longitude], [data-latitude], [longitude], [latitude], [经度], [纬度]")) {
    coordinates = pair(
      element.getAttribute("data-lng") || element.getAttribute("data-longitude") || element.getAttribute("longitude") || element.getAttribute("经度"),
      element.getAttribute("data-lat") || element.getAttribute("data-latitude") || element.getAttribute("latitude") || element.getAttribute("纬度"),
      "detail-dom",
    );
    if (coordinates) break;
  }
  if (!coordinates) {
    for (const element of document.querySelectorAll("iframe[src], a[href]")) {
      coordinates = fromText(element.getAttribute("src") || element.getAttribute("href"), "detail-url");
      if (coordinates) break;
    }
  }
  if (!coordinates) {
    for (const script of document.scripts) {
      coordinates = fromText(script.textContent, "detail-script");
      if (coordinates) break;
    }
  }
  const detailRoot = document.querySelector("#J_desc") || document.querySelector("#J_ItemDetailContent");
  const detailContentText = clean(detailRoot?.innerText || detailRoot?.textContent || "");
  const detailContentReady = !detailRoot
    || (detailContentText.length > 0 && !/(?:加载中|loading)/i.test(detailContentText));
  const loadSupplementalSection = async (selector, linkSelector) => {
    const section = document.querySelector(selector);
    if (!section) return "";
    let text = clean(section.innerText || section.textContent || "");
    if (!/(?:加载中|loading)/i.test(text)) return text;
    section.scrollIntoView?.({ block: "center" });
    const link = document.querySelector(linkSelector);
    link?.scrollIntoView?.({ block: "center" });
    link?.click?.();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      text = clean(section.innerText || section.textContent || "");
      if (text && !/(?:加载中|loading)/i.test(text)) break;
    }
    return text;
  };
  const noticeText = await loadSupplementalSection("#NoticeDetail", '#J_DetailTabMenu a[href="#NoticeDetail"]');
  const noticeHasFields = /(?:建筑面积|房屋面积|房产证|证载面积)/.test(detailContentText + "\n" + noticeText)
    && /(?:所在楼层|楼层|总层数)/.test(detailContentText + "\n" + noticeText);
  const itemNoticeText = noticeHasFields ? "" : await loadSupplementalSection("#ItemNotice", '#J_DetailTabMenu a[href="#ItemNotice"]');
  const body = document.body?.innerText || "";
  const scriptText = [...document.scripts].map((script) => script.textContent || "").join("\n");
  const detailText = detailContentText + "\n" + noticeText + "\n" + itemNoticeText + "\n" + body + "\n" + scriptText;
  const attachments = [];
  const attachmentSeen = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.href || "";
    const name = clean(anchor.innerText || anchor.textContent || "附件");
    if (!href || (!/download_attach\.do/i.test(href) && !/\.pdf(?:$|[?#])/i.test(href))) continue;
    if (attachmentSeen.has(href)) continue;
    attachmentSeen.add(href);
    attachments.push({ name: name.slice(0, 120), href });
  }
  const normalizeFloorValue = (value) => {
    let normalized = clean(value).replace(/[（(][^）)]*[）)]/g, "").replace(/第/g, "").replace(/^(?:为|是|位于|在)\s*/, "").trim();
    if (!normalized || /^(?:总|共|建筑|层数|楼层|总层数|总楼层|所在|数|全部楼层)$/.test(normalized)) return "";
    if (/^\s*[\/／]/.test(normalized)) return "";
    normalized = normalized.replace(/\s*(?:总|共)\s*(?:计)?\s*(?:层数|楼层|层|楼)?\s*$/, "").trim();
    normalized = normalized.replace(/(地下|地上|负)\s+(?=[\d一二两三四五六七八九十百零])/g, "$1");
    const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const toNumber = (text) => {
      if (/^\d+$/.test(text)) return text;
      if (text === "十") return "10";
      const ten = text.indexOf("十");
      if (ten >= 0) {
        const tens = ten === 0 ? 1 : digits[text[ten - 1]];
        const ones = ten === text.length - 1 ? 0 : digits[text[ten + 1]];
        if (Number.isInteger(tens) && Number.isInteger(ones)) return String(tens * 10 + ones);
      }
      return text.length === 1 && Number.isInteger(digits[text]) ? String(digits[text]) : text;
    };
    normalized = normalized.replace(/(地下|地上|负)?([一二两三四五六七八九十百零]+)/g, (match, prefix, number) => (prefix || "") + toNumber(number));
    if (/^(顶|底|中|高|低)(层)?$/.test(normalized)) return normalized.endsWith("层") ? normalized : normalized + "层";
    normalized = normalized.replace(/[层楼]\s*$/, "").replace(/\s+/g, "").trim();
    return /^(?:地上|地下|负)?\d+(?:[至\-—~～](?:地上|地下|负)?\d+)?$/.test(normalized) ? normalized : "";
  };
  const readLabeledValue = (labels) => {
    const wanted = labels.map((label) => String(label));
    const valueFromText = (value) => {
      const text = clean(value);
      if (!text || text.length > 120) return "";
      const label = wanted.find((item) => text === item || text.startsWith(item));
      if (!label || text === label) return "";
      return text.slice(label.length).replace(/^[\s:：-]*(?:为|是)?\s*/, "").trim();
    };
    const valueFromNode = (node) => valueFromText(node?.innerText || node?.textContent || "");
    for (const node of document.querySelectorAll("th,td,dt,dd,label,span,div,p")) {
      if (!isVisible(node)) continue;
      const text = clean(node.innerText || node.textContent || "");
      if (!text || text.length > 120) continue;
      const inline = valueFromText(text);
      if (inline) return inline;
      if (!wanted.includes(text)) continue;
      const row = node.closest("tr");
      const cells = row ? [...row.children] : [];
      const cellIndex = cells.indexOf(node.closest("th,td"));
      const candidates = [
        cellIndex >= 0 ? cells[cellIndex + 1] : null,
        node.nextElementSibling,
        node.parentElement?.nextElementSibling,
        ...(node.parentElement ? [...node.parentElement.children].slice([...node.parentElement.children].indexOf(node) + 1) : []),
      ];
      for (const candidate of candidates) {
        if (!candidate || !isVisible(candidate)) continue;
        const value = valueFromNode(candidate);
        if (value && !wanted.includes(value)) return value;
      }
    }
    const lines = body.split(/\r?\n/).map(clean).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const inline = valueFromText(line);
      if (inline) return inline;
      if (wanted.includes(line) && lines[index + 1] && !wanted.includes(lines[index + 1])) return lines[index + 1];
    }
    return "";
  };
  const heading = document.querySelector("h1")?.innerText || "";
  const statusText = detailText.match(/(?:本场|拍卖)?已结束|本场已流拍|本场已撤回|本场已中止|报名截止|预计[^\n]{0,30}结束/gi) || [];
  const locationMatch = body.match(/标的物位置\s*([\s\S]{0,180}?)地图标注仅供参考/);
  const usageMatch = body.match(/房屋用途及\s*土地性质\s*([\s\S]{0,140}?)(?:钥匙|使用情况|拍卖权利限制情况)/);
  const areaValue = readLabeledValue(["建筑面积", "房屋建筑面积", "房屋面积", "登记建筑面积", "登记面积", "证载建筑面积", "证载面积", "产权证载面积", "产权证建筑面积", "房产证建筑面积", "不动产权证书建筑面积"]);
  const buildingArea = extractBuildingArea(detailText) || extractBuildingArea("建筑面积 " + areaValue + "平方米");
  const decorationMatch = detailText.match(/(?:装修及其他介绍|装修情况|装修)\s*[：:\s]+([^\n\r|；;]{1,40})/i);
  const leaseMatch = detailText.match(/(?:租赁情况|租赁状态|是否有租赁|租赁)\s*[：:\s]+([^\n\r|；;]{1,60})/i);
  const floorValue = readLabeledValue(["所在楼层", "所在楼层（层）", "所在楼层(层)", "房屋所在楼层", "所在层次", "所在层数", "所在层", "房屋楼层", "楼层"]);
  const totalFloorsValue = readLabeledValue(["房屋建筑总楼层", "建筑总层数", "房屋总层数", "总层数", "总楼层", "楼层数"]);
  const structuredFloorPair = clean(floorValue).match(/((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层?\s*(?:[,，、;；|｜／/]\s*)?(?:共(?:计)?|总(?:层数|楼层)?|全部楼层)\s*[:：]?\s*((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)\s*层?/);
  const structuredFloor = normalizeFloorValue(structuredFloorPair?.[1] || floorValue);
  const structuredTotalFloors = clean(structuredFloorPair?.[2] || totalFloorsValue);
  const floorBody = detailText.replace(/(地上|地下|负)\s+(?=[\d一二两三四五六七八九十百零])/g, "$1").replace(/第\s+(?=[\d一二两三四五六七八九十百零])/g, "第");
  const floorPair = floorBody.match(/(?:所在楼层（层）|所在楼层\(层\)|房屋所在楼层|所在楼层|所在层次|所在层数|房屋楼层|所在层|(?<!总)楼层)\s*(?:[\/／]\s*(?:建筑)?(?:总层数|总楼层|共计|共|总))?\s*(?:为|是|位于|在)?\s*[:=：]?\s*((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层?\s*[\/／|｜]\s*(?:(?:建筑)?(?:总层数|总楼层|共计|共)\s*[:=：]?\s*)?((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层?/);
  const floorMatch = floorPair
    || floorBody.match(/(?:所在楼层（层）|所在楼层\(层\)|房屋所在楼层|所在楼层|所在层次|所在层数|房屋楼层|所在层|(?<!总)楼层)\s*(?:为|是|位于|在|[:=：])?\s*((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层/)
    || floorBody.match(/(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)\s*(?:为|是)\s*(?:第\s*)?((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层/)
    || floorBody.match(/(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)[^。；;()（）\n]{0,60}?(?:位于|处于)[^。；;()（）\n]{0,40}?(?:第\s*)?((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层/)
    || floorBody.match(/(?:位于|处于)\s*第\s*((?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?(?:第)?[\d一二两三四五六七八九十百零]+)?)\s*层/);
  const floorFromLocated = floorBody.match(/(?:^|[。；;，,])[^。；;\n]{0,160}?所在\s*(?:为|是|第\s*)?((?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+)?)\s*层/);
  const totalFloorMatch = floorPair
    ? [floorPair[0], floorPair[2]]
    : detailText.match(/(?:房屋建筑|建筑物|建筑|房屋)?(?:地上|地下)?总(?:层数|楼层)\s*(?:为|是|约|共|：|:|=)?\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/)
    || detailText.match(/共\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/);
  const fieldSources = {
    buildingArea: buildingArea ? (areaValue ? "structured" : "page") : "",
    floor: structuredFloor ? "structured" : (floorMatch || floorFromLocated ? "page" : ""),
    totalFloors: structuredTotalFloors ? "structured" : (totalFloorMatch ? "page" : ""),
  };
  const transactionMatch = body.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const soldPriceMatch = body.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const valuationMatch = body.match(/评估价\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*元?/);
  const timeMatch = body.match(/(?:结束时间|成交时间|交易时间)\s*[：:]?\s*([0-9]{4}(?:[\/-][0-9]{1,2}[\/-][0-9]{1,2}|\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日?)(?:\s+[0-9:]{4,8})?)/);
  const bidMatch = [
    body.match(/(?:竞买记录|应买记录|出价次数|出价记录|竞价记录|竞价次数|应价次数)[^\n]{0,80}?[（(]?\s*(\d+)\s*(?:次出价|次竞价|次应价|次|条)?\s*[）)]?/i),
    body.match(/(?:共|累计|合计)\s*(\d+)\s*(?:次出价|次竞价|次应价|条出价记录|条竞买记录)/i),
    body.match(/(\d+)\s*次(?:出价|竞价|应价)/i),
    detailText.match(/(?:bidCount|bid_count|biddingCount|offerCount)\D{0,20}(\d+)/i),
  ].find(Boolean) || null;
  const hasEndedText = /(?:本场|拍卖)?已结束|成交价|竞价结果确认书/.test(detailText);
  const hasExplicitSoldPrice = Boolean(soldPriceMatch?.[1])
    || Boolean(transactionMatch?.[1] && /(?:当前价|最终价)/.test(transactionMatch[0]) && hasEndedText);
  const hasBidEvidence = Number(bidMatch?.[1] || 0) > 0;
  return {
    url: location.href,
    title: clean(heading),
    statusText: statusText.map(clean).slice(0, 5),
    location: clean(locationMatch?.[1] || ""),
    usage: clean(usageMatch?.[1] || ""),
    buildingArea,
    floor: structuredFloor || normalizeFloorValue(floorMatch?.[1] || floorFromLocated?.[1] || ""),
    totalFloors: clean(structuredTotalFloors || totalFloorMatch?.[1] || ""),
    fieldSources,
    pageText: body.slice(0, 12000),
    attachments: attachments.slice(0, 8),
    transactionAmount: transactionMatch?.[0] || "",
    valuationAmount: valuationMatch?.[1] || "",
    transactionTime: timeMatch?.[1] || "",
    bidCount: bidMatch?.[1] || "",
    longitude: coordinates?.longitude ?? null,
    latitude: coordinates?.latitude ?? null,
    coordinateSource: coordinates?.coordinateSource || "",
    hasSoldText: hasExplicitSoldPrice
      || /竞价结果确认书|已成交|成交状态\s*[：:]?\s*(?:成交|已成交)/.test(detailText)
      || (hasBidEvidence && /(?:已结束|成交时间|结束时间)/.test(detailText)),
    hasExplicitSoldPrice,
    hasInvalidStatus: statusText.some((value) => /流拍|撤回|中止/.test(value)),
    hasEndedText,
    decoration: clean(decorationMatch?.[1] || ""),
    leaseStatus: clean(leaseMatch?.[1] || ""),
    detailContentText: detailContentText.slice(0, 12000),
    detailContentReady,
    verificationRequired: [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
      || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body),
  };
})()`;

function security() {
  return { credentialsReturned: false };
}

function loadMapConfig() { return amapMaps.loadMapConfig(); }

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function normalizeRequest(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const sourceUrl = String(source.sourceUrl || DEFAULT_SOURCE_URL).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("ALIBABA_SOURCE_URL_INVALID");
  }
  if (!/^https?:$/.test(parsedUrl.protocol) || !/(^|\.)sf\.taobao\.com$/.test(parsedUrl.hostname)) {
    throw new Error("ALIBABA_SOURCE_URL_NOT_ALLOWED");
  }
  const outputDirectory = String(source.outputDirectory || RESULT_ROOT).trim();
  if (!outputDirectory || outputDirectory.includes("\0") || !path.isAbsolute(outputDirectory)) {
    throw new Error("ALIBABA_OUTPUT_DIRECTORY_INVALID");
  }
  return {
    session: String(source.session || DEFAULT_SESSION).trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || DEFAULT_SESSION,
    sourceUrl: parsedUrl.href,
    propertyType: ["residential", "commercial"].includes(source.propertyType)
      ? source.propertyType
      : "residential",
    status: ["finished", "all"].includes(source.status) ? source.status : "finished",
    keyword: String(source.keyword || "").trim().slice(0, 100),
    startDate: String(source.startDate || "").trim().slice(0, 20),
    endDate: String(source.endDate || "").trim().slice(0, 20),
    province: String(source.province || "").trim().slice(0, 40),
    city: String(source.city || "").trim().slice(0, 40),
    district: String(source.district || "").trim().slice(0, 40),
    outputDirectory,
    generateMap: source.generateMap !== false,
    historyPath: String(source.historyPath || "").trim(),
    historyRefresh: source.historyRefresh !== false,
  };
}

function executableCandidates() {
  const home = os.homedir();
  const configured = [process.env.TIANYUAN_OPENCLI_BIN, process.env.OPENCLI_BIN].filter(Boolean);
  const platformCandidates = process.platform === "win32"
    ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "opencli.cmd")]
    : [
        path.join(home, ".npm-global", "bin", "opencli"),
        path.join(home, ".local", "bin", "opencli"),
        "/opt/homebrew/bin/opencli",
        "/usr/local/bin/opencli",
      ];
  return [...new Set([...configured, ...platformCandidates, "opencli"])]
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function commandArgs(binary, args) {
  if (process.platform === "win32" && /\.cmd$/i.test(binary)) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", binary, ...args] };
  }
  return { command: binary, args };
}

function commandEnvironment(binary) {
  const home = os.homedir();
  const configuredNodeBins = [process.env.TIANYUAN_NODE_BIN, process.env.NODE_BIN]
    .filter(Boolean)
    .map((value) => path.dirname(String(value)));
  const platformNodeBins = process.platform === "win32"
    ? [path.dirname(process.execPath), path.join(process.env.ProgramFiles || "", "nodejs")]
    : [
        path.dirname(process.execPath),
        path.join(home, ".npm-global", "bin"),
        path.join(home, ".local", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ];
  const binaryDirectory = path.dirname(binary);
  const currentPath = String(process.env.PATH || "").split(path.delimiter);
  const pathEntries = [...configuredNodeBins, ...platformNodeBins, binaryDirectory, ...currentPath]
    .filter((value) => value && value !== ".");
  return {
    ...process.env,
    PATH: [...new Set(pathEntries)].join(path.delimiter),
  };
}

function runCommand(binary, args, options = {}) {
  const launch = commandArgs(binary, args);
  return new Promise((resolve, reject) => {
    execFile(launch.command, launch.args, {
      timeout: options.timeout || 45000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      windowsHide: true,
      env: commandEnvironment(binary),
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

function isAllowedAttachmentUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/^https?:$/.test(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "sf.taobao.com"
      || hostname.endsWith(".taobao.com")
      || hostname.endsWith(".alicdn.com")
      || hostname.endsWith(".alibaba-inc.com");
  } catch {
    return false;
  }
}

function downloadAttachment(value, redirectCount = 0) {
  if (!isAllowedAttachmentUrl(value)) throw new Error("ALIBABA_ATTACHMENT_URL_NOT_ALLOWED");
  if (redirectCount > 3) throw new Error("ALIBABA_ATTACHMENT_REDIRECT_LIMIT");
  const url = new URL(String(value));
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    const request = client.get(url, {
      headers: {
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 AppraisalToolbox",
      },
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        finish(null, downloadAttachment(new URL(response.headers.location, url).href, redirectCount + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        finish(new Error(`ALIBABA_ATTACHMENT_HTTP_${status || "ERROR"}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) {
          response.destroy();
          finish(new Error("ALIBABA_ATTACHMENT_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (size === 0) {
          finish(new Error("ALIBABA_ATTACHMENT_EMPTY"));
          return;
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
          finish(new Error("ALIBABA_ATTACHMENT_NOT_PDF"));
          return;
        }
        finish(null, buffer);
      });
      response.on("error", (error) => finish(error));
    });
    request.setTimeout(ATTACHMENT_TIMEOUT_MS, () => {
      request.destroy(new Error("ALIBABA_ATTACHMENT_TIMEOUT"));
    });
    request.on("error", (error) => finish(error));
  });
}

function commandCandidates(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

async function runFirstAvailableCommand(candidates, args, options = {}) {
  let lastError = null;
  for (const candidate of commandCandidates(candidates)) {
    try {
      return await runCommand(candidate, args, options);
    } catch (error) {
      lastError = error;
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    }
  }
  throw lastError || new Error("OCR_COMMAND_NOT_FOUND");
}

function ocrBinaryCandidates(kind) {
  if (kind === "pdftoppm") {
    return commandCandidates([
      process.env.TIANYUAN_PDFTOPPM_BIN,
      process.env.PDFTOPPM_BIN,
      process.platform === "win32" ? path.join(process.env.ProgramFiles || "", "poppler", "Library", "bin", "pdftoppm.exe") : "",
      process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs", "poppler", "Library", "bin", "pdftoppm.exe") : "",
      "/opt/homebrew/bin/pdftoppm",
      "/usr/local/bin/pdftoppm",
      "pdftoppm",
    ]);
  }
  return commandCandidates([
    process.env.TIANYUAN_TESSERACT_BIN,
    process.env.TESSERACT_BIN,
    process.platform === "win32" ? path.join(process.env.ProgramFiles || "", "Tesseract-OCR", "tesseract.exe") : "",
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs", "Tesseract-OCR", "tesseract.exe") : "",
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "tesseract",
  ]);
}

function pdfTextBinaryCandidates() {
  return commandCandidates([
    process.env.TIANYUAN_PDFTOTEXT_BIN,
    process.env.PDFTOTEXT_BIN,
    process.platform === "win32" ? path.join(process.env.ProgramFiles || "", "poppler", "Library", "bin", "pdftotext.exe") : "",
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs", "poppler", "Library", "bin", "pdftotext.exe") : "",
    "/opt/homebrew/bin/pdftotext",
    "/usr/local/bin/pdftotext",
    "pdftotext",
  ]);
}

async function extractPdfTextWithPdftotext(pdfPath) {
  const result = await runFirstAvailableCommand(pdfTextBinaryCandidates(), [
    "-layout",
    "-enc", "UTF-8",
    pdfPath,
    "-",
  ], { timeout: ATTACHMENT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  return String(result.stdout || "").slice(0, OCR_MAX_TEXT_LENGTH);
}

async function extractPdfTextWithTesseract(pdfPath, tempDirectory) {
  const pageDirectory = path.join(tempDirectory, "ocr-pages");
  fs.mkdirSync(pageDirectory, { recursive: true, mode: 0o700 });
  const pagePrefix = path.join(pageDirectory, "page");
  await runFirstAvailableCommand(ocrBinaryCandidates("pdftoppm"), [
    "-f", "1",
    "-l", String(OCR_MAX_PAGES),
    "-png",
    "-r", "180",
    pdfPath,
    pagePrefix,
  ], { timeout: OCR_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 });
  const pagePaths = fs.readdirSync(pageDirectory)
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0))
    .slice(0, OCR_MAX_PAGES)
    .map((name) => path.join(pageDirectory, name));
  const texts = [];
  for (const pagePath of pagePaths) {
    let result;
    try {
      result = await runFirstAvailableCommand(ocrBinaryCandidates("tesseract"), [
        pagePath,
        "stdout",
        "--psm", "6",
        "-l", process.env.TIANYUAN_TESSERACT_LANG || "chi_sim+eng",
      ], { timeout: OCR_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      if (!/chi_sim|language|traineddata/i.test(String(error?.stderr || error?.message || ""))) throw error;
      result = await runFirstAvailableCommand(ocrBinaryCandidates("tesseract"), [
        pagePath,
        "stdout",
        "--psm", "6",
        "-l", "eng",
      ], { timeout: OCR_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 });
    }
    if (result?.stdout) texts.push(result.stdout);
  }
  return texts.join("\n\n").slice(0, OCR_MAX_TEXT_LENGTH);
}

async function extractPdfTextWithOcr(pdfPath, tempDirectory) {
  try {
    const result = await runCommand(PYTHON_BIN, ["-c", PDF_OCR_SCRIPT, pdfPath, String(OCR_MAX_PAGES)], {
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 3 * 1024 * 1024,
    });
    const payload = parseJsonOutput(result.stdout);
    if (payload?.ok === true && String(payload.text || "").trim()) return String(payload.text).slice(0, OCR_MAX_TEXT_LENGTH);
  } catch {
    // A missing RapidOCR runtime falls through to an installed native OCR tool.
  }
  try {
    return await extractPdfTextWithTesseract(pdfPath, tempDirectory);
  } catch {
    return "";
  }
}

async function extractPdfText(buffer) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tianyuan-alibaba-pdf-"));
  const pdfPath = path.join(tempDirectory, "attachment.pdf");
  try {
    fs.writeFileSync(pdfPath, buffer, { mode: 0o600 });
    let text = "";
    try {
      text = await extractPdfTextWithPdftotext(pdfPath);
    } catch {
      try {
        const result = await runCommand(PYTHON_BIN, ["-c", PDF_TEXT_SCRIPT, pdfPath], {
          timeout: ATTACHMENT_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
        });
        const payload = parseJsonOutput(result.stdout);
        text = payload?.ok === true ? String(payload.text || "") : "";
      } catch {
        // OCR below can still recover image-only PDFs when the text layer is unavailable.
      }
    }
    const textFloors = extractFloorFieldsFromText(text);
    const needsOcr = !text.trim()
      || !extractBuildingAreaFromText(text)
      || !textFloors.floor
      || !textFloors.totalFloors;
    if (!needsOcr) return text;
    const ocrText = await extractPdfTextWithOcr(pdfPath, tempDirectory);
    if (!ocrText.trim()) return text;
    return [text, ocrText].filter((value) => String(value || "").trim()).join("\n\n").slice(0, OCR_MAX_TEXT_LENGTH);
  } catch {
    return "";
  } finally {
    try {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    } catch {
      // Temporary attachment files are best-effort cleaned after extraction.
    }
  }
}

async function downloadAttachmentWithBrowser(session, href, restoreUrl, target = "") {
  if (!session || !isAllowedAttachmentUrl(href)) throw new Error("ALIBABA_BROWSER_ATTACHMENT_UNAVAILABLE");
  let attachmentTarget = String(target || "").trim();
  try {
    const opened = await openBrowserPage(session, "https://sf.taobao.com/", {
      window: "background",
      target: attachmentTarget,
    });
    attachmentTarget = opened.target || attachmentTarget;
    const targetArgs = browserTargetArgs(attachmentTarget);
    const script = BROWSER_ATTACHMENT_SCRIPT + "(" + JSON.stringify(href) + ")";
    const result = await runOpenCli(["browser", session, "eval", script, ...targetArgs], {
      timeout: ATTACHMENT_TIMEOUT_MS,
      maxBuffer: MAX_BROWSER_ATTACHMENT_BYTES * 2,
    });
    const payload = parseJsonOutput(result.stdout);
    if (payload?.ok !== true || !payload.base64) throw new Error("ALIBABA_BROWSER_ATTACHMENT_REQUEST_FAILED");
    const buffer = Buffer.from(String(payload.base64), "base64");
    if (buffer.length > MAX_BROWSER_ATTACHMENT_BYTES || buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("ALIBABA_BROWSER_ATTACHMENT_NOT_PDF");
    }
    return buffer;
  } finally {
    if (restoreUrl) {
      try {
        await openBrowserPage(session, restoreUrl, {
          window: "background",
          target: attachmentTarget,
        });
      } catch {
        // Restoring the detail page is best-effort after a failed attachment read.
      }
    }
  }
}

async function downloadAttachmentForContext(href, context = {}) {
  if (String(context.session || "").trim()) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const buffer = await downloadAttachmentWithBrowser(
          context.session,
          href,
          context.restoreUrl,
          context.target,
        );
        return { buffer, source: "browser-session" };
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await runOpenCli(["browser", context.session, "wait", "time", "1"], { timeout: 10000 }).catch(() => {});
        }
      }
    }
    throw lastError || new Error("ALIBABA_BROWSER_ATTACHMENT_REQUEST_FAILED");
  }
  return { buffer: await downloadAttachment(href), source: "direct" };
}

async function enrichDetailFromAttachments(detail = {}, context = {}) {
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  if (!attachments.length) return detail;
  const currentText = String(detail.pageText || "");
  let combinedText = currentText;
  let attachmentText = "";
  let attachmentCount = 0;
  const attachmentErrors = [];
  const attachmentSources = [];
  const orderedAttachments = [...attachments]
    .sort((left, right) => {
      const score = (item) => {
        const name = String(item?.name || "");
        if (/评估|估价|房地产估价|assessment/i.test(name)) return 0;
        if (/权证|产权证|不动产权证/i.test(name)) return 2;
        return 1;
      };
      return score(left) - score(right);
    })
    .slice(0, MAX_ATTACHMENT_COUNT);
  for (const attachment of orderedAttachments) {
    const href = String(attachment?.href || "").trim();
    if (!href || !/download_attach\.do|\.pdf(?:$|[?#])/i.test(href) || !isAllowedAttachmentUrl(href)) continue;
    try {
      const downloaded = await downloadAttachmentForContext(href, context);
      const buffer = downloaded.buffer;
      const text = await extractPdfText(buffer);
      if (!text.trim()) {
        attachmentErrors.push({
          name: String(attachment?.name || "PDF").slice(0, 80),
          code: "ALIBABA_ATTACHMENT_TEXT_EMPTY",
        });
        continue;
      }
      combinedText += `\n\n附件 ${String(attachment?.name || "PDF").slice(0, 80)}\n${text}`;
      attachmentText += `\n\n${text}`;
      attachmentCount += 1;
      attachmentSources.push({
        name: String(attachment?.name || "PDF").slice(0, 80),
        source: downloaded.source,
        bytes: buffer.length,
      });
    } catch {
      attachmentErrors.push({
        name: String(attachment?.name || "PDF").slice(0, 80),
        code: "ALIBABA_ATTACHMENT_READ_FAILED",
      });
    }
  }
  if (!attachmentCount) return { ...detail, attachmentErrors, attachmentSources };
  const enriched = {
    ...detail,
    pageText: combinedText,
    attachmentText,
    attachmentCount,
    attachmentErrors,
    attachmentSources,
  };
  const fields = selectDetailFields(enriched);
  return {
    ...enriched,
    buildingArea: fields.buildingArea ?? detail.buildingArea ?? "",
    floor: fields.floor || (detail.fieldSources?.floor === "structured" ? detail.floor : ""),
    totalFloors: fields.totalFloors || (detail.fieldSources?.totalFloors === "structured" ? detail.totalFloors : ""),
  };
}

async function enrichDetailFromAttachmentBuffers(detail = {}, attachmentBuffers = []) {
  const currentText = String(detail.pageText || "");
  let combinedText = currentText;
  let attachmentText = "";
  let attachmentCount = 0;
  const attachmentErrors = [];
  const attachmentSources = [];
  for (const attachment of (Array.isArray(attachmentBuffers) ? attachmentBuffers : []).slice(0, MAX_ATTACHMENT_COUNT)) {
    const base64 = String(attachment?.base64 || "").trim();
    if (!base64) continue;
    try {
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length <= 0 || buffer.length > MAX_ATTACHMENT_BYTES || buffer.subarray(0, 4).toString("ascii") !== "%PDF") continue;
      const text = await extractPdfText(buffer);
      if (!text.trim()) {
        attachmentErrors.push({
          name: String(attachment?.name || "PDF").slice(0, 80),
          code: "ALIBABA_ATTACHMENT_TEXT_EMPTY",
        });
        continue;
      }
      combinedText += `\n\n附件 ${String(attachment?.name || "PDF").slice(0, 80)}\n${text}`;
      attachmentText += `\n\n${text}`;
      attachmentCount += 1;
      attachmentSources.push({
        name: String(attachment?.name || "PDF").slice(0, 80),
        source: "provided-buffer",
        bytes: buffer.length,
      });
    } catch {
      attachmentErrors.push({
        name: String(attachment?.name || "PDF").slice(0, 80),
        code: "ALIBABA_ATTACHMENT_READ_FAILED",
      });
    }
  }
  if (!attachmentCount) return { ...detail, attachmentErrors, attachmentSources };
  const enriched = {
    ...detail,
    pageText: combinedText,
    attachmentText,
    attachmentCount,
    attachmentErrors,
    attachmentSources,
  };
  const fields = selectDetailFields(enriched);
  return {
    ...enriched,
    buildingArea: fields.buildingArea ?? detail.buildingArea ?? "",
    floor: fields.floor || (detail.fieldSources?.floor === "structured" ? detail.floor : ""),
    totalFloors: fields.totalFloors || (detail.fieldSources?.totalFloors === "structured" ? detail.totalFloors : ""),
  };
}

async function runOpenCli(args, options = {}) {
  let lastError = null;
  for (const candidate of executableCandidates()) {
    try {
      const result = await runCommand(candidate, args, options);
      return { ...result, binary: candidate };
    } catch (error) {
      lastError = error;
      if (!(["ENOENT", "ENOTDIR"].includes(error?.code))) break;
    }
  }
  if (lastError?.code === "ENOENT" || lastError?.code === "ENOTDIR") {
    throw new Error("OPENCLI_NOT_FOUND");
  }
  throw lastError || new Error("OPENCLI_EXEC_FAILED");
}

function parseJsonOutput(output) {
  const text = String(output || "");
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("OPENCLI_JSON_INVALID");
}

function browserTargetArgs(target) {
  const page = String(target || "").trim();
  return page ? ["--tab", page] : [];
}

function openedBrowserTarget(output) {
  try {
    const payload = parseJsonOutput(output);
    return String(payload?.page || "").trim();
  } catch {
    return "";
  }
}

function browserUrlsMatch(actual, expected) {
  const left = canonicalUrl(actual);
  const right = canonicalUrl(expected);
  if (left === right) return true;
  try {
    const actualUrl = new URL(left);
    const expectedUrl = new URL(right);
    return actualUrl.origin === expectedUrl.origin
      && actualUrl.pathname.replace(/\/$/, "") === expectedUrl.pathname.replace(/\/$/, "")
      && actualUrl.search === expectedUrl.search;
  } catch {
    return false;
  }
}

function isAlibabaVerificationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const state = `${url.pathname} ${url.search} ${url.hash}`;
    return /(?:^|\.)taobao\.com/i.test(url.hostname)
      && /captcha|verify|validate|punish|security|login|error/i.test(state);
  } catch {
    return false;
  }
}

function alibabaUrlsReferToSamePage(actual, expected) {
  try {
    const current = new URL(String(actual || ""));
    const target = new URL(String(expected || ""));
    if (current.origin !== target.origin || current.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "")) return false;
    for (const [key, value] of target.searchParams.entries()) {
      if (key === "track_id") continue;
      if (!current.searchParams.getAll(key).includes(value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function browserPageReady(value, expectedUrl, pageKind = "detail") {
  if (!value || pageLooksBlocked(value)) return false;
  if (expectedUrl && !alibabaUrlsReferToSamePage(value.url, expectedUrl)) return false;
  const pageText = String(value.pageText || "").trim();
  if (!String(value.url || "").trim()) return false;
  if (pageKind === "list") return Array.isArray(value.items) && pageText.length >= 20;
  if (Object.prototype.hasOwnProperty.call(value, "detailContentReady") && value.detailContentReady !== true) return false;
  return Boolean(pageText.length >= 24
    && /阿里拍卖|拍卖标的|标的物|结束时间|成交价|拍下价|当前价|起拍价|本场已结束/.test(pageText));
}

async function evaluateBrowserPage(session, target, script) {
  const targetArgs = browserTargetArgs(target);
  try {
    const result = await runOpenCli([
      "browser", session, "eval", script, ...targetArgs,
    ], { timeout: 30000 });
    return parseJsonOutput(result.stdout);
  } catch (error) {
    if (error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
    const failure = new Error(`ALIBABA_SCRIPT_EXECUTION_FAILED: ${safeError(error)}`);
    failure.code = "ALIBABA_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
}

async function readBrowserPageWithManualVerification(session, page, script, expectedUrl, pageKind, emit = () => {}, description = "读取页面", options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : MANUAL_VERIFICATION_TIMEOUT_MS;
  const startedAt = Date.now();
  const initialTargetArgs = page ? browserTargetArgs(page.target) : [];
  let target = String(page?.target || "").trim();
  if (/login\.taobao|\/login(?:[/?]|$)/i.test(String(page?.url || ""))) {
    const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
    failure.code = "ALIBABA_LOGIN_REQUIRED";
    throw failure;
  }
  let waitState = isAlibabaVerificationUrl(page?.url) ? "verification" : "page_loading";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluateBrowserPage(session, target, script);
      const blocked = pageLooksBlocked(value);
      if (blocked === "ALIBABA_LOGIN_REQUIRED") {
        const error = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
        error.code = blocked;
        throw error;
      }
      if (browserPageReady(value, expectedUrl, pageKind)) return { value, target };
      waitState = pageWaitState(value, expectedUrl, pageKind);
    } catch (error) {
      if (error?.code === "ALIBABA_LOGIN_REQUIRED" || error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
      throw error;
    }
    emit({
      phase: waitState === "verification" ? "verification_required" : waitState === "detail_loading" ? "loading_detail" : "opening",
      percent: 35,
      message: verificationWaitMessage(waitState, pageKind, description, Math.floor((Date.now() - startedAt) / 1000)),
    });
    await runOpenCli(["browser", session, "wait", "time", "1", ...(target ? browserTargetArgs(target) : initialTargetArgs)], { timeout: 10000 }).catch(() => {});
  }
  const timeout = new Error("请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。");
  timeout.code = "ALIBABA_VERIFICATION_TIMEOUT";
  throw timeout;
}

async function openBrowserPage(session, url, options = {}) {
  const expectedUrl = canonicalUrl(url);
  const requestedTarget = String(options.target || "").trim();
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const opened = await runOpenCli([
        "browser", session, "open", "--window", options.window || "background", expectedUrl,
        ...browserTargetArgs(requestedTarget),
      ], { timeout: 60000 });
      const target = requestedTarget || openedBrowserTarget(opened.stdout);
      const targetArgs = browserTargetArgs(target);
      await runOpenCli(["browser", session, "wait", "time", "1", ...targetArgs], { timeout: 10000 });
      const location = await evaluateBrowserPage(session, target, BROWSER_LOCATION_SCRIPT);
      if (browserUrlsMatch(location.url, expectedUrl) || (options.allowVerification && isAlibabaVerificationUrl(location.url))) {
        return { target, url: canonicalUrl(location.url), verificationRequired: isAlibabaVerificationUrl(location.url) };
      }
      lastError = new Error("ALIBABA_TARGET_MISMATCH");
      lastError.code = "ALIBABA_TARGET_MISMATCH";
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) {
      await runOpenCli(["browser", session, "wait", "time", String(attempt + 1)], { timeout: 10000 }).catch(() => {});
    }
  }
  if (lastError) throw lastError;
  const failure = new Error("ALIBABA_TARGET_MISMATCH");
  failure.code = "ALIBABA_TARGET_MISMATCH";
  throw failure;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.searchParams.delete("track_id");
    return url.href;
  } catch {
    return String(value || "").trim();
  }
}

function parseAmount(value) {
  const normalized = String(value || "")
    .replace(/(\d)\s*\.\s*(?=\d)/g, "$1.")
    .replace(/(\d)\s+(?=\d)/g, "$1");
  const number = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseAuctionAmount(value) {
  const text = String(value || "");
  const number = parseAmount(text);
  if (!number) return null;
  if (/亿/.test(text)) return number * 100000000;
  if (/万/.test(text)) return number * 10000;
  return number;
}

function chineseFloorNumber(value) {
  const text = String(value || "").trim();
  if (!text || /^\d+$/.test(text)) return text;
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[一二两三四五六七八九十百零]+$/.test(text)) {
    if (text === "十") return "10";
    const tenIndex = text.indexOf("十");
    if (tenIndex >= 0) {
      const tens = tenIndex === 0 ? 1 : digits[text[tenIndex - 1]];
      const ones = tenIndex === text.length - 1 ? 0 : digits[text[tenIndex + 1]];
      if (Number.isInteger(tens) && Number.isInteger(ones)) return String(tens * 10 + ones);
    }
    if (text.length === 1 && Number.isInteger(digits[text])) return String(digits[text]);
  }
  return text;
}

function normalizeFloorValue(value) {
  let normalized = String(value || "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/第/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:为|是|位于|在)\s*/, "")
    .trim();
  if (!normalized || /^(?:总|共|建筑|层数|楼层|总层数|总楼层|所在|数|全部楼层)$/.test(normalized)) return "";
  if (/^\s*[\/／]/.test(normalized)) return "";
  normalized = normalized.replace(/\s*(?:总|共)\s*(?:计)?\s*(?:层数|楼层|层|楼)?\s*$/, "").trim();
  normalized = normalized.replace(/(地下|地上|负)\s+(?=[\d一二两三四五六七八九十百零])/g, "$1");
  normalized = normalized.replace(/(地下|地上|负)?([一二两三四五六七八九十百零]+)/g, (match, prefix, number) => `${prefix || ""}${chineseFloorNumber(number)}`);
  if (/^(顶|底|中|高|低)(层)?$/.test(normalized)) return normalized.endsWith("层") ? normalized : `${normalized}层`;
  normalized = normalized.replace(/[层楼]\s*$/, "").replace(/\s+/g, "").trim();
  return /^(?:地上|地下|负)?\d+(?:[至\-—~～](?:地上|地下|负)?\d+)?$/.test(normalized) ? normalized : "";
}

function normalizeTotalFloorValue(value) {
  const original = String(value || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
  if (!original) return "";
  const numberMatch = original.match(/(?:\d+|[一二两三四五六七八九十百零]+)/);
  if (!numberMatch) return "";
  const number = chineseFloorNumber(numberMatch[0]);
  return /^\d+$/.test(number) ? `${number}${/[层楼]/.test(original) ? "层" : ""}` : "";
}

function floorWithinTotal(floor, totalFloors) {
  const total = parseAmount(totalFloors);
  if (!total) return true;
  const values = String(floor || "").match(/\d+/g);
  return !values || values.every((value) => Number(value) <= total);
}

function extractBuildingAreaFromText(value) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[，]/g, ",")
    .replace(/[：]/g, ":")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
    .replace(/建\s*筑\s*面\s*积/g, "建筑面积")
    .replace(/房\s*屋\s*面\s*积/g, "房屋面积")
    .replace(/\s+/g, " ")
    .replace(/(?:专有|分摊|套内|共有|使用权)建筑面积/g, (match) => match.replace("建筑", ""))
    .trim();
  const patterns = [
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*[（(]\s*(?:平方米|平米|㎡|m²|m2|平方公尺)\s*[）)]\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约|合计|共计)\s*)?(?:为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?=$|[,。；;])/i,
    /(?:房屋|房产|不动产|建筑物)?(?:建筑|房屋|房产|产权)面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:合计建筑面积|建筑总面积|房屋建筑总面积|标的物建筑面积|证载建筑面积|房产证建筑面积|不动产建筑面积)\s*(?:[:=：]\s*)?(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:标的物|拍卖标的|房屋|房地产|不动产)\s*面积\s*(?:为|是|[:：])?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:登记建筑面积|登记面积|证载建筑面积|证载面积|产权证载面积|产权证建筑面积|房产证建筑面积|不动产权证书?建筑面积|建筑面积|房屋建筑面积|房屋面积)\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|为|是|等于|合计|共计|登记为)?\s*[:=：-]?\s*([\d][\d,\s]*(?:\.\s*\d+)?)(?=\s*(?:平方米|平米|㎡|m²|m2|平方公尺)?(?:\s|$|[,，。；;]))/i,
    /(?:房屋|房地产|不动产)\s*[，,]\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:^|[；;。\n（(]|\d[、.])\s*面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!总)(?:房屋)?建筑面积\s*[^。；;\n]{0,120}?([\d][\d,，\s]*(?:\.\s*\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseAmount(match[1]);
  }
  return null;
}

function extractFloorFieldsFromText(value) {
  const lines = String(value || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const floorLabels = ["所在楼层（层）", "所在楼层(层)", "房屋所在楼层", "所在楼层", "所在层次", "所在层数", "房屋楼层", "所在层", "楼层"];
  const totalLabels = ["房屋建筑总楼层", "建筑总层数", "房屋总层数", "总层数", "总楼层", "楼层数"];
  const read = (labels) => {
    const orderedLabels = [...labels].sort((left, right) => right.length - left.length);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const label = orderedLabels.find((item) => line === item || line.startsWith(`${item}：`) || line.startsWith(`${item}:`) || line.startsWith(`${item}为`) || line.startsWith(`${item}是`) || line.startsWith(`${item} `));
      if (!label) continue;
      const inline = line.slice(label.length).replace(/^[\s:：-]*(?:为|是)?\s*/, "").trim();
      const inlineValue = inline.split(/[|｜]/, 1)[0].trim();
      if (inlineValue) return inlineValue;
      if (lines[index + 1] && !orderedLabels.includes(lines[index + 1])) return lines[index + 1];
    }
    return "";
  };
  const text = lines.join(" ");
  const floorLabel = "(?:所在楼层（层）|所在楼层\\(层\\)|房屋所在楼层|所在楼层|所在层次|所在层数|房屋楼层|所在层|(?<!总)楼层)";
  const floorToken = "(?:地上|地下|负)?\\s*(?:第\\s*)?[\\d一二两三四五六七八九十百零]+(?:\\s*[至\\-—~～]\\s*(?:地上|地下|负)?\\s*(?:第\\s*)?[\\d一二两三四五六七八九十百零]+)?";
  const pair = text.match(new RegExp(`${floorLabel}(?:\\s*[\\/／]\\s*(?:建筑)?(?:总层数|总楼层|共计|共|总))?\\s*(?:为|是|位于|在)?\\s*[:=：]?\\s*(${floorToken})\\s*层?\\s*[\\/／|｜]\\s*(?:(?:建筑)?(?:总层数|总楼层|共计|共)\\s*[:=：]?\\s*)?(${floorToken})\\s*层?`));
  const floorFromSentence = text.match(new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层`));
  const floorFromBareLabel = text.match(new RegExp(`(?:所在层次|所在层数)\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})(?!\\s*层)`));
  const floorFromContext = text.match(new RegExp(`(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)\\s*(?:为|是)\\s*(?:第\\s*)?(${floorToken})\\s*层`))
    || text.match(new RegExp(`(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)[^。；;()（）\\n]{0,60}?(?:位于|处于)[^。；;()（）\\n]{0,40}?(?:第\\s*)?(${floorToken})\\s*层`))
    || text.match(new RegExp(`(?:位于|处于)\\s*第\\s*(${floorToken})\\s*层`));
  const floorFromLocated = text.match(/(?:^|[。；;，,])[^。；;\n]{0,160}?所在\s*(?:为|是|第\s*)?((?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+)?)\s*层/);
  const totalFromSentence = text.match(/(?:房屋建筑|建筑物|建筑|房屋)?(?:地上|地下)?总(?:层数|楼层)\s*(?:为|是|约|共|[:=：])?\s*(?:地上|地下|负)?\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/)
    || text.match(/共\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/);
  const totalFromParenthetical = text.match(/[（(]\s*(?:共|总层数|总楼层)\s*([\d一二两三四五六七八九十百零]+)\s*层?\s*[）)]/);
  const orphanTotal = text.match(/(?:楼层|层数)\s*[:：]?\s*[\/／]\s*总(?:楼层|层数)?\s*([\d一二两三四五六七八九十百零]+)/);
  const floorTotalPairPattern = new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层?[\\s,，、;；|｜/／]*?(?:共(?:计)?|总(?:层数|楼层)?|全部楼层)\\s*[:=：]?\\s*(${floorToken})\\s*层?`, "gi");
  const floorTotalPairLoosePattern = new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层?[\\s\\S]{0,80}?(?:共(?:计)?|总(?:层数|楼层)?|全部楼层)\\s*[:=：]?\\s*(${floorToken})\\s*层?`, "gi");
  const floorTotalPairs = [];
  for (const pattern of [floorTotalPairPattern, floorTotalPairLoosePattern]) {
    for (const match of text.matchAll(pattern)) {
      const suffix = String(match[0]).slice(String(match[0]).lastIndexOf(String(match[2])) + String(match[2]).length);
      floorTotalPairs.push({ floor: match[1], totalFloors: match[2], hasUnit: /层\s*$/.test(suffix) });
    }
  }
  const pairedFloorTotal = floorTotalPairs
    .map((candidate) => ({ floor: normalizeFloorValue(candidate.floor), totalFloors: normalizeTotalFloorValue(`${candidate.totalFloors}${candidate.hasUnit ? "层" : ""}`) }))
    .find((candidate) => candidate.floor && candidate.totalFloors && floorWithinTotal(candidate.floor, candidate.totalFloors));
  const floor = normalizeFloorValue(pair?.[1] || pairedFloorTotal?.floor || floorFromSentence?.[1] || floorFromLocated?.[1] || floorFromContext?.[1] || floorFromBareLabel?.[1] || read(floorLabels));
  const floorFallback = floor || normalizeFloorValue(read(floorLabels));
  let totalRaw = "";
  if (pair?.[2]) totalRaw = pair[2];
  else if (pairedFloorTotal?.totalFloors) totalRaw = pairedFloorTotal.totalFloors;
  else if (totalFromSentence?.[1]) totalRaw = `${totalFromSentence[1]}${totalFromSentence[2] || ""}`;
  else if (totalFromParenthetical?.[1]) totalRaw = `${totalFromParenthetical[1]}层`;
  else if (orphanTotal?.[1]) totalRaw = `${orphanTotal[1]}层`;
  else totalRaw = read(totalLabels);
  const totalFloors = normalizeTotalFloorValue(totalRaw);
  return { floor: floorFallback, totalFloors };
}

function parseCoordinate(value, minimum, maximum) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizeDate(value) {
  const match = String(value || "").match(/(\d{4})\s*(?:年\s*|[\/-])(\d{1,2})\s*(?:月\s*|[\/-])(\d{1,2})\s*日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return String(value || "").trim();
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function firstCity(value) {
  const match = String(value || "").match(/(?:浙江省)?\s*([^省市县区]{1,16})市/);
  return match?.[1] ? `${match[1]}市` : "";
}

function firstDistrict(value, request = {}) {
  const text = String(value || "");
  if (request.district && text.includes(request.district)) return request.district;
  const match = text.match(/(?:市|地区)\s*([\u4e00-\u9fa5]{1,12}(?:区|县|市))/);
  return match?.[1] || "";
}

function stripLocationPrefixes(value, prefixes) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  let result = original;
  const names = [...new Set(prefixes.map((item) => String(item || "").trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  for (let index = 0; index < 6; index += 1) {
    const prefix = names.find((name) => result.startsWith(name));
    if (!prefix) break;
    result = result.slice(prefix.length).replace(/^[\s,，、;；:：-]+/, "").trim();
  }
  return result || original;
}

function normalizeLease(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/无租赁|未出租|空置|无承租/.test(text)) return "空置";
  if (/带租|出租|租赁期限|租期|租金/.test(text)) return "出租中";
  if (/占有|占用|未腾空/.test(text)) return "占用";
  return text;
}

function selectDetailFields(detail = {}) {
  const pageText = [detail.detailContentText, detail.pageText].filter(Boolean).join("\n");
  const attachmentText = String(detail.attachmentText || "");
  const pageArea = extractBuildingAreaFromText(pageText);
  const attachmentArea = extractBuildingAreaFromText(attachmentText);
  const pageFloors = extractFloorFieldsFromText(pageText);
  const attachmentFloors = extractFloorFieldsFromText(attachmentText);
  const rawArea = parseAmount(detail.buildingArea);
  const rawFloor = normalizeFloorValue(detail.floor);
  const rawTotal = normalizeTotalFloorValue(detail.totalFloors);
  const fieldSources = detail.fieldSources || {};
  const hasTextEvidence = Boolean(pageText.trim() || attachmentText.trim());
  const structuredFloor = fieldSources.floor === "structured" && rawFloor && !/[\/／|｜]/.test(rawFloor) && !/(?:总|共)/.test(rawFloor);
  const structuredTotal = fieldSources.totalFloors === "structured" && parseAmount(rawTotal);
  const structuredArea = fieldSources.buildingArea === "structured" && rawArea;
  const buildingArea = structuredArea ? rawArea : (attachmentArea || pageArea || (!hasTextEvidence ? rawArea : null));
  const floor = structuredFloor
    ? rawFloor
    : attachmentFloors.floor || pageFloors.floor || (!hasTextEvidence ? rawFloor : "");
  const totalFloors = structuredTotal
    ? rawTotal
    : attachmentFloors.totalFloors || pageFloors.totalFloors || (!hasTextEvidence ? rawTotal : "");
  return {
    buildingArea,
    floor: floorWithinTotal(floor, totalFloors) ? floor : "",
    totalFloors,
  };
}

function firstPropertyType(value) {
  const text = String(value || "");
  if (text.includes("住宅用房") || text.includes("住宅房") || text.includes("住宅")) return "住宅用房";
  if (text.includes("商业房") || text.includes("商业用房") || text.includes("商业")) return "商业房";
  return "";
}

function parseDetail(detail, request) {
  const pageText = [detail.detailContentText, detail.pageText].filter(Boolean).join("\n");
  const pageTransactionMatch = pageText.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageSoldPriceMatch = pageText.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageCurrentPriceMatch = pageText.match(/(?:当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageHasEndedText = /(?:本场|拍卖)?已结束|竞价结果确认书/.test(pageText);
  const pageTimeMatch = pageText.match(/(?:结束时间|成交时间|交易时间)\s*[：:]?\s*([0-9]{4}(?:[\/-][0-9]{1,2}[\/-][0-9]{1,2}|\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日?)(?:\s+[0-9:]{4,8})?)/);
  const pageBidMatch = pageText.match(/(?:竞买记录|应买记录|出价次数|出价记录|竞价记录|竞价次数|应价次数)[^\n]{0,80}?[（(]?\s*(\d+)\s*(?:次出价|次竞价|次应价|次|条)?\s*[）)]?/i)
    || pageText.match(/(\d+)\s*次(?:出价|竞价|应价)/i);
  const hasExplicitSoldPrice = detail.hasExplicitSoldPrice === true || Boolean(pageSoldPriceMatch?.[1])
    || Boolean(pageCurrentPriceMatch?.[1] && pageHasEndedText);
  const hasEndedText = detail.hasEndedText === true || pageHasEndedText;
  const hasSoldText = detail.hasSoldText === true || hasExplicitSoldPrice || Boolean(pageBidMatch && hasEndedText);
  const transactionAmount = parseAuctionAmount(detail.transactionAmount || pageTransactionMatch?.[0]);
  const valuationAmount = parseAmount(detail.valuationAmount);
  const fields = selectDetailFields(detail);
  const buildingArea = fields.buildingArea;
  const floor = normalizeFloorValue(fields.floor);
  const totalFloorsText = normalizeTotalFloorValue(fields.totalFloors);
  const totalFloors = parseAmount(totalFloorsText);
  const bidCount = boundedInteger(detail.bidCount || pageBidMatch?.[1], 0, 0, 1000000);
  const finished = hasSoldText && detail.hasInvalidStatus !== true
    && (request.status !== "finished" || hasEndedText)
    && Boolean(transactionAmount) && (bidCount > 0 || hasExplicitSoldPrice);
  const rawLocation = String(detail.location || "").trim();
  const city = firstCity(rawLocation) || String(request.city || "").trim();
  const district = firstDistrict(rawLocation, request);
  const location = stripLocationPrefixes(rawLocation, [request.province, city, district]);
  const propertyType = firstPropertyType(detail.usage) || PROPERTY_LABELS[request.propertyType] || String(request.propertyType || "");
  return {
    title: String(detail.title || "").trim(),
    province: String(request.province || "浙江省").trim(),
    city,
    district,
    propertyType,
    address: location,
    coordinateStatus: parseCoordinate(detail.longitude, 70, 140) !== null && parseCoordinate(detail.latitude, 3, 55)
      !== null ? "已定位（详情页坐标）" : "未定位（详情页未返回坐标）",
    coordinateSource: detail.coordinateSource || "",
    coordinatePrecision: detail.coordinateSource ? "exact" : "",
    longitude: parseCoordinate(detail.longitude, 70, 140),
    latitude: parseCoordinate(detail.latitude, 3, 55),
    transactionTime: normalizeDate(detail.transactionTime || pageTimeMatch?.[1] || ""),
    transactionAmount,
    valuationAmount,
    buildingArea,
    unitPrice: transactionAmount && buildingArea ? Math.round((transactionAmount / buildingArea) * 100) / 100 : null,
    floor: floorWithinTotal(floor, totalFloorsText) ? floor : "",
    totalFloors,
    decoration: String(detail.decoration || "").trim(),
    leaseStatus: normalizeLease(detail.leaseStatus),
    platform: "阿里拍卖",
    bidCount,
    verificationStatus: finished ? "详情核验通过" : "未通过成交核验",
    url: canonicalUrl(detail.url),
    valid: finished,
  };
}

function matchesRequest(record, request) {
  const keyword = String(request.keyword || "").trim();
  const searchable = `${record.title || ""} ${record.address || ""}`;
  if (keyword && !searchable.includes(keyword)) return false;
  const expectedProperty = PROPERTY_LABELS[request.propertyType];
  if (expectedProperty && record.propertyType && record.propertyType !== expectedProperty) return false;
  const date = String(record.transactionTime || "").slice(0, 10);
  if (request.startDate && (!date || date < request.startDate)) return false;
  if (request.endDate && (!date || date > request.endDate)) return false;
  return true;
}

function skipReason(detail, record, request) {
  const pageText = String(detail?.pageText || "");
  if (!record?.transactionAmount) return "未识别成交价或拍下价";
  if (detail?.hasInvalidStatus === true) return "页面标记为流拍、撤回或中止";
  if (request.status === "finished" && !detail?.hasEndedText && !/(?:本场|拍卖)?已结束/.test(pageText)) return "未识别已结束状态";
  if (!detail?.hasSoldText) return "未识别成交状态";
  if (!(Number(record?.bidCount || detail?.bidCount || 0) > 0 || detail?.hasExplicitSoldPrice === true)) return "未识别出价次数或明确成交价";
  const expectedProperty = PROPERTY_LABELS[request.propertyType];
  if (expectedProperty && record?.propertyType && record.propertyType !== expectedProperty) return "不符合物业类型范围";
  const date = String(record?.transactionTime || "").slice(0, 10);
  if (request.startDate && (!date || date < request.startDate)) return "成交日期早于起始日期";
  if (request.endDate && (!date || date > request.endDate)) return "成交日期晚于结束日期";
  if (request.keyword && !`${record?.title || ""} ${record?.address || ""}`.includes(request.keyword)) return "不符合关键词范围";
  return "详情核验条件未满足";
}

function candidateInScope(item, request) {
  // 列表卡片状态和日期字段不可靠，最终是否成交及日期由详情页确认。
  return true;
}

function pageBeforeRequestedRange(items, request) {
  // 不能用列表卡片日期推断分页边界，避免漏掉最终成交详情。
  return false;
}

function listPageUrl(sourceUrl, page) {
  const url = new URL(sourceUrl);
  if (page <= 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(page));
  return url.href;
}

function pageLooksBlocked(value) {
  const text = `${value?.title || ""} ${value?.pageText || ""} ${value?.url || ""}`;
  if (/login\.taobao|\/login(?:[/?]|$)|登录淘宝|请登录|会员登录|扫码登录/i.test(text)) return "ALIBABA_LOGIN_REQUIRED";
  if (value?.verificationRequired === true) return "ALIBABA_VERIFICATION_REQUIRED";
  if (/验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证|拖动.{0,8}(?:滑块|拼图)|captcha|punish|security\s*check/i.test(text)) return "ALIBABA_VERIFICATION_REQUIRED";
  return "";
}

function pageWaitState(value, expectedUrl, pageKind = "detail") {
  const blocked = pageLooksBlocked(value);
  if (blocked === "ALIBABA_LOGIN_REQUIRED") return "login";
  if (blocked === "ALIBABA_VERIFICATION_REQUIRED" || isAlibabaVerificationUrl(value?.url)) return "verification";
  if (expectedUrl && !alibabaUrlsReferToSamePage(value?.url, expectedUrl)) return "navigation";
  if (pageKind === "detail" && Object.prototype.hasOwnProperty.call(value || {}, "detailContentReady") && value.detailContentReady !== true) return "detail_loading";
  return "page_loading";
}

function verificationWaitMessage(state, pageKind, description, elapsedSeconds) {
  const pageLabel = pageKind === "detail" ? "详情页" : "列表页";
  if (state === "verification") return `检测到阿里拍卖验证，请在当前浏览器完成验证；完成后会等待原${pageLabel}重新加载，再继续${description}。已等待 ${elapsedSeconds} 秒。`;
  if (state === "detail_loading") return `当前${pageLabel}没有验证码，正在等待详情内容加载完成后继续${description}。已等待 ${elapsedSeconds} 秒。`;
  if (state === "navigation") return `正在等待阿里拍卖${pageLabel}返回目标页面后继续${description}。已等待 ${elapsedSeconds} 秒。`;
  return `正在等待阿里拍卖${pageLabel}和关键字段加载完成后继续${description}。已等待 ${elapsedSeconds} 秒。`;
}

function safeError(error) {
  const output = [error?.stderr, error?.stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    || String(error?.message || error || "OPENCLI_EXEC_FAILED");
  const message = output
    .replace(/(?:token|cookie|authorization|password|验证码)\s*[:=]?\s*[^\s;,]+/gi, "[已隐藏]")
    .replace(/-EncodedCommand\s+\S+/gi, "-EncodedCommand [已隐藏]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return message || "OPENCLI_EXEC_FAILED";
}

function safeBrowserPageSummary(page, fallbackUrl, phase) {
  let parsed;
  try { parsed = new URL(String(page?.url || fallbackUrl || "")); } catch { parsed = null; }
  const url = parsed ? `${parsed.hostname}${parsed.pathname}` : "";
  return {
    hostname: parsed?.hostname || "",
    pathname: parsed?.pathname || "",
    phase: String(phase || "").slice(0, 40),
    target: String(page?.target || "").slice(0, 120),
    loginPage: /login\.taobao|\/login(?:[/?]|$)/i.test(url),
    verificationPage: isAlibabaVerificationUrl(page?.url || fallbackUrl),
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return String(value);
}

function renderResultHtml(results, request, metadata = {}) {
  const columns = [
    ["案例标题", "title"], ["省份", "province"], ["城市", "city"], ["区县", "district"],
    ["物业类型", "propertyType"], ["坐落位置", "address"], ["交易时间", "transactionTime"],
    ["交易金额（元）", "transactionAmount"], ["评估价", "valuationAmount"], ["建筑面积（m²）", "buildingArea"],
    ["单价", "unitPrice"], ["所在楼层", "floor"], ["总层数", "totalFloors"], ["装修", "decoration"],
    ["租赁情况", "leaseStatus"], ["案例平台", "platform"], ["出价次数", "bidCount"],
    ["核验状态", "verificationStatus"], ["坐标状态", "coordinateStatus"], ["经度", "longitude"],
    ["纬度", "latitude"], ["案例网址", "url"],
  ];
  const numericFields = new Set(["transactionAmount", "valuationAmount", "buildingArea", "unitPrice", "totalFloors", "bidCount", "longitude", "latitude"]);
  const header = columns.map(([label], index) => `<th><div class="table-header-cell"><span>${escapeHtml(label)}</span><button class="column-filter-trigger" type="button" data-column="${index + 2}" aria-label="筛选${escapeHtml(label)}" title="筛选${escapeHtml(label)}"><span class="filter-funnel" aria-hidden="true"></span></button></div></th>`).join("");
  const rows = (Array.isArray(results) ? results : []).map((item, rowIndex) => {
    const mapKey = String(rowIndex + 1);
    const hasCoordinate = mapNumber(item?.longitude, 70, 140) !== null && mapNumber(item?.latitude, 3, 55) !== null;
    const checkbox = `<input class="result-select" type="checkbox" data-map-key="${mapKey}" aria-label="选择第 ${rowIndex + 1} 条案例"${hasCoordinate ? "" : " disabled title=\"该记录没有坐标，无法在地图上定位\""}>`;
    const cells = columns.map(([label, field]) => {
      const value = field === "transactionTime" ? normalizeDate(item?.[field]) : item?.[field];
      const cellClass = numericFields.has(field) ? "numeric-cell" : "";
      if (field === "url" && value) {
        return `<td class="${cellClass}"><a href="${escapeHtml(safeExportUrl(value))}" target="_blank" rel="noopener noreferrer">打开详情</a></td>`;
      }
      return `<td class="${cellClass}">${escapeHtml(displayValue(value))}</td>`;
    }).join("");
    return `<tr data-map-key="${mapKey}"${hasCoordinate ? "" : " class=\"no-coordinate\""}><td class="sequence-cell">${mapKey}</td><td class="select-cell">${checkbox}</td>${cells}</tr>`;
  }).join("");
  const sourceUrl = escapeHtml(safeExportUrl(request.sourceUrl));
  const generatedAt = escapeHtml(new Date().toLocaleString("zh-CN", { hour12: false }));
  const skipped = Number(metadata.skipped || 0);
  const mapName = request.generateMap === false ? "" : "latest_map.html";
  const mapLink = mapName
    ? `<a class="button secondary" href="${mapName}" target="_blank" rel="noopener noreferrer">打开独立地图</a>`
    : '<button class="button secondary" type="button" disabled>本次未生成地图</button>';
  const mapPreview = mapName
    ? `<div class="map-frame-shell" aria-label="可调整大小的地图区域"><iframe id="alibaba-map-frame" title="阿里司法拍卖地图" src="${mapName}"></iframe><div id="alibaba-map-resize-handle" class="map-resize-handle" role="separator" aria-orientation="vertical" aria-label="拖动调整地图高度" title="拖动调整地图高度"></div></div>`
    : '<div class="map-empty">本次未生成地图；结果表仍保留坐标状态。</div>';
  const excelActions = '<div class="actions"><a class="button" href="latest.xlsx" download>下载 Excel</a><a class="button secondary" href="latest.xlsx" target="_blank" rel="noopener noreferrer">打开 Excel</a></div>';
  const emptyNotice = results.length ? "" : '<div class="inline-notice"><strong>暂未找到符合条件的成交案例</strong><p>请检查地区、拍卖状态、物业类型和成交日期。</p></div>';
  const filterScript = `<script>
(() => {
  const frame = document.getElementById("alibaba-map-frame");
  const shell = document.querySelector(".map-frame-shell");
  const resizeHandle = document.getElementById("alibaba-map-resize-handle");
  const filter = document.getElementById("result-filter");
  const count = document.getElementById("result-count");
  const clearSelection = document.getElementById("clear-selection");
  const resultContext = document.getElementById("result-context");
  const resultContextToggle = document.getElementById("toggle-result-context");
  const resultContextStorageKey = "tianyuan-alibaba-result-context-collapsed-v1";
  function setResultContextCollapsed(collapsed, persist = true) {
    if (!resultContext || !resultContextToggle) return;
    const value = Boolean(collapsed);
    resultContext.classList.toggle("collapsed", value);
    resultContextToggle.textContent = value ? "展开信息" : "收起信息";
    resultContextToggle.setAttribute("aria-expanded", String(!value));
    if (persist) {
      try { localStorage.setItem(resultContextStorageKey, value ? "1" : "0"); } catch {}
    }
  }
  resultContextToggle?.addEventListener("click", () => setResultContextCollapsed(!resultContext?.classList.contains("collapsed")));
  try { setResultContextCollapsed(localStorage.getItem(resultContextStorageKey) === "1", false); } catch {}
  const distanceButton = (() => {
    const button = document.createElement("button");
    button.id = "show-selected-distances";
    button.className = "clear-filters";
    button.type = "button";
    button.textContent = "显示到标记距离";
    button.disabled = true;
    clearSelection?.before(button);
    return button;
  })();
  const clearFilters = document.getElementById("clear-filters");
  const rows = Array.from(document.querySelectorAll("#result-table tbody tr[data-map-key]"));
  const triggers = Array.from(document.querySelectorAll(".column-filter-trigger"));
  const popover = document.getElementById("column-filter-popover");
  const popoverLabel = document.getElementById("column-filter-label");
  const popoverInput = document.getElementById("column-filter-input");
  const clearColumn = document.getElementById("clear-column-filter");
  const closeColumn = document.getElementById("close-column-filter");
  const selected = new Set();
  const columnFilters = new Map();
  let activeColumn = null;
  let resizeState = null;
  function send(message) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, "*"); }
  function updateSelection() {
    document.querySelectorAll(".result-select").forEach((input) => input.closest("tr")?.classList.toggle("selected-row", input.checked));
    if (count) count.textContent = \`显示 \${rows.filter((row) => !row.hidden).length} 条，已选 \${selected.size} 条\`;
    if (clearSelection) clearSelection.disabled = selected.size === 0;
    if (distanceButton) distanceButton.disabled = selected.size === 0 || !frame?.contentWindow;
    send({ type: "ALIBABA_MAP_SET_SELECTED", ids: [...selected] });
  }
  function applyMapSelection(ids, focusId) {
    selected.clear();
    const validKeys = new Set(rows.map((row) => String(row.dataset.mapKey || "")));
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const key = String(id);
      if (validKeys.has(key)) selected.add(key);
    });
    document.querySelectorAll(".result-select").forEach((input) => {
      input.checked = selected.has(String(input.dataset.mapKey || ""));
    });
    updateSelection();
    const target = rows.find((row) => String(row.dataset.mapKey || "") === String(focusId || ""));
    if (target && !target.hidden) {
      target.classList.add("selected-row");
      target.scrollIntoView?.({ block: "nearest" });
    }
  }
  function applyFilters() {
    const query = String(filter?.value || "").trim().toLowerCase();
    const active = [...columnFilters.entries()].filter(([, value]) => value).map(([index, value]) => ({ index, value: value.toLowerCase() }));
    rows.forEach((row) => {
      const globalMatch = !query || row.textContent.toLowerCase().includes(query);
      const columnMatch = active.every(({ index, value }) => String(row.cells[index]?.textContent || "").toLowerCase().includes(value));
      row.hidden = !(globalMatch && columnMatch);
    });
    updateSelection();
  }
  function syncTriggerState() { triggers.forEach((item) => item.classList.toggle("active", Boolean(columnFilters.get(Number(item.dataset.column))))); }
  function closePopover() { if (popover) popover.hidden = true; triggers.forEach((item) => item.closest("th")?.classList.remove("filter-open")); activeColumn = null; }
  function openPopover(trigger) {
    if (!popover || !popoverInput) return;
    activeColumn = Number(trigger.dataset.column);
    popoverLabel.textContent = trigger.getAttribute("aria-label") || "列筛选";
    popoverInput.value = columnFilters.get(activeColumn) || "";
    triggers.forEach((item) => item.closest("th")?.classList.toggle("filter-open", item === trigger));
    popover.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const width = 230;
   popover.style.left = \`\${Math.min(Math.max(8, rect.left - 150), Math.max(8, window.innerWidth - width - 8))}px\`;
   popover.style.top = \`\${Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 90))}px\`;
    popoverInput.focus(); popoverInput.select();
  }
  function stopResize(event) {
    if (!resizeState) return;
    resizeHandle?.releasePointerCapture?.(event?.pointerId);
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
   shell.style.height = \`\${Math.max(window.innerWidth < 820 ? 320 : 380, Math.round(resizeState.height + event.clientY - resizeState.y))}px\`;
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
  triggers.forEach((trigger) => trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!popover.hidden && activeColumn === Number(trigger.dataset.column)) closePopover(); else openPopover(trigger);
  }));
  popoverInput?.addEventListener("input", () => {
    if (activeColumn === null) return;
    const value = popoverInput.value.trim();
    if (value) columnFilters.set(activeColumn, value); else columnFilters.delete(activeColumn);
    syncTriggerState(); applyFilters();
  });
  clearColumn?.addEventListener("click", () => {
    if (activeColumn !== null) columnFilters.delete(activeColumn);
    if (popoverInput) popoverInput.value = "";
    syncTriggerState(); applyFilters();
  });
  closeColumn?.addEventListener("click", closePopover);
  clearFilters?.addEventListener("click", () => {
    if (filter) filter.value = "";
    columnFilters.clear();
    if (popoverInput) popoverInput.value = "";
    syncTriggerState(); closePopover(); applyFilters();
  });
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
  document.addEventListener("click", (event) => { if (!event.target.closest(".column-filter-popover, .column-filter-trigger")) closePopover(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePopover(); });
  applyFilters();
})();
</script>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>阿里司法拍卖成交案例</title>
<style>
 :root{color-scheme:light;--text:#1c2430;--muted:#667085;--line:#e5e9f0;--soft:#f8fafc;--blue:#2457c5}
 *{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1480px;margin:0 auto;padding:12px 20px 24px}h1{margin:0;font-size:20px}h2{margin:0;font-size:16px}.muted{color:var(--muted)}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px}.head p{margin:1px 0;color:var(--muted)}.head-right{text-align:right;color:var(--muted);font-size:12px}.summary-strip{display:flex;align-items:center;flex-wrap:wrap;gap:3px 12px;padding:4px 8px;margin-bottom:4px;background:#fff;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:12px;line-height:1.35}.summary-strip strong{color:var(--text)}.source{min-width:0;overflow:hidden;display:flex;align-items:center;gap:5px}.source-label{flex:0 0 auto}.source a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source a,a{color:var(--blue);text-decoration:none}.source a:hover,a:hover{text-decoration:underline}.card{background:#fff;border:1px solid var(--line);border-radius:9px;box-shadow:0 3px 12px rgba(29,41,57,.04);padding:10px;margin:8px 0}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}.actions{display:flex;gap:7px;flex-wrap:wrap}.button{display:inline-block;padding:6px 10px;border:0;border-radius:7px;background:var(--blue);color:#fff;text-decoration:none;font-size:12px;white-space:nowrap;cursor:pointer}.button.secondary{background:#eef3ff;color:var(--blue)}.button:disabled{opacity:.5;cursor:default}.map-frame-shell{position:relative;width:100%;height:440px;min-height:380px;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:#f8fafc}.map-frame-shell iframe{display:block;width:100%;height:100%;border:0;border-radius:inherit}.map-resize-handle{position:absolute;z-index:4;left:0;right:0;bottom:0;height:14px;cursor:ns-resize;touch-action:none;background:linear-gradient(to bottom,transparent 0,transparent 45%,rgba(36,87,197,.15) 46%,rgba(36,87,197,.15) 54%,transparent 55%)}.map-resize-handle:after{content:"";position:absolute;left:50%;bottom:4px;width:34px;height:3px;transform:translateX(-50%);border-radius:4px;background:#98a2b3}.map-empty,.inline-notice{padding:12px;color:var(--muted);background:#f8fafc;border-radius:7px}.inline-notice{margin-bottom:8px;color:#8b5e00;background:#fff8e6}.inline-notice p{margin:3px 0 0}.table-toolbar{display:flex;align-items:center;gap:7px;margin:-1px 0 8px}.result-filter{width:300px;max-width:100%;padding:6px 8px;border:1px solid #d0d7e2;border-radius:7px;font:inherit;font-size:12px}.result-filter:focus,.column-filter-popover input:focus{outline:2px solid #c7d7ff;border-color:var(--blue)}.result-count{color:var(--muted);font-size:12px}.table-toolbar .clear-selection{margin-left:auto}.clear-selection,.clear-filters{border:0;border-radius:7px;padding:6px 9px;background:#eef3ff;color:var(--blue);font-size:12px;cursor:pointer}.clear-selection:disabled{opacity:.45;cursor:default}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:7px}table{border-collapse:collapse;width:100%;min-width:1800px;white-space:nowrap}th,td{padding:7px 8px;border-bottom:1px solid #edf0f5;text-align:left;vertical-align:middle}th{position:sticky;top:0;z-index:3;background:var(--soft);font-weight:700}td.numeric-cell{text-align:right;font-variant-numeric:tabular-nums}th.sequence-column,td.sequence-cell{width:48px;text-align:center;color:#475467;font-variant-numeric:tabular-nums}th:first-child,td.select-cell{width:36px;text-align:center;padding-left:6px;padding-right:6px}.result-select{width:14px;height:14px;accent-color:#f97316}tr[data-map-key]{cursor:pointer}tr[data-map-key]:hover{background:#f5f8ff}tr.selected-row{background:#fff4df!important}tr.no-coordinate{background:#fffaf0}.table-header-cell{display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0}.table-header-cell>span{overflow:hidden;text-overflow:ellipsis}.column-filter-trigger{display:inline-flex;align-items:center;justify-content:center;flex:0 0 20px;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:#98a2b3;cursor:pointer}.column-filter-trigger:hover,.column-filter-trigger.active{background:#eaf1ff;color:var(--blue)}.filter-funnel{position:relative;display:block;width:11px;height:12px}.filter-funnel:before{content:"";position:absolute;left:1px;top:1px;width:9px;height:5px;background:currentColor;clip-path:polygon(0 0,100% 0,62% 100%,38% 100%)}.filter-funnel:after{content:"";position:absolute;left:5px;top:6px;width:2px;height:5px;background:currentColor;border-radius:1px}.column-filter-popover{position:fixed;z-index:10000;width:230px;padding:9px;background:#fff;border:1px solid #dbe3ef;border-radius:8px;box-shadow:0 10px 26px rgba(15,23,42,.18)}.column-filter-popover[hidden]{display:none}.column-filter-popover-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;color:#344054;font-size:12px;font-weight:700}.column-filter-popover-close{border:0;background:transparent;color:#98a2b3;font-size:17px;line-height:1;cursor:pointer}.column-filter-popover input{width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;font-size:12px}.column-filter-actions{display:flex;justify-content:flex-end;margin-top:7px}.column-filter-actions button{border:0;border-radius:6px;padding:5px 8px;background:#eef3ff;color:var(--blue);font-size:11px;cursor:pointer}.foot{margin-top:8px;color:var(--muted);font-size:12px}body.resizing-map{user-select:none;cursor:ns-resize}body.resizing-map iframe{pointer-events:none}@media (max-width:820px){main{padding:10px 12px 20px}.head{display:block}.head-right{text-align:left}.map-frame-shell{height:360px;min-height:320px}.table-toolbar{flex-wrap:wrap}.table-toolbar .clear-selection{margin-left:0}}
 </style><style>.result-context{margin-bottom:5px}.result-context-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--muted);font-size:12px}.result-context-toggle{border:1px solid #cbd5e1;border-radius:5px;padding:2px 7px;background:#f8fafc;color:var(--blue);font:inherit;font-size:11px;cursor:pointer}.result-context-toggle:hover{background:#eef3ff}.result-context-body{margin-top:4px}.result-context.collapsed .result-context-body{display:none}</style></head><body><main>
 <div class="head"><div><h1>阿里司法拍卖成交案例</h1><p>本地脚本读取已打开页面并逐条核验详情，不使用 AI 自动判断。</p></div><div class="head-right">生成时间：${generatedAt}</div></div>
 <div class="result-context" id="result-context"><div class="result-context-head"><span>抓取条件与来源</span><button id="toggle-result-context" class="result-context-toggle" type="button" aria-expanded="true">收起信息</button></div><div id="result-context-body" class="result-context-body"><div class="summary-strip summary-stats"><span>有效案例：<strong>${results.length}</strong> 条</span><span>候选记录：<strong>${Number(metadata.candidates || 0)}</strong> 条</span><span>跳过记录：<strong>${skipped}</strong> 条</span><span>拍卖状态：<strong>${escapeHtml(request.status === "finished" ? "已结束" : "全部状态")}</strong></span><span>物业类型：<strong>${escapeHtml(request.propertyType || "全部不动产")}</strong></span><span>成交日期：<strong>${escapeHtml(request.startDate || "不限")} 至 ${escapeHtml(request.endDate || "不限")}</strong></span></div>
 <div class="summary-strip source"><span class="source-label">列表来源：</span><a href="${sourceUrl}" title="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceUrl}</a></div></div></div>
 <section class="card"><div class="section-heading"><h2>地图（${results.filter((item) => mapNumber(item?.longitude, 70, 140) !== null && mapNumber(item?.latitude, 3, 55) !== null).length} 条可定位结果）</h2><div class="actions">${mapLink}</div></div>${mapPreview}</section>
 <section class="card"><div class="section-heading"><h2>成交案例明细</h2>${excelActions}</div>${emptyNotice}<div class="table-toolbar"><input id="result-filter" class="result-filter" type="search" placeholder="筛选标题、位置、行政区、物业类型……" aria-label="筛选成交案例"><span id="result-count" class="result-count"></span><button id="clear-filters" class="clear-filters" type="button">清除筛选</button><button id="clear-selection" class="clear-selection" type="button" disabled>清除勾选</button></div><div id="column-filter-popover" class="column-filter-popover" hidden><div class="column-filter-popover-head"><span id="column-filter-label">列筛选</span><button id="close-column-filter" class="column-filter-popover-close" type="button" aria-label="关闭">×</button></div><input id="column-filter-input" type="search" placeholder="输入关键词"><div class="column-filter-actions"><button id="clear-column-filter" type="button">清除当前列</button></div></div><div class="table-wrap"><table id="result-table"><thead><tr><th class="sequence-column">序号</th><th>选择</th>${header}</tr></thead><tbody>${rows || `<tr><td colspan="${columns.length + 2}" class="empty">暂未找到符合条件的成交案例</td></tr>`}</tbody></table></div></section>
 <div class="foot">成交案例仅保留详情页显示成交且出价次数大于 0 的记录；点击行可在地图中定位，勾选有坐标的案例可在地图上突出显示。</div>
 ${filterScript}</main></body></html>`;
}

function outputDirectoryFor(request = {}) {
  const raw = String(request.outputDirectory || RESULT_ROOT).trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_OUTPUT_DIRECTORY_INVALID");
  fs.mkdirSync(raw, { recursive: true, mode: 0o700 });
  const resolved = fs.realpathSync(raw);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("ALIBABA_OUTPUT_DIRECTORY_NOT_DIRECTORY");
  return resolved;
}

function writeUtf8Atomic(target, content) {
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

function mapNumber(value, minimum, maximum) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function mapRowsFromResults(results) {
  return (Array.isArray(results) ? results : []).map((item, index) => ({
    id: String(index + 1),
    title: String(item?.title || "").trim(),
    province: String(item?.province || "").trim(),
    city: String(item?.city || "").trim(),
    district: String(item?.district || "").trim(),
    propertyType: String(item?.propertyType || "").trim(),
    address: String(item?.address || "").trim(),
    transactionTime: normalizeDate(item?.transactionTime),
    transactionAmount: item?.transactionAmount ?? "",
    valuationAmount: item?.valuationAmount ?? "",
    buildingArea: item?.buildingArea ?? "",
    unitPrice: item?.unitPrice ?? "",
    bidCount: item?.bidCount ?? "",
    coordinateStatus: String(item?.coordinateStatus || (item?.longitude != null && item?.latitude != null ? "已定位（详情页坐标）" : "未定位（详情页未返回坐标）")).trim(),
    coordinateSource: String(item?.coordinateSource || "").trim(),
    coordinateProvider: String(item?.coordinateProvider || "").trim(),
    coordinatePrecision: String(item?.coordinatePrecision || "").trim(),
    longitude: mapNumber(item?.longitude, 70, 140),
    latitude: mapNumber(item?.latitude, 3, 55),
    url: safeExportUrl(item?.url),
  }));
}

const geocodeCache = new Map();
const geocodeFailureCache = new Set();
let geocodeCacheLoadedPath = "";
let geocodeCacheDirty = false;
let lastGeocodeAt = 0;

const emptyGeocodeStats = () => ({
  geocodeRequested: 0,
  geocodeCacheHits: 0,
  geocodeResolved: 0,
  geocodeFailed: 0,
  geocodeTimedOut: 0,
  geocodeDurationMs: 0,
});

function geocodeCachePath() {
  const configured = String(process.env.TIANYUAN_ALIBABA_GEOCODE_CACHE_PATH || "").trim();
  return configured && path.isAbsolute(configured) ? configured : DEFAULT_GEOCODE_CACHE_PATH;
}

function validCoordinatePair(value) {
  const longitude = mapNumber(value?.longitude, 70, 140);
  const latitude = mapNumber(value?.latitude, 3, 55);
  return longitude !== null && latitude !== null ? { longitude, latitude } : null;
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
  const firstPart = normalizeGeocodeText(noParenthetical.split(/[。]/)[0]);
  const variants = [
    full,
    normalizeGeocodeText([...context, noParenthetical].join(" ")),
    normalizeGeocodeText([...context, coarse].join(" ")),
    normalizeGeocodeText([request.city, request.district, coarse].filter(Boolean).join(" ")),
    normalizeGeocodeText([request.city, firstPart].filter(Boolean).join(" ")),
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
    // A missing or damaged cache is non-fatal. The next successful lookup
    // writes a fresh versioned file atomically.
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
    // Coordinate lookup must never prevent the result HTML/map from being
    // generated. Keep the in-memory value for this run and retry next time.
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timeoutError() {
  const error = new Error("GEOCODE_TIMEOUT");
  error.code = "GEOCODE_TIMEOUT";
  return error;
}

function withTimeout(value, timeoutMs, controller) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(timeoutError());
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
      endpoint: AMAP_GEOCODE_ENDPOINT,
      buildEndpoint(query) {
        const endpoint = new URL(AMAP_GEOCODE_ENDPOINT);
        endpoint.searchParams.set("words", query);
        endpoint.searchParams.set("datatype", "poi");
        const cityCode = amapCityCode(request);
        if (cityCode) endpoint.searchParams.set("city", cityCode);
        return endpoint;
      },
      parse(payload, query) {
        const amapResult = parseAmapCoordinate(payload, query, request, rawAddress);
        // Test doubles and older compatible endpoints may return the
        // Nominatim shape even when the request is sent to the AMap gateway.
        return amapResult || parseNominatimCoordinate(payload);
      },
    },
    {
      name: "nominatim",
      endpoint: NOMINATIM_GEOCODE_ENDPOINT,
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
      const legacyCacheKey = query.toLowerCase();
      const cachedValue = geocodeCache.get(cacheKey) || geocodeCache.get(legacyCacheKey);
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
        const cached = { ...coordinates };
        geocodeCache.set(cacheKey, cached);
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

async function enrichResultsWithCoordinates(results, request = {}) {
  const startedAt = Date.now();
  const output = (Array.isArray(results) ? results : []).map((item) => ({
    ...item,
    transactionTime: normalizeDate(item?.transactionTime),
  }));
  const stats = emptyGeocodeStats();
  if (request.geocodeMissing === false) return { results: output, stats };

  loadPersistentGeocodeCache();
  geocodeFailureCache.clear();
  const deadlineAt = startedAt + GEOCODE_TOTAL_BUDGET_MS;
  for (const item of output) {
    if (mapNumber(item.longitude, 70, 140) !== null && mapNumber(item.latitude, 3, 55) !== null) continue;
    const address = String(item.address || "").trim();
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

function renderMapHtml(mapData, request = {}) { return renderEnhancedMapHtml(mapData, request); }

function renderEnhancedMapHtml(mapData, request = {}) {
  const dataJson = JSON.stringify(mapData, (_key, value) => value === undefined ? null : value)
    .replace(/<\//g, "<\\/");
  const title = escapeHtml(request.city || request.district || "浙江省");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>阿里司法拍卖地图</title>
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
<div class="legend-panel"><div class="legend"><span><i class="residential"></i>住宅</span><span><i class="commercial"></i>商业</span><span><i class="selected"></i>已选案例</span><span><i class="reference"></i>自定义标记</span></div><div id="tile-status" class="tile-status">正在加载地图底图…</div><div class="map-tool-row"><button id="add-reference-marker" class="map-tool" type="button">插入位置标记</button><button id="clear-reference-markers" class="map-tool" type="button" disabled>清除标记</button></div><div id="map-tool-status" class="map-tool-status">点击“插入位置标记”后，再点击地图放置标记。</div><div id="reference-marker-list" class="reference-marker-list"></div></div>
<div id="distance-panel" class="distance-panel" hidden><div class="distance-panel-title"><span>选中案例到标记点距离</span><button id="close-distance-panel" class="distance-panel-close" type="button" aria-label="关闭距离结果">×</button></div><div id="distance-panel-note" class="distance-panel-note"></div><div id="distance-results"></div></div>
<div id="marker-dialog" class="marker-dialog-backdrop" hidden><form id="marker-dialog-form" class="marker-dialog-card" role="dialog" aria-modal="true" aria-labelledby="marker-dialog-title"><h2 id="marker-dialog-title" class="marker-dialog-title">添加位置标记</h2><p class="marker-dialog-description">为地图上的位置填写名称，也可以补充备注。</p><label class="marker-dialog-field"><span>标记名称</span><input id="marker-dialog-name" type="text" maxlength="80" required autocomplete="off"></label><label class="marker-dialog-field"><span>备注（可选）</span><textarea id="marker-dialog-note" rows="2" maxlength="160" placeholder="留空则不显示"></textarea></label><div class="marker-dialog-actions"><button id="marker-dialog-cancel" class="map-tool" type="button">取消</button><button class="map-tool primary" type="submit">确定</button></div></form></div>
<div class="work-panel collapsed" id="work-panel"><div class="floating-title"><span>案例清单</span><button class="panel-toggle" id="work-toggle" type="button">展开</button></div><div class="panel-body" id="work-body"><div class="list-tabs"><button class="list-tab active" id="case-tab" type="button">案例 <span id="case-tab-count">0</span></button><button class="list-tab" id="unlocated-tab" type="button">未定位 <span id="unlocated-tab-count">0</span></button></div><section class="list-section" id="case-section"><input id="case-search" class="case-search" type="search" placeholder="搜索标题、地址或物业类型"><select id="case-sort" class="case-sort" aria-label="案例排序"><option value="date_desc">时间：新到旧</option><option value="date_asc">时间：旧到新</option><option value="price_desc">成交金额：高到低</option><option value="price_asc">成交金额：低到高</option></select><div id="case-meta" class="case-meta"></div><ul id="case-list" class="case-list"></ul></section><section class="list-section hidden" id="unlocated-section"><div id="unlocated-meta" class="case-meta"></div><ul id="unlocated-list" class="unlocated-list"></ul></section></div></div>
<script>const DATA=${dataJson};${amapMaps.browserScript()}
AppraisalAmap.watch(DATA.mapConfig);</script>
<script src="leaflet.js"></script><script src="leaflet.markercluster.js"></script>
<script>
(function(){if(!window.L){AppraisalAmap.report("地图组件未能加载，请检查网络后刷新页面。");return;}
const map=AppraisalAmap.createMap("map",{preferCanvas:true,zoomControl:false},DATA.mapConfig,(message,kind)=>{const status=document.getElementById("tile-status");if(status){status.textContent=message;status.hidden=kind==="ok";}}).setView([30.25,120.16],9);L.control.zoom({position:"bottomright"}).addTo(map);
const cluster=window.L&&L.markerClusterGroup?L.markerClusterGroup({disableClusteringAtZoom:15,showCoverageOnHover:false}):L.layerGroup();const markers=new Map();const located=DATA.points||[];const unlocated=DATA.unlocated||[];const selectedKeys=new Set();const referenceMarkerData=[];const referenceMarkerLayers=new Map();const distanceLayer=L.layerGroup().addTo(map);let distanceLinesVisible=false;let placementMode=false;let pendingMarkerPosition=null;const esc=v=>String(v??"").replace(/[&<>"']/g,m=>m==="&"?"&amp;":m==="<"?"&lt;":m===">"?"&gt;":m.charCodeAt(0)===34?"&quot;":"&#39;");const numberText=v=>{const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n.toLocaleString("zh-CN",{maximumFractionDigits:2}):esc(v)};const markerKind=item=>String(item.propertyType||"").includes("商业")?"commercial":"residential";const storageKey="tianyuan-alibaba-auction-map-reference-v2:"+String(location.pathname||"default");
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
  function popup(item){const coordinateSource=item.coordinateProvider==="amap"?"高德坐落位置搜索":item.coordinateProvider==="nominatim"?"Nominatim 备用搜索":item.coordinateSource==="address-search"?"坐落位置搜索":"详情页明确坐标";const precision=item.coordinatePrecision==="poi"?"POI 精确点":item.coordinatePrecision==="address"?"地址点":"详情页坐标";const distances=distanceLinesVisible&&selectedKeys.has(String(item.id))?referenceMarkerData.map(marker=>itemDistance(item,marker)).filter(Number.isFinite):[];const distanceLine=distances.length?"<br>距位置标记："+distances.map(distanceText).join(" / "):"";return "<div class='case-popup-title'><span class='case-label-index'>序号 "+esc(item.id)+"</span>"+esc(item.title||"阿里拍卖案例")+"</div><div class='case-popup-meta'>物业类型："+esc(item.propertyType||"未填写")+"<br>坐落位置："+esc(item.address||"未填写")+"<br>交易时间："+esc(item.transactionTime||"未填写")+"<br>成交金额："+numberText(item.transactionAmount||"")+" 元<br>建筑面积："+numberText(item.buildingArea||"")+" m²"+distanceLine+"<br>坐标来源："+coordinateSource+"（"+precision+"）<br><a href='"+esc(item.url||"#")+"' target='_blank' rel='noopener noreferrer'>打开详情页</a></div>"}
function focus(item){const marker=markers.get(String(item?.id));if(!marker)return;const show=()=>{map.flyTo(marker.getLatLng(),Math.max(map.getZoom(),15),{duration:.45});marker.openPopup()};if(cluster.zoomToShowLayer)cluster.zoomToShowLayer(marker,show);else show()}
const basePopup=popup;const popupUnitPrice=value=>value===null||value===undefined||String(value).trim()===""?"未填写":numberText(value)+" 元/m²";popup=item=>basePopup(item).replace("<br>成交金额：","<br>单价："+popupUnitPrice(item?.unitPrice)+"<br>成交金额：");
function sortAmount(value){const parsed=Number(String(value??"").replace(/,/g,"").trim());return Number.isFinite(parsed)?parsed:0}
  function renderCaseList(){const query=String(document.getElementById("case-search")?.value||"").trim().toLowerCase(),sort=String(document.getElementById("case-sort")?.value||"date_desc"),rows=located.filter(item=>!query||[item.title,item.address,item.propertyType,item.transactionTime,item.district].join(" ").toLowerCase().includes(query)).slice().sort((a,b)=>sort.startsWith("price")?(sortAmount(a.transactionAmount)-sortAmount(b.transactionAmount))*(sort.endsWith("desc")?-1:1):String(a.transactionTime||"").localeCompare(String(b.transactionTime||""))*(sort.endsWith("desc")?-1:1));document.getElementById("case-meta").textContent="共 "+rows.length+" 条，点击案例可定位地图；点击地图标记可多选/取消并同步高亮表格；先在结果明细中勾选案例，再点击“显示到标记距离”。";document.getElementById("case-tab-count").textContent=located.length;document.getElementById("case-list").innerHTML=rows.map(item=>{const distances=distanceLinesVisible&&selectedKeys.has(String(item.id))?referenceMarkerData.map(marker=>itemDistance(item,marker)).filter(Number.isFinite):[];const distance=distances.length?"<span class='case-item-distance'>距标记 "+distances.map(distanceText).join(" / ")+"</span>":"";const amount=sortAmount(item.transactionAmount),amountText=amount?"成交金额 "+amount.toLocaleString("zh-CN",{maximumFractionDigits:2})+" 元":"成交金额未填写";return "<li class='case-item"+(selectedKeys.has(String(item.id))?" active":"")+"' data-id='"+esc(item.id)+"'><div class='case-item-title'><span class='case-item-index'>序号 "+esc(item.id)+"</span>"+esc(item.title||item.address||"未填写标题")+"</div><span class='case-item-sub'>"+esc([item.propertyType,item.address,item.transactionTime].filter(Boolean).join(" · "))+"</span>"+distance+"<div class='case-item-footer'><span class='case-item-price'>"+esc(amountText)+"</span><span class='case-item-link'>定位</span></div></li>"}).join("")||"<li class='case-item'>没有匹配记录</li>";document.querySelectorAll("#case-list .case-item[data-id]").forEach(node=>node.addEventListener("click",()=>focus(located.find(item=>String(item.id)===node.dataset.id))))}
const baseRenderCaseList=renderCaseList;const listUnitPrice=value=>{const number=Number(String(value??"").replace(/,/g,"").trim());return Number.isFinite(number)?number.toLocaleString("zh-CN",{maximumFractionDigits:2}):String(value||"未填写")};renderCaseList=()=>{baseRenderCaseList();document.querySelectorAll("#case-list .case-item[data-id]").forEach(node=>{const item=located.find(row=>String(row.id)===String(node.dataset.id));const footer=node.querySelector(".case-item-footer"),link=footer?.querySelector(".case-item-link");if(!item||!footer||!link)return;const unit=document.createElement("span");unit.className="case-item-unit-price";unit.textContent="单价 "+listUnitPrice(item.unitPrice)+" 元/m²";unit.style.color="#475569";unit.style.fontWeight="600";footer.insertBefore(unit,link)})};function updateMarkers(){located.forEach(item=>{const marker=markers.get(String(item.id));if(marker){marker.setIcon(iconFor(item));marker.setPopupContent(popup(item))}});renderCaseList()}function setSelected(ids){selectedKeys.clear();(Array.isArray(ids)?ids:[]).forEach(id=>selectedKeys.add(String(id)));updateMarkers();if(distanceLinesVisible)renderDistanceResults([...selectedKeys])}
  function syncCaseLabels(){const mode=map.getZoom()>=11?"compact":"none";located.forEach(item=>{const marker=markers.get(String(item.id));if(!marker)return;if(mode==="none"){if(marker.getTooltip())marker.unbindTooltip();return}if(marker.getTooltip())return;marker.bindTooltip("<div class='case-label-wrap'><div class='case-label-title'><span class='case-label-index'>序号 "+esc(item.id)+"</span>"+esc(item.address||"未填写位置")+"</div><div class='case-label-price'>单价："+popupUnitPrice(item.unitPrice)+"</div></div>",{permanent:true,direction:"top",offset:[0,-18],opacity:.98,className:"case-label",sticky:false})});}queueMicrotask(()=>{map.on("zoomend",syncCaseLabels);syncCaseLabels()});
function initLists(){document.getElementById("case-search")?.addEventListener("input",renderCaseList);document.getElementById("case-sort")?.addEventListener("change",renderCaseList);document.getElementById("work-toggle")?.addEventListener("click",()=>{const root=document.getElementById("work-panel"),collapsed=root.classList.toggle("collapsed");document.getElementById("work-toggle").textContent=collapsed?"展开":"收起"});[["case-tab","case-section"],["unlocated-tab","unlocated-section"]].forEach(([tabId,sectionId])=>document.getElementById(tabId)?.addEventListener("click",()=>{[["case-tab","case-section"],["unlocated-tab","unlocated-section"]].forEach(([otherTab,otherSection])=>{const active=otherTab===tabId;document.getElementById(otherTab)?.classList.toggle("active",active);document.getElementById(otherSection)?.classList.toggle("hidden",!active)})}));document.getElementById("unlocated-meta").textContent="共 "+unlocated.length+" 条，未返回坐标的记录保留在这里。";document.getElementById("unlocated-tab-count").textContent=unlocated.length;document.getElementById("unlocated-list").innerHTML=unlocated.slice(0,200).map(item=>"<li><strong>"+esc(item.title||item.address||"未填写标题")+"</strong><br>"+esc([item.propertyType,item.transactionTime].filter(Boolean).join("｜"))+"<span class='unlocated-reason'>"+esc(item.coordinateStatus||"未定位（缺少有效坐标）")+"</span></li>").join("")||"<li>没有未定位记录。</li>"}
  located.forEach(item=>{const marker=L.marker([item.latitude,item.longitude],{icon:iconFor(item)});marker.bindPopup(popup(item));marker.on("click",()=>{const key=String(item.id);if(selectedKeys.has(key))selectedKeys.delete(key);else selectedKeys.add(key);updateMarkers();if(window.parent!==window)window.parent.postMessage({type:"ALIBABA_MAP_SELECTION_CHANGED",ids:[...selectedKeys],focusId:key},"*")});markers.set(String(item.id),marker);cluster.addLayer(marker)});map.addLayer(cluster);const bounds=located.map(item=>[item.latitude,item.longitude]);if(bounds.length)map.fitBounds(bounds,{padding:[30,30]});initLists();initReferenceMarkers();renderCaseList();window.addEventListener("message",event=>{const message=event.data||{};if(message.type==="ALIBABA_MAP_SET_SELECTED")setSelected(message.ids);if(message.type==="ALIBABA_MAP_FOCUS")focus(located.find(item=>String(item.id)===String(Array.isArray(message.ids)?message.ids[0]:message.id)));if(message.type==="ALIBABA_MAP_DISTANCE_REQUEST"){setSelected(message.ids);renderDistanceResults(message.ids)}});if(window.parent!==window)window.parent.postMessage({type:"ALIBABA_MAP_READY"},"*");if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize()).observe(document.body);
})();
</script></body></html>`;
}

function writeMapAssets(results, request = {}) {
  const outputDirectory = outputDirectoryFor(request);
  for (const relativePath of MAP_ASSET_RELATIVE_PATHS) {
    const source = path.join(MAP_ASSET_SOURCE_DIRECTORY, relativePath);
    const target = path.join(outputDirectory, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`MAP_ASSET_MISSING: ${relativePath}`);
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
  writeUtf8Atomic(pointsJsPath, `window.ALIBABA_AUCTION_POINTS = ${JSON.stringify(points)};\n`);
  writeUtf8Atomic(mapPath, renderMapHtml(mapData, request));
  return { coordsPath, pointsJsPath, mapPath, locatedCount: points.length, unlocatedCount: unlocated.length };
}

function removeMapAssets(request = {}) {
  const outputDirectory = outputDirectoryFor(request);
  for (const name of [RESULT_COORDS_NAME, RESULT_POINTS_NAME, RESULT_MAP_NAME, ...MAP_ASSET_RELATIVE_PATHS]) {
    try { fs.unlinkSync(path.join(outputDirectory, name)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  try { fs.rmdirSync(path.join(outputDirectory, "images")); } catch (error) { if (!["ENOENT", "ENOTEMPTY"].includes(error?.code)) throw error; }
}

function validateHistoryDirectory(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_HISTORY_DIRECTORY_INVALID");
  const resolved = fs.realpathSync(raw);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("ALIBABA_HISTORY_DIRECTORY_NOT_FOUND");
  return resolved;
}

function validateHistoryPath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_HISTORY_PATH_INVALID");
  const resolved = fs.realpathSync(raw);
  if (path.extname(resolved).toLowerCase() !== ".json") throw new Error("ALIBABA_HISTORY_PATH_TYPE_NOT_ALLOWED");
  if (!fs.statSync(resolved).isFile()) throw new Error("ALIBABA_HISTORY_PATH_NOT_FOUND");
  return resolved;
}

function readHistoryPayload(value) {
  const historyPath = validateHistoryPath(value);
  let payload;
  try { payload = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { throw new Error("ALIBABA_HISTORY_READ_FAILED"); }
  if (payload?.type !== "alibaba-auction-history") throw new Error("ALIBABA_HISTORY_FORMAT_INVALID");
  const results = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.items)
      ? payload.items.map((item) => item?.record || item).filter(Boolean)
      : [];
  return { historyPath, payload, results };
}

function historyOutputPath(historyPath, value, extensions = [".html", ".xlsx", ".json", ".js"]) {
  const name = String(value || "").trim();
  if (!name) return "";
  const candidate = path.resolve(path.dirname(historyPath), name);
  if (!isInsideDirectory(path.dirname(historyPath), candidate)) return "";
  if (!extensions.includes(path.extname(candidate).toLowerCase()) || !fs.existsSync(candidate)) return "";
  return fs.statSync(candidate).isFile() ? fs.realpathSync(candidate) : "";
}

function historyRequest(request = {}) {
  const safeRequest = { ...request };
  delete safeRequest.historyPath;
  delete safeRequest.historyRefresh;
  return safeRequest;
}

function writeHistoryManifest(results, request, metadata = {}, outputs = {}) {
  const outputDirectory = outputDirectoryFor(request);
  const target = path.join(outputDirectory, RESULT_HISTORY_NAME);
  const payload = {
    type: "alibaba-auction-history",
    version: 1,
    generatedAt: new Date().toISOString(),
    request: historyRequest(request),
    summary: {
      candidates: Number(metadata.candidates || results.length),
      skipped: Number(metadata.skipped || 0),
      written: results.length,
    },
    outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value ? path.basename(value) : ""])),
    results: results.map((item) => ({
      ...item,
      url: safeExportUrl(item?.url),
      attachments: undefined,
    })),
  };
  writeUtf8Atomic(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

function listHistory(directory) {
  const root = validateHistoryDirectory(directory);
  const items = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !(entry.name === RESULT_HISTORY_NAME || entry.name.endsWith("_history.json"))) continue;
    const fullPath = path.join(root, entry.name);
    try {
      const loaded = readHistoryPayload(fullPath);
      const outputs = loaded.payload.outputs || {};
      items.push({
        path: loaded.historyPath,
        name: entry.name,
        label: `${loaded.payload.request?.city || loaded.payload.request?.district || "全省"} · ${loaded.payload.generatedAt || "历史抓取"} · ${loaded.results.length} 条`,
        generatedAt: loaded.payload.generatedAt || "",
        recordCount: loaded.results.length,
        canRefresh: loaded.results.some((item) => item?.url),
        htmlPath: historyOutputPath(loaded.historyPath, outputs.html),
        excelPath: historyOutputPath(loaded.historyPath, outputs.excel),
        mapPath: historyOutputPath(loaded.historyPath, outputs.map),
      });
    } catch {
      // Ignore unrelated or incomplete JSON files.
    }
  }
  items.sort((left, right) => String(right.generatedAt || right.name).localeCompare(String(left.generatedAt || left.name), "zh-CN"));
  return { ok: true, action: "list_alibaba_auction_history", directory: root, items: items.slice(0, 200), security: security() };
}

function loadHistory(value) {
  const loaded = readHistoryPayload(value);
  const outputs = loaded.payload.outputs || {};
  const storedRequest = loaded.payload.request && typeof loaded.payload.request === "object"
    ? loaded.payload.request
    : {};
  const generateMap = storedRequest.generateMap !== false;
  let mapPath = "";
  let mapRebuilt = false;
  if (generateMap) {
    const artifacts = writeMapAssets(loaded.results, {
      ...storedRequest,
      outputDirectory: path.dirname(loaded.historyPath),
      generateMap: true,
      geocodeMissing: false,
    });
    mapPath = artifacts.mapPath;
    mapRebuilt = true;
  }
  return {
    ok: true,
    action: "load_alibaba_auction_history",
    path: loaded.historyPath,
    outputDirectory: path.dirname(loaded.historyPath),
    request: storedRequest,
    recordCount: loaded.results.length,
    canRefresh: loaded.results.some((item) => item?.url),
    results: loaded.results,
    htmlPath: historyOutputPath(loaded.historyPath, outputs.html),
    excelPath: historyOutputPath(loaded.historyPath, outputs.excel),
    mapPath,
    mapRebuilt,
    mapGeneration: generateMap ? "rebuilt-from-history" : "disabled-by-history-request",
    security: security(),
  };
}

async function writeResultArtifacts(results, request, metadata = {}) {
  const baseResults = Array.isArray(results) ? results : [];
  let enrichedResults = baseResults;
  let geocodeStats = emptyGeocodeStats();
  if (request.generateMap !== false) {
    try {
      const enrichment = await enrichResultsWithCoordinates(baseResults, request);
      enrichedResults = enrichment.results;
      geocodeStats = enrichment.stats;
    } catch {
      // Keep result generation fail-open if a public geocoder or its cache
      // encounters an unexpected error.
      enrichedResults = baseResults.map((item) => ({
        ...item,
        transactionTime: normalizeDate(item?.transactionTime),
      }));
      geocodeStats = emptyGeocodeStats();
    }
  }
  const htmlPath = writeResultHtml(enrichedResults, request, metadata);
  if (request.generateMap === false) {
    removeMapAssets(request);
    const historyPath = writeHistoryManifest(enrichedResults, request, metadata, { html: htmlPath });
    return {
      htmlPath,
      historyPath,
      results: enrichedResults,
      mapPath: "",
      coordsPath: "",
      pointsJsPath: "",
      locatedCount: 0,
      unlocatedCount: enrichedResults.length,
      ...emptyGeocodeStats(),
    };
  }
  const mapArtifacts = writeMapAssets(enrichedResults, request);
  const historyPath = writeHistoryManifest(enrichedResults, request, metadata, {
    html: htmlPath,
    map: mapArtifacts.mapPath,
    coords: mapArtifacts.coordsPath,
    pointsJs: mapArtifacts.pointsJsPath,
  });
  return { htmlPath, historyPath, results: enrichedResults, ...mapArtifacts, ...geocodeStats };
}

function writeResultHtml(results, request, metadata = {}) {
  const target = path.join(outputDirectoryFor(request), RESULT_HTML_NAME);
  writeUtf8Atomic(target, renderResultHtml(results, request, metadata));
  return target;
}

function isInsideDirectory(root, value) {
  const resolved = path.resolve(value);
  const relative = path.relative(root, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateResultOutputPath(value, outputDirectory = RESULT_ROOT) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_RESULT_PATH_INVALID");
  const resolved = path.resolve(raw);
  let root;
  try { root = fs.realpathSync(outputDirectory); } catch { throw new Error("ALIBABA_OUTPUT_DIRECTORY_INVALID"); }
  if (!isInsideDirectory(root, resolved) || path.extname(resolved).toLowerCase() !== ".xlsx") {
    throw new Error("ALIBABA_RESULT_PATH_NOT_ALLOWED");
  }
  return resolved;
}

function normalizeExcelCell(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return String(value).slice(0, 4000);
}

function safeExportUrl(value) {
  try {
    const url = new URL(canonicalUrl(value));
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

function normalizeExcelRows(results) {
  return (Array.isArray(results) ? results : []).map((item) => Object.fromEntries(
    RESULT_EXCEL_COLUMNS.map(([, field]) => [
      field,
      field === "url"
        ? safeExportUrl(item?.[field])
        : field === "transactionTime"
          ? normalizeDate(item?.[field])
          : normalizeExcelCell(item?.[field]),
    ]),
  ));
}

async function writeResultExcel(results, request, metadata = {}, outputPath = "") {
  const rows = normalizeExcelRows(results);
  if (!rows.length) throw new Error("ALIBABA_EXCEL_NO_RESULTS");
  const outputDirectory = outputDirectoryFor(request);
  const target = validateResultOutputPath(outputPath || path.join(outputDirectory, RESULT_EXCEL_NAME), outputDirectory);
  const payloadPath = path.join(outputDirectory, `.excel-export-${process.pid}-${Date.now()}.json`);
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
    await runCommand(PYTHON_BIN, ["-X", "utf8", "-c", RESULT_EXCEL_SCRIPT, payloadPath, target], {
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size <= 0) throw new Error("ALIBABA_EXCEL_READBACK_FAILED");
    return {
      ok: true,
      action: "write_alibaba_auction_excel",
      excelPath: target,
      rowCount: rows.length,
      fileSize: stat.size,
      readbackOk: true,
      security: security(),
    };
  } catch (error) {
    throw pythonExportFailure(error, "ALIBABA_EXCEL_EXPORT_FAILED");
  } finally {
    try {
      fs.unlinkSync(payloadPath);
    } catch {
      // The temporary payload is best-effort cleaned after a failed export.
    }
  }
}

function validateResultPath(value, outputDirectory = RESULT_ROOT) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ALIBABA_RESULT_PATH_INVALID");
  const resolved = path.resolve(raw);
  let root;
  try { root = fs.realpathSync(outputDirectory); } catch { throw new Error("ALIBABA_OUTPUT_DIRECTORY_INVALID"); }
  if (!isInsideDirectory(root, resolved) || ![".html", ".xlsx"].includes(path.extname(resolved).toLowerCase())) {
    throw new Error("ALIBABA_RESULT_PATH_NOT_ALLOWED");
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("ALIBABA_RESULT_NOT_FOUND");
  return resolved;
}

async function scrape(requestInput, emit = () => {}) {
  const request = normalizeRequest(requestInput);
  const progress = (payload) => emit({ security: security(), ...payload });
  const candidates = [];
  const seen = new Set();
  let prefiltered = 0;

  progress({ phase: "opening", percent: 2, message: "正在打开阿里拍卖列表页…", fetched: 0, verified: 0, skipped: 0 });
  try {
    await ensureBound(request.session);
  } catch (error) {
    const reason = safeError(error);
    return { ok: false, phase: "failed", errorCode: reason, reason, candidates: 0, results: [], security: security() };
  }
  for (let page = 1; page <= SAFE_MAX_PAGES; page += 1) {
    const pageUrl = listPageUrl(request.sourceUrl, page);
    let listPage;
    try {
      listPage = await openBrowserPage(request.session, pageUrl, { window: "foreground", allowVerification: true });
      const extractedRead = await readBrowserPageWithManualVerification(
        request.session,
        listPage,
        LIST_EXTRACT_SCRIPT,
        pageUrl,
        "list",
        progress,
        "读取列表",
      );
      const extracted = extractedRead.value;
      const blocked = pageLooksBlocked(extracted);
      if (blocked) throw new Error(blocked);
      const pageItems = Array.isArray(extracted.items) ? extracted.items : [];
      let newItems = 0;
      for (const item of pageItems) {
        const url = canonicalUrl(item.href);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        newItems += 1;
        if (!candidateInScope(item, request)) {
          prefiltered += 1;
          continue;
        }
        candidates.push({
          url,
          title: String(item.text || "").split("\n")[0].trim(),
          listedAmount: String(item.listedAmount || ""),
          listedBidCount: Number(item.listedBidCount || 0),
          listedHasEndedText: item.listedHasEndedText === true,
          listedHasExplicitSoldPrice: item.listedHasExplicitSoldPrice === true,
        });
      }
      progress({
        phase: "listing",
        percent: Math.min(35, 5 + Math.round((page / SAFE_MAX_PAGES) * 30)),
        message: `已读取第 ${page} 页候选记录，共 ${candidates.length} 条，准备详情核验…`,
        page,
        pages: SAFE_MAX_PAGES,
        fetched: candidates.length,
        verified: 0,
        skipped: prefiltered,
      });
      if (pageBeforeRequestedRange(pageItems, request)) {
        progress({
          phase: "listing",
          percent: Math.min(35, 5 + Math.round((page / SAFE_MAX_PAGES) * 30)),
          message: `第 ${page} 页日期已早于所选起始日，停止继续翻页。`,
          page,
          pages: SAFE_MAX_PAGES,
          fetched: candidates.length,
          verified: 0,
          skipped: prefiltered,
        });
        break;
      }
      if (!pageItems.length || newItems === 0) break;
    } catch (error) {
      const reason = safeError(error);
      const errorCode = String(error?.code || reason);
      const userReason = errorCode === "ALIBABA_LOGIN_REQUIRED"
        ? "请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。"
        : errorCode === "ALIBABA_VERIFICATION_REQUIRED" || errorCode === "ALIBABA_VERIFICATION_TIMEOUT"
          ? "请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。"
          : reason;
      return { ok: false, phase: "failed", errorCode, reason: userReason, diagnostic: reason, page: safeBrowserPageSummary(listPage, pageUrl, "list"), candidates: candidates.length, results: [], security: security() };
    }
  }

  if (!candidates.length) {
    return { ok: false, phase: "failed", errorCode: "ALIBABA_LIST_EMPTY", reason: prefiltered ? "当前列表记录均不在所选交易状态或日期范围内。" : "未读取到阿里拍卖候选记录。请确认页面已登录且没有出现验证页。", candidates: 0, results: [], skipped: prefiltered, security: security() };
  }

  const results = [];
  const skippedReasons = [];
  let skipped = prefiltered;
  const attempted = new Set();
  for (const candidate of candidates) {
    if (attempted.has(candidate.url)) continue;
    attempted.add(candidate.url);
    let detailPage;
    try {
      detailPage = await openBrowserPage(request.session, candidate.url, { window: "foreground", allowVerification: true });
      const detailRead = await readBrowserPageWithManualVerification(
        request.session,
        detailPage,
        DETAIL_EXTRACT_SCRIPT,
        candidate.url,
        "detail",
        progress,
        "核验当前详情",
      );
      let detail = detailRead.value;
      const blocked = pageLooksBlocked(detail);
      if (blocked) throw new Error(blocked);
      const detailFloors = extractFloorFieldsFromText(detail.pageText);
      const hasLowConfidenceFields = detail.fieldSources?.buildingArea !== "structured"
        || detail.fieldSources?.floor !== "structured"
        || detail.fieldSources?.totalFloors !== "structured";
      const needsAttachmentFields = hasLowConfidenceFields
        || !parseAmount(detail.buildingArea)
        || !detailFloors.floor
        || !detailFloors.totalFloors;
      if (needsAttachmentFields && Array.isArray(detail.attachments) && detail.attachments.length) {
        progress({
          phase: "reading_attachments",
          percent: Math.min(98, 35 + Math.round((attempted.size / candidates.length) * 63)),
          message: "详情页字段不完整，正在读取评估报告附件，必要时进行 OCR 补充建筑面积和楼层…",
          fetched: candidates.length,
          verified: results.length,
          skipped,
          current: detail.title || candidate.title,
        });
        detail = await enrichDetailFromAttachments(detail, {
          session: request.session,
          restoreUrl: candidate.url,
          target: detailPage.target,
        });
      }
      const detailWithListingEvidence = {
        ...detail,
        transactionAmount: detail.transactionAmount || candidate.listedAmount,
        bidCount: detail.bidCount || String(candidate.listedBidCount || ""),
        hasExplicitSoldPrice: detail.hasExplicitSoldPrice === true || candidate.listedHasExplicitSoldPrice === true,
        hasSoldText: detail.hasSoldText === true || (candidate.listedBidCount > 0 && candidate.listedHasEndedText === true),
        hasEndedText: detail.hasEndedText === true || candidate.listedHasEndedText === true,
      };
      const parsed = parseDetail(detailWithListingEvidence, request);
      const accepted = parsed.valid && matchesRequest(parsed, request);
      if (accepted) results.push(parsed);
      else {
        skipped += 1;
        skippedReasons.push({
          title: parsed.title || candidate.title,
          url: candidate.url,
          reason: skipReason(detailWithListingEvidence, parsed, request),
          diagnostics: {
            transactionAmount: parsed.transactionAmount || null,
            transactionTime: parsed.transactionTime || "",
            bidCount: Number(parsed.bidCount || 0),
            hasExplicitSoldPrice: detailWithListingEvidence.hasExplicitSoldPrice === true,
            hasEndedText: detailWithListingEvidence.hasEndedText === true,
            valid: parsed.valid === true,
            matched: matchesRequest(parsed, request),
          },
        });
      }
      progress({
        phase: "verifying",
        percent: Math.min(98, 35 + Math.round((attempted.size / candidates.length) * 63)),
        message: accepted ? `已核验成交案例 ${results.length} 条。` : `已跳过记录 ${skipped} 条：${skippedReasons.at(-1)?.reason || "未通过核验"}。`,
        fetched: candidates.length,
        verified: results.length,
        skipped,
        current: parsed.title || candidate.title,
      });
    } catch (error) {
      const reason = safeError(error);
      const errorCode = String(error?.code || reason);
      if (["ALIBABA_LOGIN_REQUIRED", "ALIBABA_VERIFICATION_REQUIRED", "ALIBABA_VERIFICATION_TIMEOUT", "ALIBABA_TAB_REPLACED", "ALIBABA_TARGET_MISMATCH", "ALIBABA_SCRIPT_EXECUTION_FAILED"].includes(errorCode)) {
        const userReason = errorCode === "ALIBABA_LOGIN_REQUIRED"
          ? "请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。"
          : errorCode === "ALIBABA_VERIFICATION_REQUIRED" || errorCode === "ALIBABA_VERIFICATION_TIMEOUT"
            ? "请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。"
            : reason;
        return { ok: false, phase: "failed", errorCode, reason: userReason, diagnostic: reason, page: safeBrowserPageSummary(detailPage, candidate.url, "detail"), candidates: candidates.length, results, skipped, security: security() };
      }
      skipped += 1;
      progress({ phase: "verifying", percent: Math.min(98, 35 + Math.round((attempted.size / candidates.length) * 63)), message: `详情读取失败，已跳过 ${skipped} 条。`, fetched: candidates.length, verified: results.length, skipped, current: candidate.title });
      skippedReasons.push({ title: candidate.title, url: candidate.url, reason: `详情读取失败：${reason}` });
    }
  }
  const htmlPath = results.length ? writeResultHtml(results, request, { candidates: candidates.length, skipped }) : "";
  return {
    ok: results.length > 0,
    phase: "completed",
    errorCode: results.length ? "" : "ALIBABA_NO_VALID_CASES",
    reason: results.length ? "阿里拍卖成交案例已完成详情核验。" : "候选记录中没有找到详情页可确认的成交案例。",
    candidates: candidates.length,
    results,
    htmlPath,
    skipped,
    skippedReasons: skippedReasons.slice(-20),
    security: security(),
  };
}

async function openPage(requestInput) {
  const request = normalizeRequest(requestInput);
  await ensureBound(request.session);
  const page = await openBrowserPage(request.session, request.sourceUrl, { window: "foreground", allowVerification: true });
  if (/login\.taobao|\/login(?:[/?]|$)/i.test(String(page.url || ""))) {
    const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
    failure.code = "ALIBABA_LOGIN_REQUIRED";
    throw failure;
  }
  if (page.verificationRequired) {
    const failure = new Error("请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。");
    failure.code = "ALIBABA_VERIFICATION_REQUIRED";
    throw failure;
  }
  return {
    ok: true,
    action: "open_alibaba_auction",
    session: request.session,
    sourceUrl: request.sourceUrl,
    message: "已打开阿里拍卖列表页；如出现登录或验证，请先在浏览器完成后再开始抓取。",
    security: security(),
  };
}

async function ensureBound(session) {
  try {
    await runOpenCli(["browser", session, "state"], { timeout: 15000 });
  } catch {
    await runOpenCli(["browser", session, "bind"], { timeout: 30000 });
  }
}

module.exports = {
  DEFAULT_SESSION,
  DEFAULT_SOURCE_URL,
  DETAIL_EXTRACT_SCRIPT,
  LIST_EXTRACT_SCRIPT,
  RESULT_ROOT,
  RESULT_HTML_NAME,
  RESULT_HISTORY_NAME,
  DEFAULT_GEOCODE_CACHE_PATH,
  GEOCODE_REQUEST_TIMEOUT_MS,
  GEOCODE_TOTAL_BUDGET_MS,
  GEOCODE_MIN_INTERVAL_MS,
  canonicalUrl,
  browserTargetArgs,
  browserUrlsMatch,
  openedBrowserTarget,
  commandEnvironment,
  normalizeRequest,
  openPage,
  parseDetail,
  matchesRequest,
  parseJsonOutput,
  renderResultHtml,
  renderMapHtml,
  writeMapAssets,
  writeResultArtifacts,
  writeHistoryManifest,
  listHistory,
  loadHistory,
  validateHistoryPath,
  outputDirectoryFor,
  safeError,
  safeBrowserPageSummary,
  scrape,
  validateResultPath,
  validateResultOutputPath,
  writeResultExcel,
  writeResultHtml,
  extractBuildingAreaFromText,
  extractFloorFieldsFromText,
  browserPageReady,
  candidateInScope,
  pageBeforeRequestedRange,
  extractPdfText,
  extractPdfTextWithOcr,
  enrichDetailFromAttachments,
  enrichDetailFromAttachmentBuffers,
};
