import { alibabaLeaseTemplate } from "./template.js";
// 区划目录来自共享数据层，与阿里司法拍卖模块使用同一份行政区划数据。
import { ALIBABA_REGION_CATALOG } from "../../data/china-regions.js";

// 阿里资产搜索页（zc-paimai）的类目与筛选全部走 URL 参数，无需像 sf 列表那样
// 操作页面下拉控件：h_t_mode 缺失时列表会混入普通房产拍卖（2026-10-02 实测），
// 因此每次导航都必须带全 h_t_mode 与 structFieldMap，分页亦然。
const LEASE_SEARCH_PATH = "/wow/pm/default/pc/zichansearch";
// 类目 ID 来自真实页面筛选实测（2026-10-02）：点击分类 chips 后 URL 中的 fcatV4Ids。
const LEASE_CATEGORY = {
  residential: "206060601",
  commercial: "206057102",
};
const LEASE_PROPERTY_TYPES = ["residential", "commercial"];
const LEASE_PROPERTY_LABELS = {
  residential: "住宅用房",
  commercial: "商业用房",
};
const LEASE_MODE_FILTER = "[2,3]";
const LEASE_MODE_STRUCT_FIELD = '{"h_t_mode":"[2,3]"}';
// statusOrders：已结束=["2"]；全部状态不传该参数（实测 ["1"] 只返回进行中/预告）。
const STATUS_ORDERS_FINISHED = '["2"]';
const DEFAULT_SOURCE_URL = "https://zc-paimai.taobao.com/wow/pm/default/pc/zichansearch?disableNav=YES&page=1&fcatV4Ids=%5B%22206060601%22%5D&h_t_mode=%5B2,3%5D&structFieldMap=%7B%22h_t_mode%22%3A%22%5B2%2C3%5D%22%7D&statusOrders=%5B%222%22%5D&locationCodes=%5B%22330102%22%5D";
const DEFAULT_CONFIG = {
  province: "浙江省",
  provinceCode: "330000",
  city: "杭州市",
  cityCode: "330100",
  district: "上城区",
  districtCode: "330102",
  propertyType: "residential",
  status: "finished",
  keyword: "",
  startDate: "",
  endDate: "",
  maxPages: 1,
  outputDirectory: "",
  generateMap: true,
};

const LEASE_PARAMETER_SNAPSHOT_FIELDS = [
  "province", "provinceCode", "city", "cityCode", "district", "districtCode",
  "propertyType", "status", "keyword", "startDate", "endDate", "maxPages", "outputDirectory", "generateMap",
];

function parameterSnapshotMatches(config, snapshot) {
  if (!config || !snapshot) return false;
  const current = normalizeConfig(config);
  const confirmed = normalizeConfig(snapshot);
  return LEASE_PARAMETER_SNAPSHOT_FIELDS.every((field) => current[field] === confirmed[field]);
}

const RESULT_FIELDS = [
  "title", "province", "city", "district", "community", "location", "transferMode", "propertyType", "houseUsage",
  "buildingArea", "transactionAmount", "startPrice", "valuationAmount", "monthlyUnitPrice",
  "leaseTermYears", "rentPaymentTerms", "rentEscalation", "depositAmount",
  "orientation", "layout", "floor", "totalFloors", "decoration",
  "bidCount", "signupCount", "viewCount", "endTime", "resultStatus",
  "longitude", "latitude", "coordinateStatus", "platform", "verificationStatus", "url",
];

function elementMap(documentRef) {
  const ids = [
    "openAlibabaLease", "page-alibaba-lease", "backFromAlibabaLease",
    "alibabaLeaseProvince", "alibabaLeaseCity", "alibabaLeaseDistrict", "alibabaLeasePropertyType",
    "alibabaLeaseStatus", "alibabaLeaseKeyword", "alibabaLeaseStartDate",
    "alibabaLeaseEndDate", "alibabaLeaseMaxPages", "alibabaLeaseSourceUrl",
    "openAlibabaLeaseSource", "runAlibabaLease",
    "saveAlibabaLeaseParams", "resetAlibabaLeaseParams", "alibabaLeaseParameterState", "alibabaLeaseParameterMessage",
    "alibabaLeaseOutputDirectory", "chooseAlibabaLeaseOutput", "alibabaLeaseGenerateMap",
    "alibabaLeaseResultCount", "alibabaLeaseResultStatus", "openAlibabaLeaseResult", "exportAlibabaLeaseExcel",
    "openAlibabaLeaseExcel", "openAlibabaLeaseMap", "pauseAlibabaLease", "stopAlibabaLease",
    "clearAlibabaLeaseResults", "alibabaLeaseResultMessage", "alibabaLeaseProgressPhase",
    "alibabaLeaseProgressPercent", "alibabaLeaseProgressBar", "alibabaLeaseProgressFetched",
    "alibabaLeaseProgressVerified", "alibabaLeaseProgressSkipped",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function usableDistricts(cityRegion) {
  return (cityRegion?.children || []).filter((item) => !["全市", "市辖区"].includes(item?.name));
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const provinceCodeText = String(source.provinceCode || "");
  let province = ALIBABA_REGION_CATALOG.find((item) => item.code === provinceCodeText)
    || ALIBABA_REGION_CATALOG.find((item) => item.name === String(source.province || ""));
  if (!province && provinceCodeText) {
    throw new Error(`ALIBABA_LEASE_PROVINCE_CODE_UNKNOWN:${provinceCodeText}`);
  }
  if (!province) province = ALIBABA_REGION_CATALOG.find((item) => item.code === DEFAULT_CONFIG.provinceCode);
  const hasCitySelection = Object.hasOwn(source, "cityCode") || Object.hasOwn(source, "city");
  const city = province?.children?.find((item) => item.code === String(source.cityCode || "") || item.name === String(source.city || ""))
    || (!hasCitySelection && province?.code === DEFAULT_CONFIG.provinceCode ? province.children.find((item) => item.code === DEFAULT_CONFIG.cityCode) : null);
  const district = usableDistricts(city).find((item) => item.code === String(source.districtCode || "") || item.name === String(source.district || "")) || null;
  const maxPages = Math.max(1, Math.min(5, Number(source.maxPages ?? DEFAULT_CONFIG.maxPages) || 1));
  return {
    ...DEFAULT_CONFIG,
    province: province?.name || DEFAULT_CONFIG.province,
    provinceCode: province?.code || DEFAULT_CONFIG.provinceCode,
    city: city?.name || "",
    cityCode: city?.code || "",
    district: district?.name || "",
    districtCode: district?.code || "",
    propertyType: LEASE_PROPERTY_TYPES.includes(source.propertyType) ? source.propertyType : DEFAULT_CONFIG.propertyType,
    status: ["finished", "all"].includes(source.status) ? source.status : DEFAULT_CONFIG.status,
    keyword: String(source.keyword || "").trim().slice(0, 100),
    startDate: String(source.startDate || "").trim(),
    endDate: String(source.endDate || "").trim(),
    maxPages,
    outputDirectory: String(source.outputDirectory || "").trim(),
    generateMap: source.generateMap !== false,
  };
}

function locationScopeCode(config) {
  return String(config.districtCode || config.cityCode || config.provinceCode || "").trim();
}

function buildSourceUrl(config, page = 1) {
  const category = LEASE_CATEGORY[config.propertyType] || LEASE_CATEGORY.residential;
  const url = new URL(`https://zc-paimai.taobao.com${LEASE_SEARCH_PATH}`);
  url.searchParams.set("disableNav", "YES");
  url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
  url.searchParams.set("fcatV4Ids", JSON.stringify([category]));
  url.searchParams.set("h_t_mode", LEASE_MODE_FILTER);
  url.searchParams.set("structFieldMap", JSON.stringify({ h_t_mode: LEASE_MODE_FILTER }));
  if (config.status === "finished") url.searchParams.set("statusOrders", STATUS_ORDERS_FINISHED);
  const locationCode = locationScopeCode(config);
  if (locationCode) url.searchParams.set("locationCodes", JSON.stringify([locationCode]));
  return url.href;
}

// 用户在阿里页面完成筛选后，插件按页数上限逐页读取，不无限翻页。
const MAX_PAGES_LIMIT = 5;
const MANUAL_VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;

async function waitForRunResume(control, emit) {
  if (control?.stopped) throw new Error("ALIBABA_LEASE_SCRAPE_STOPPED");
  if (!control?.paused) return;
  emit({ phase: "paused", message: "抓取已暂停；点击“继续抓取”后会从当前进度继续。" });
  await new Promise((resolve) => control.resumeResolvers.push(resolve));
  if (control.stopped) throw new Error("ALIBABA_LEASE_SCRAPE_STOPPED");
  emit({ phase: "listing", message: "已继续抓取。" });
}

// ===== 页面内注入提取函数（serialize 后在目标页面执行，禁止引用外部作用域） =====

function extractLeaseListPage() {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
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
  const isRecommended = (element) => {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const marker = `${current.id || ""} ${current.className || ""} ${current.getAttribute?.("aria-label") || ""}`;
      if (/recommend|guess|猜你喜欢|为您推荐|推荐更多/i.test(marker)) return true;
    }
    return false;
  };
  const parseCardAmount = (text, labels) => {
    // 数字后禁止紧跟“年”，避免把“结束 2026年09月23日”里的年份当金额；
    // “待说明”等占位文本与数字的距离上限一起挡住跨字段误捕。
    const pattern = new RegExp(`(?:${labels.join("|")})[^\\d¥￥]{0,6}[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(万|亿|元)?(?!\\s*年)`);
    const match = text.match(pattern);
    if (!match) return "";
    const number = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(number)) return "";
    const scale = match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1;
    return String(Math.round(number * scale * 100) / 100);
  };
  const items = [];
  const seen = new Set();
  const root = document.querySelector('[class*="pc-search-list--area"]');
  const cards = root ? [...root.children] : [];
  for (const card of cards) {
    const anchor = card.querySelector('a[href*="zc-item.taobao.com/auction/"], a[href*="item-paimai.taobao.com/auction/"]');
    if (!anchor || !isVisible(anchor) || isRecommended(anchor)) continue;
    const href = anchor.href || "";
    if (!href || seen.has(href)) continue;
    const text = clean(card.innerText || card.textContent || "");
    if (!text) continue;
    seen.add(href);
    // 卡片首行才是纯标题；整卡 innerText 会混入价格/日期等 meta。
    const cardTitle = String(card.innerText || "").split("\n").map(clean).find(Boolean) || "";
    items.push({
      href,
      text,
      title: cardTitle || clean(anchor.innerText || anchor.textContent || "").split("\n")[0],
      listedAmount: parseCardAmount(text, ["当前价", "拍下价", "成交价", "起始价"]),
      listedStartPrice: parseCardAmount(text, ["起始价"]),
      listedValuation: parseCardAmount(text, ["评估价", "市场价"]),
      listedBidCount: Number(text.match(/(\d+)\s*次出价/i)?.[1] || 0),
      listedViewCount: Number(text.match(/(\d+)\s*次围观/i)?.[1] || 0),
      listedSignupCount: Number(text.match(/(\d+)\s*人报名/i)?.[1] || 0),
      listedEndDate: text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)?.slice(1).map((part) => String(Number(part))).join("-") || "",
      listedHasEndedText: /已结束/.test(text),
    });
  }
  const body = document.body?.innerText || "";
  const totalMatch = body.match(/共\s*([\d,]+)\s*(条|个|件)/);
  const verificationRequired = [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
    || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body);
  return {
    url: location.href,
    title: document.title,
    total: totalMatch ? totalMatch[1] : "",
    items,
    listContainerFound: Boolean(root),
    pageText: clean(body.slice(0, 1200)),
    verificationRequired,
  };
}

async function extractLeaseDetailPage() {
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
  const coordinatePair = (longitude, latitude, source) => {
    const lng = coordinate(longitude, 70, 140);
    const lat = coordinate(latitude, 3, 55);
    return lng !== null && lat !== null ? { longitude: lng, latitude: lat, coordinateSource: source } : null;
  };
  const coordinateFromText = (value, source) => {
    const text = String(value || "");
    const patterns = [
      /(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?["'\s,;，；\]}]{0,80}(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?["'\s,;，；\]}]{0,80}(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    ];
    for (const [index, pattern] of patterns.entries()) {
      const match = text.match(pattern);
      if (!match) continue;
      const pair = index === 1
        ? coordinatePair(match[2], match[1], source)
        : coordinatePair(match[1], match[2], source);
      if (pair) return pair;
    }
    return null;
  };
  let coordinates = null;
  for (const element of document.querySelectorAll("[data-lng], [data-lat], [longitude], [latitude]")) {
    coordinates = coordinatePair(
      element.getAttribute("data-lng") || element.getAttribute("longitude"),
      element.getAttribute("data-lat") || element.getAttribute("latitude"),
      "detail-dom",
    );
    if (coordinates) break;
  }
  if (!coordinates) {
    for (const script of document.scripts) {
      coordinates = coordinateFromText(script.textContent, "detail-script");
      if (coordinates) break;
    }
  }
  const body = document.body?.innerText || "";
  const scriptText = [...document.scripts].map((script) => script.textContent || "").join("\n");
  const detailText = `${body}\n${scriptText}`;
  const verificationRequired = [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
    || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body);

  const sectionBetween = (startLabel, endLabels) => {
    const start = body.indexOf(startLabel);
    if (start < 0) return "";
    const rest = body.slice(start + startLabel.length);
    let end = rest.length;
    for (const label of endLabels) {
      const index = rest.indexOf(label);
      if (index >= 0 && index < end) end = index;
    }
    return rest.slice(0, end);
  };
  const attributeBlock = sectionBetween("标的物属性", ["标的物详情描述", "标的物位置"]);
  const attributes = {};
  const lines = attributeBlock.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^([\u4e00-\u9fa5A-Za-z（）()]{2,12})[：:]\s*(.+)$/);
    if (inline) {
      attributes[inline[1]] = clean(inline[2]);
      continue;
    }
    const label = lines[index].match(/^([\u4e00-\u9fa5A-Za-z（）()]{2,12})[：:]?$/);
    if (label && lines[index + 1] && !lines[index + 1].includes("：")) {
      attributes[label[1]] = clean(lines[index + 1]);
      index += 1;
    }
  }
  const description = sectionBetween("标的物详情描述", ["标的物位置", "竞买公告"]);
  const descriptionLines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const descriptionField = (labels) => {
    const wanted = labels.map((item) => String(item));
    // 详情描述常见“1、租期：三年”式编号前缀，先按行首精确匹配，再退回全文检索。
    for (const line of descriptionLines) {
      const inline = line.match(new RegExp(`^(${wanted.join("|")})[（(][^）)]{0,24}[）)]?[：:]\\s*(.+)$`));
      if (inline) return clean(inline[2]);
      const plain = line.match(new RegExp(`^(${wanted.join("|")})[：:]\\s*(.+)$`));
      if (plain) return clean(plain[2]);
    }
    const joined = descriptionLines.join("\n");
    for (const label of wanted) {
      const loose = joined.match(new RegExp(`${label}(?:[（(][^）)]{0,24}[）)]?)?[：:]\\s*([^\\n]{1,120})`));
      if (loose) return clean(loose[1]);
    }
    return "";
  };
  const heading = document.querySelector("h1")?.innerText || "";
  const parseAmountText = (value) => {
    const match = String(value || "").replace(/,/g, "").match(/([\d.]+)\s*(万|亿|元)?/);
    if (!match) return "";
    const number = Number(match[1]);
    if (!Number.isFinite(number)) return "";
    const scale = match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1;
    return String(Math.round(number * scale * 100) / 100);
  };
  // 金额标签与数字之间只允许空白/货币符：中间夹“待说明”等占位文本时不得跨字段捕数
  // （实测“评估价 待说明 结束 2026年…”曾被误读为 0）。
  const pricePattern = (label) => new RegExp(`${label}\\s*[：:]?\\s*[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(万|亿|元)?(?!\\s*年)`);
  const soldPriceMatch = body.match(pricePattern("拍下价"));
  const currentPriceMatch = body.match(pricePattern("当前价"));
  const startPriceMatch = body.match(pricePattern("起始价"));
  const valuationMatch = body.match(pricePattern("(?:评估价|市场价)"));
  const depositMatch = body.match(pricePattern("保证金"));
  const endTimeMatch = body.match(/结束时间\s*[：:]?\s*([0-9]{4}[\/-][0-9]{1,2}[\/-][0-9]{1,2}(?:\s+[0-9:]{4,8})?)/);
  const bidCountMatch = body.match(/竞买记录\s*[（(]\s*(\d+)\s*[）)]/);
  const signupMatch = body.match(/(\d+)\s*人报名/);
  const viewMatch = body.match(/(\d+)\s*次围观/);
  const reminderMatch = body.match(/(\d+)\s*人设置提醒/);
  const hasEndedText = /本场已结束/.test(body);
  const failedNoBids = /竞价失败|无人出价/.test(body);
  const hasExplicitSoldPrice = Boolean(soldPriceMatch?.[1]);
  const bidCount = Number(bidCountMatch?.[1] || 0);
  const locationMatch = body.match(/标的物位置\s*\n?([\s\S]{0,160}?)(?:为您推荐|标的物介绍|竞买公告|相关附件|竞买须知)/);
  const orgMatch = body.match(/([\u4e00-\u9fa5（）()]{4,40}(?:交易中心|公共资源|人民政府|管理局|交易所))\s*\n?\s*联系方式/);
  const chineseNumberMap = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const parseTermYears = (text) => {
    const numeric = String(text || "").match(/(\d+)\s*年/);
    if (numeric) return Number(numeric[1]);
    const chinese = String(text || "").match(/([一二两三四五六七八九十])\s*年/);
    if (chinese) return chineseNumberMap[chinese[1]] || null;
    return null;
  };
  // 商业租赁描述常为表格样式：“租期”独立成行，值“1年”在隔几行后的单元格。
  const tableTermText = (() => {
    const labelIndex = descriptionLines.findIndex((line) => ["租期", "租赁期限", "租赁期"].includes(line));
    if (labelIndex < 0) return "";
    for (let offset = 1; offset <= 6 && labelIndex + offset < descriptionLines.length; offset += 1) {
      const line = descriptionLines[labelIndex + offset];
      const value = line.match(/^[\d一二两三四五六七八九十百]+\s*年$/);
      if (value) return value[0];
      // 遇到其它表头单元格（含括号/冒号的长文本）说明值不在后方，停止。
      if (/[（）()：:]/.test(line) && line.length > 6) break;
    }
    return "";
  })();
  const leaseTermYears = parseTermYears(descriptionField(["租期", "本次出租意向租期", "租赁期限", "租赁期", "出租期限"]))
    // 捕获组只含数字/中文数字，需把“年”一并传给 parseTermYears 才能识别单位。
    || parseTermYears(clean(heading).match(/[\d一二两三四五六七八九十]+\s*年(?:使用权|租赁权|租赁期)/)?.[0] || "")
    || parseTermYears(description.match(/[\d一二两三四五六七八九十]+\s*年(?:使用权|租赁权|租赁期)/)?.[0] || "")
    || parseTermYears(description.match(/(?:租期|租赁期限|租赁期)[：:]\s*第?\s*[一二两三四五六七八九十百\d]+\s*年/)?.[0] || "")
    || parseTermYears(tableTermText);
  const buildingAreaValue = parseAmountText(attributes["建筑面积"]);
  const transactionAmountText = hasExplicitSoldPrice
    ? parseAmountText(soldPriceMatch?.[0])
    : (hasEndedText && bidCount > 0 ? parseAmountText(currentPriceMatch?.[0]) : "");
  const startPriceValue = parseAmountText(startPriceMatch?.[0]);
  const valuationValue = parseAmountText(valuationMatch?.[0]);
  const depositValue = parseAmountText(depositMatch?.[0]);
  const areaNumber = Number(buildingAreaValue);
  const monthlyUnitPrice = Number.isFinite(areaNumber) && areaNumber > 0 && Number(transactionAmountText) > 0 && Number(leaseTermYears) > 0
    ? String(Math.round((Number(transactionAmountText) / (Number(leaseTermYears) * 12) / areaNumber) * 100) / 100)
    : "";
  return {
    url: location.href,
    title: clean(heading),
    transferMode: clean(attributes["流转方式"] || ""),
    propertyType: clean(attributes["物业类型"] || ""),
    houseUsage: clean(attributes["房屋用途"] || ""),
    community: clean(attributes["小区名称"] || ""),
    orientation: clean(attributes["朝向"] || ""),
    layout: clean(attributes["户型"] || ""),
    buildingArea: buildingAreaValue,
    floor: clean(attributes["所在楼层"] || ""),
    totalFloors: clean(attributes["总楼层"] || ""),
    decoration: clean(attributes["装修程度"] || ""),
    transactionAmount: transactionAmountText,
    startPrice: startPriceValue,
    valuationAmount: valuationValue,
    depositAmount: depositValue,
    monthlyUnitPrice,
    leaseTermYears: leaseTermYears ? String(leaseTermYears) : "",
    rentPaymentTerms: descriptionField(["租金支付方式", "支付方式"]) || clean(description.match(/租金(?:半年|[季年月])付[^。；\n]{0,24}/)?.[0] || ""),
    rentEscalation: descriptionField(["租金递增幅度", "租金递增"]) || clean(description.match(/租金无递增|租金[^。；\n]{0,10}递增[^。；\n]{0,12}/)?.[0] || ""),
    rentTermText: descriptionField(["租期", "本次出租意向租期", "租赁期限"]),
    hasSoldText: hasEndedText && (hasExplicitSoldPrice || bidCount > 0),
    hasExplicitSoldPrice,
    hasEndedText,
    failedNoBids,
    bidCount,
    signupCount: Number(signupMatch?.[1] || 0),
    viewCount: Number(viewMatch?.[1] || 0),
    reminderCount: Number(reminderMatch?.[1] || 0),
    endTime: clean(endTimeMatch?.[1] || ""),
    // 详情页位置段常带“地图标注仅供参考，具体位置以标的物实际为准”免责文案，剥离后再入库。
    location: clean((locationMatch?.[1] || "")
      .replace(/地图标注[^。；]{0,40}?为准[。.]?/g, "")
      .replace(/地图标注仅供参考/g, "")
      .replace(/[，,、；;\s]+$/g, "")),
    disposalOrg: clean(orgMatch?.[1] || ""),
    longitude: coordinates?.longitude ?? null,
    latitude: coordinates?.latitude ?? null,
    coordinateSource: coordinates?.coordinateSource || "",
    description: description.slice(0, 12000),
    pageText: body.slice(0, 12000),
    verificationRequired,
  };
}

// ===== 本地解析与校验 =====

function canonicalDetailUrl(value) {
  const parse = (raw) => {
    try {
      return new URL(String(raw || ""));
    } catch {
      // 阿里页面锚点常以 //host/path 形式出现，补齐协议后再解析。
      try {
        return new URL(`https:${String(raw || "")}`);
      } catch {
        return null;
      }
    }
  };
  const url = parse(value);
  if (!url) return "";
  if (!/^https:$/.test(url.protocol)) return "";
  const host = url.hostname.toLowerCase();
  if (host !== "zc-item.taobao.com" && host !== "item-paimai.taobao.com") return "";
  if (!/^\/auction\/\d+\.htm$/.test(url.pathname)) return "";
  return `${url.origin}${url.pathname}`;
}

function parseAmount(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function parseLeaseDetail(detail, request = {}) {
  const amount = parseAmount(detail.transactionAmount);
  const buildingArea = parseAmount(detail.buildingArea);
  const valid = Boolean(
    detail.hasEndedText === true
    && detail.failedNoBids !== true
    && (detail.hasExplicitSoldPrice === true || Number(detail.bidCount || 0) > 0)
    && Number.isFinite(amount) && amount > 0,
  );
  const areaNumber = Number.isFinite(buildingArea) ? buildingArea : null;
  const termNumber = Number(detail.leaseTermYears || "");
  const explicitUnitPrice = parseAmount(detail.monthlyUnitPrice);
  // 详情页未直接给出月租金单价时，用成交价（首年租金）/租期月数/面积补算；
  // 任一要素缺失就留空，不做猜测。
  const monthlyUnitPrice = Number.isFinite(explicitUnitPrice) && explicitUnitPrice > 0
    ? explicitUnitPrice
    : (areaNumber && areaNumber > 0 && Number.isFinite(amount) && amount > 0 && Number.isFinite(termNumber) && termNumber > 0
      ? Math.round((amount / (termNumber * 12) / areaNumber) * 100) / 100
      : "");
  return {
    title: String(detail.title || "").trim(),
    province: String(request.province || ""),
    city: String(request.city || ""),
    district: String(request.district || ""),
    community: String(detail.community || ""),
    location: String(detail.location || "")
      .replace(/地图标注[^。；]{0,40}?为准[。.]?/g, "")
      .replace(/地图标注仅供参考/g, "")
      .replace(/[，,、；;\s]+$/g, "")
      .trim(),
    transferMode: String(detail.transferMode || ""),
    propertyType: String(detail.propertyType || ""),
    houseUsage: String(detail.houseUsage || ""),
    buildingArea: Number.isFinite(buildingArea) ? buildingArea : "",
    transactionAmount: Number.isFinite(amount) ? amount : "",
    startPrice: parseAmount(detail.startPrice) ?? "",
    valuationAmount: parseAmount(detail.valuationAmount) ?? "",
    monthlyUnitPrice: monthlyUnitPrice === "" ? "" : monthlyUnitPrice,
    leaseTermYears: String(detail.leaseTermYears || ""),
    rentPaymentTerms: String(detail.rentPaymentTerms || ""),
    rentEscalation: String(detail.rentEscalation || ""),
    depositAmount: parseAmount(detail.depositAmount) ?? "",
    orientation: String(detail.orientation || ""),
    layout: String(detail.layout || ""),
    floor: String(detail.floor || ""),
    totalFloors: String(detail.totalFloors || ""),
    decoration: String(detail.decoration || ""),
    bidCount: Number(detail.bidCount || 0),
    signupCount: Number(detail.signupCount || 0),
    viewCount: Number(detail.viewCount || 0),
    endTime: normalizeDate(detail.endTime),
    resultStatus: valid ? "成交" : (detail.failedNoBids ? "流拍" : "未成交"),
    longitude: Number.isFinite(Number(detail.longitude)) && detail.longitude !== null ? Number(detail.longitude) : null,
    latitude: Number.isFinite(Number(detail.latitude)) && detail.latitude !== null ? Number(detail.latitude) : null,
    coordinateStatus: detail.longitude != null && detail.latitude != null
      ? `已定位（${detail.coordinateSource === "detail-dom" ? "页面坐标" : "详情页坐标"}）`
      : "未定位",
    platform: "阿里资产",
    verificationStatus: valid ? "已核验" : "未通过",
    url: canonicalDetailUrl(detail.url),
    valid,
  };
}

function mergeListingEvidence(detail = {}, candidate = {}) {
  return {
    ...detail,
    listedEndDate: candidate.listedEndDate || "",
    listedHasEndedText: candidate.listedHasEndedText === true,
    listedHasExplicitSoldPrice: candidate.listedHasExplicitSoldPrice === true,
  };
}

function matchesRequest(record, request = {}) {
  const endDate = normalizeDate(record.endTime);
  if (request.startDate && endDate && endDate < request.startDate) return false;
  if (request.endDate && endDate && endDate > request.endDate) return false;
  if (request.keyword) {
    const haystack = `${record.title || ""} ${record.community || ""}`;
    if (!haystack.includes(String(request.keyword).trim())) return false;
  }
  return true;
}

function skipReason(detail, record, request = {}) {
  if (detail.failedNoBids) return "本场竞价失败（无人出价），属流拍记录。";
  if (!detail.hasEndedText) return "标的尚未结束，暂不满足成交判据。";
  if (!(detail.hasExplicitSoldPrice === true || Number(detail.bidCount || 0) > 0)) return "已结束但无拍下价且出价次数为 0。";
  if (!Number.isFinite(parseAmount(record.transactionAmount)) || Number(record.transactionAmount) <= 0) return "未读到有效成交金额。";
  const endDate = normalizeDate(record.endTime);
  if (request.startDate && endDate && endDate < request.startDate) return `结束时间 ${endDate} 早于所选起始日。`;
  if (request.endDate && endDate && endDate > request.endDate) return `结束时间 ${endDate} 晚于所选截止日。`;
  if (request.keyword && !`${record.title || ""} ${record.community || ""}`.includes(String(request.keyword).trim())) return "标题/小区不含所选关键词。";
  return "未通过成交核验。";
}

function pageLooksBlocked(value) {
  const text = `${value?.pageText || ""} ${value?.url || ""}`;
  if (/login\.taobao\.com|\/login(?:[/?]|$)/i.test(String(value?.url || ""))) return "ALIBABA_LEASE_LOGIN_REQUIRED";
  if (/(?:^|[./_-])(captcha|verify|validate|punish|security|error)(?:[./?_-]|$)|验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证|拖动.{0,8}(?:滑块|拼图)/i.test(text)) {
    return "ALIBABA_LEASE_VERIFICATION_REQUIRED";
  }
  return "";
}

function pageWaitState(value, expectedUrl, pageKind = "detail") {
  if (pageLooksBlocked(value)) return "verification";
  if (pageKind === "list") {
    const hasItems = Array.isArray(value?.items) && value.items.length > 0;
    // 空结果也是合法就绪态：容器已渲染且没有加载占位文本时不再等待。
    const containerSettled = value?.listContainerFound === true && !/(?:加载中|loading)/i.test(value?.pageText || "");
    return hasItems || containerSettled ? "ready" : "list_loading";
  }
  const hasPrice = /拍下价|当前价|起始价/.test(value?.pageText || "");
  return value?.title && hasPrice ? "ready" : "detail_loading";
}

function verificationWaitMessage(state, pageKind, description, elapsedSeconds) {
  const kind = pageKind === "list" ? "列表" : "详情";
  if (state === "verification") return `检测到阿里验证页，请在当前浏览器标签页完成验证，正在等待（已等待 ${elapsedSeconds} 秒）…`;
  if (state === "navigation") return `${kind}页面被切换，正在恢复目标页面（已等待 ${elapsedSeconds} 秒）…`;
  if (state === "login") return "检测到登录页，请在当前浏览器标签页完成淘宝登录…";
  return `正在等待${kind}加载完成（${description}，已等待 ${elapsedSeconds} 秒）…`;
}

function isLeaseVerificationUrl(value) {
  return /(?:^|[./_-])(captcha|verify|validate|punish|security|error)(?:[./?_-]|$)/i.test(String(value || ""))
    || /login\.taobao/i.test(String(value || ""));
}

function isLeaseListPage(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.toLowerCase() === "zc-paimai.taobao.com" && url.pathname === LEASE_SEARCH_PATH;
  } catch {
    return false;
  }
}

function isLeaseDetailPage(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return (host === "zc-item.taobao.com" || host === "item-paimai.taobao.com") && /^\/auction\/\d+\.htm$/.test(url.pathname);
  } catch {
    return false;
  }
}

function listPageMatchesRequest(value, request = {}) {
  if (!isLeaseListPage(value)) return false;
  try {
    const url = new URL(String(value));
    const expected = locationScopeCode(request);
    if (!expected) return true;
    const raw = url.searchParams.get("locationCodes") || "[]";
    const codes = JSON.parse(raw);
    return Array.isArray(codes) && codes.map(String).includes(expected);
  } catch {
    return false;
  }
}

function listPageUrl(sourceUrl, page) {
  try {
    const url = new URL(String(sourceUrl));
    url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
    return url.href;
  } catch {
    return buildSourceUrl(normalizeConfig({}), page);
  }
}

// 列表页日期早于起始日时停止翻页，避免向更旧的页面继续发请求。
function pageBeforeRequestedRange(items, request = {}) {
  if (!request.startDate) return false;
  const dates = (Array.isArray(items) ? items : [])
    .map((item) => normalizeDate(item.listedEndDate))
    .filter(Boolean);
  return dates.length > 0 && dates.every((date) => date < request.startDate);
}

function candidateInScope(item, request = {}) {
  // 列表筛选已被 URL 参数保证，这里仅拦截非租赁条目（h_t_mode 被页面丢弃时的兜底）。
  // 商业租赁标题常不带“使用权”字样（如“XX大厦1号 27.75万元/年”），需按租金计价特征识别。
  const text = `${item.title || ""} ${item.text || ""}`;
  return /使用权|租赁|出租|租金|[\d.元]\s*\/\s*年|[\d.元]\s*\/\s*月|万元\/年|元\/年|元\/月/.test(text);
}

function resultGenerationProgress(results, request = {}, counts = {}) {
  const located = (Array.isArray(results) ? results : []).filter((item) => item.longitude != null && item.latitude != null).length;
  return {
    phase: "generating_results",
    percent: 99,
    message: located
      ? `正在生成本地结果页${request.generateMap === false ? "" : "与地图"}；${located} 条记录使用详情页明确坐标，未定位记录不猜测位置。`
      : "正在生成本地结果页；详情页未返回坐标，已跳过地图生成。",
    fetched: Number(counts.fetched || 0),
    verified: Number(counts.verified || 0),
    skipped: Number(counts.skipped || 0),
  };
}

// ===== 当前标签页驱动 =====

function waitForCurrentTab(chromeRef, tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      chromeRef.tabs.onUpdated.removeListener(onUpdated);
      window.setTimeout(resolve, 900);
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chromeRef.tabs.onUpdated.addListener(onUpdated);
  });
}

async function navigateCurrentTab(chromeRef, tab, url) {
  if (!tab?.id) throw new Error("ALIBABA_LEASE_CURRENT_TAB_UNAVAILABLE");
  if (tab.url === url) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return await chromeRef.tabs.get(tab.id);
  }
  const loaded = waitForCurrentTab(chromeRef, tab.id);
  await chromeRef.tabs.update(tab.id, { active: true, url });
  await loaded;
  return await chromeRef.tabs.get(tab.id);
}

async function executeCurrentTab(chromeRef, tabId, func, args = []) {
  let output;
  try {
    output = await chromeRef.scripting.executeScript({ target: { tabId }, func, args });
  } catch (error) {
    if (error?.code === "ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED") throw error;
    const failure = new Error(`ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED: ${String(error?.message || error).slice(0, 240)}`);
    failure.code = "ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  if (!Array.isArray(output) || !output.length || output[0]?.result === undefined || output[0]?.result === null) {
    const failure = new Error("ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED: executeScript 未返回页面结果。");
    failure.code = "ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  return output[0].result;
}

async function getCurrentBrowserTab(chromeRef) {
  const [tab] = await chromeRef.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function urlsReferToSamePage(actual, expected) {
  const normalize = (value) => {
    try {
      const url = new URL(String(value || ""));
      url.searchParams.forEach((_, key) => {
        if (/^(spm|scm|pmtk|pmid|track_id|p_|ali_refid|ali_trackid)$/i.test(key)) url.searchParams.delete(key);
      });
      if (url.pathname === LEASE_SEARCH_PATH) return `${url.origin}${url.pathname}`;
      return `${url.origin}${url.pathname}`;
    } catch {
      return String(value || "");
    }
  };
  return normalize(actual) === normalize(expected);
}

function pageReady(value, expectedUrl, pageKind = "detail") {
  if (!value || typeof value !== "object") return false;
  if (!urlsReferToSamePage(value.url, expectedUrl)) return false;
  if (pageLooksBlocked(value)) return false;
  return pageWaitState(value, expectedUrl, pageKind) === "ready";
}

async function resolveVerificationTab(chromeRef, tab, expectedUrl) {
  if (!tab?.id) return null;
  try {
    const current = await chromeRef.tabs.get(tab.id);
    if (current && (urlsReferToSamePage(current.url, expectedUrl) || isLeaseVerificationUrl(current.url))) return current;
    return current || null;
  } catch {
    return null;
  }
}

async function restoreTargetTab(chromeRef, tab, expectedUrl) {
  if (!tab?.id || !expectedUrl || urlsReferToSamePage(tab.url, expectedUrl)) return tab;
  try {
    await chromeRef.tabs.update(tab.id, { active: true, url: expectedUrl });
    return await chromeRef.tabs.get(tab.id);
  } catch {
    const failure = new Error("ALIBABA_LEASE_TAB_REPLACED");
    failure.code = "ALIBABA_LEASE_TAB_REPLACED";
    throw failure;
  }
}

async function waitForManualVerification(context, tab, extractor, emit, description, control, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : MANUAL_VERIFICATION_TIMEOUT_MS;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(1, options.pollIntervalMs) : 1200;
  const expectedUrl = String(options.expectedUrl || tab?.url || "");
  const pageKind = options.pageKind || "detail";
  let currentTab = tab;
  let waitState = isLeaseVerificationUrl(currentTab?.url) ? "verification" : "page_loading";
  while (Date.now() - startedAt < timeoutMs) {
    await waitForRunResume(control, emit);
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    emit({
      phase: waitState === "verification" ? "verification_required" : waitState === "detail_loading" ? "loading_detail" : "opening",
      percent: 35,
      message: verificationWaitMessage(waitState, pageKind, description, elapsedSeconds),
    });
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    currentTab = await resolveVerificationTab(context.chrome, currentTab, expectedUrl);
    if (!currentTab?.id) {
      const failure = new Error("ALIBABA_LEASE_TAB_REPLACED");
      failure.code = "ALIBABA_LEASE_TAB_REPLACED";
      throw failure;
    }
    if (/login\.taobao\.com|\/login(?:[/?]|$)/i.test(String(currentTab?.url || ""))) {
      const failure = new Error("请在当前浏览器标签页完成淘宝登录，完成后点击重试。");
      failure.code = "ALIBABA_LEASE_LOGIN_REQUIRED";
      throw failure;
    }
    const current = await executeCurrentTab(context.chrome, currentTab.id, extractor);
    const blocked = pageLooksBlocked(current);
    if (blocked === "ALIBABA_LEASE_VERIFICATION_REQUIRED") {
      waitState = "verification";
      continue;
    }
    if (blocked === "ALIBABA_LEASE_LOGIN_REQUIRED") {
      const failure = new Error("请在当前浏览器标签页完成淘宝登录，完成后点击重试。");
      failure.code = blocked;
      throw failure;
    }
    if (expectedUrl && !urlsReferToSamePage(current.url, expectedUrl)) {
      waitState = "navigation";
      currentTab = await restoreTargetTab(context.chrome, currentTab, expectedUrl);
      continue;
    }
    if (pageReady(current, expectedUrl, pageKind)) return { value: current, tab: currentTab };
    waitState = pageWaitState(current, expectedUrl, pageKind);
  }
  const timeout = new Error("ALIBABA_LEASE_VERIFICATION_TIMEOUT");
  timeout.code = "ALIBABA_LEASE_VERIFICATION_TIMEOUT";
  throw timeout;
}

async function readPageWithManualVerification(context, tab, extractor, emit, description, control, options = {}) {
  const expectedUrl = String(options.expectedUrl || tab?.url || "");
  const pageKind = options.pageKind || "detail";
  const currentTab = await resolveVerificationTab(context.chrome, tab, expectedUrl);
  if (!currentTab?.id) {
    const failure = new Error("ALIBABA_LEASE_TAB_REPLACED");
    failure.code = "ALIBABA_LEASE_TAB_REPLACED";
    throw failure;
  }
  if (/login\.taobao\.com|\/login(?:[/?]|$)/i.test(String(currentTab?.url || ""))) {
    const failure = new Error("请在当前浏览器标签页完成淘宝登录，完成后点击重试。");
    failure.code = "ALIBABA_LEASE_LOGIN_REQUIRED";
    throw failure;
  }
  if (isLeaseVerificationUrl(currentTab?.url)) {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  let value;
  try {
    value = await executeCurrentTab(context.chrome, currentTab.id, extractor);
  } catch (error) {
    const latestTab = await resolveVerificationTab(context.chrome, currentTab, expectedUrl);
    if (latestTab && isLeaseVerificationUrl(latestTab.url)) {
      return waitForManualVerification(context, latestTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
    }
    throw error;
  }
  const blocked = pageLooksBlocked(value);
  if (blocked === "ALIBABA_LEASE_LOGIN_REQUIRED") {
    const failure = new Error("请在当前浏览器标签页完成淘宝登录，完成后点击重试。");
    failure.code = blocked;
    throw failure;
  }
  if (blocked === "ALIBABA_LEASE_VERIFICATION_REQUIRED") {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  if (!pageReady(value, expectedUrl, pageKind)) {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  return { value, tab: currentTab };
}

async function runCurrentTabScrape(context, request, emit = () => {}, control = null) {
  const chromeRef = context.chrome;
  let tab = await getCurrentBrowserTab(chromeRef);
  const maxPages = Math.max(1, Math.min(MAX_PAGES_LIMIT, Number(request.maxPages || 1)));
  const currentListMatchesRequest = listPageMatchesRequest(tab.url, request);
  let sourceUrl = currentListMatchesRequest ? tab.url : buildSourceUrl(request, 1);
  let firstPage = 1;
  try {
    const currentPage = Number(new URL(sourceUrl).searchParams.get("page"));
    if (Number.isInteger(currentPage) && currentPage > 0) firstPage = currentPage;
  } catch {
    // sourceUrl 由本模块构建， navigation 路径会验证它。
  }
  const candidates = [];
  const seen = new Set();
  let prefiltered = 0;
  const progress = (payload) => emit({ security: { credentialsReturned: false }, ...payload });
  progress({ phase: "opening", percent: 2, message: isLeaseListPage(tab.url) ? "正在读取当前阿里资产租赁筛选结果…" : "正在当前浏览器打开阿里资产租赁列表页…", fetched: 0, verified: 0, skipped: 0 });

  for (let page = firstPage; page < firstPage + maxPages; page += 1) {
    try {
      await waitForRunResume(control, progress);
      const expectedListUrl = listPageUrl(sourceUrl, page);
      if (page !== firstPage || !listPageMatchesRequest(tab.url, request) || !urlsReferToSamePage(tab.url, expectedListUrl)) {
        tab = await navigateCurrentTab(chromeRef, tab, expectedListUrl);
      }
      const listRead = await readPageWithManualVerification(context, tab, extractLeaseListPage, progress, "读取租赁列表", control, { expectedUrl: expectedListUrl, pageKind: "list" });
      tab = listRead.tab;
      const extracted = listRead.value;
      const blocked = pageLooksBlocked(extracted);
      if (blocked) throw new Error(blocked);
      const pageItems = Array.isArray(extracted.items) ? extracted.items : [];
      let newItems = 0;
      for (const item of pageItems) {
        const url = canonicalDetailUrl(item.href);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        newItems += 1;
        if (!candidateInScope(item, request)) {
          prefiltered += 1;
          continue;
        }
        candidates.push({
          url,
          title: String(item.title || "").trim(),
          listedAmount: String(item.listedAmount || ""),
          listedEndDate: String(item.listedEndDate || ""),
          listedHasEndedText: item.listedHasEndedText === true,
        });
      }
      progress({
        phase: "listing",
        percent: Math.min(35, 5 + Math.round(((page - firstPage + 1) / maxPages) * 30)),
        message: `已读取第 ${page} 页，共发现 ${candidates.length} 条租赁候选记录，准备详情核验…`,
        page,
        pages: maxPages,
        fetched: candidates.length,
        verified: 0,
        skipped: prefiltered,
      });
      if (pageBeforeRequestedRange(pageItems, request)) {
        progress({
          phase: "listing",
          percent: Math.min(35, 5 + Math.round(((page - firstPage + 1) / maxPages) * 30)),
          message: `第 ${page} 页结束日期已早于所选起始日，停止继续翻页。`,
          page,
          pages: maxPages,
          fetched: candidates.length,
          verified: 0,
          skipped: prefiltered,
        });
        break;
      }
      if (!pageItems.length || newItems === 0) break;
    } catch (error) {
      const reason = String(error?.message || error);
      const errorCode = String(error?.code || (reason === "ALIBABA_LEASE_SCRAPE_STOPPED" ? reason : "ALIBABA_LEASE_SCRAPE_FAILED"));
      return { ok: false, phase: reason === "ALIBABA_LEASE_SCRAPE_STOPPED" ? "stopped" : "failed", errorCode, reason, stopped: reason === "ALIBABA_LEASE_SCRAPE_STOPPED", candidates: candidates.length, results: [], security: { credentialsReturned: false } };
    }
  }

  if (!candidates.length) {
    return {
      ok: false,
      phase: "failed",
      errorCode: "ALIBABA_LEASE_LIST_EMPTY",
      reason: prefiltered
        ? "当前列表记录均不属于租赁/使用权条目，请确认页面筛选包含“h_t_mode”参数。"
        : "当前浏览器页面未读取到阿里资产租赁候选记录。请确认已登录且没有出现验证页。",
      candidates: 0,
      results: [],
      skipped: prefiltered,
      security: { credentialsReturned: false },
    };
  }

  const results = [];
  const skippedReasons = [];
  let skipped = prefiltered;
  for (const [index, candidate] of candidates.entries()) {
    try {
      await waitForRunResume(control, progress);
      if (control) control.percent = Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63));
      tab = await navigateCurrentTab(chromeRef, tab, candidate.url);
      const detailRead = await readPageWithManualVerification(context, tab, extractLeaseDetailPage, progress, "核验租赁详情", control, { expectedUrl: candidate.url, pageKind: "detail" });
      tab = detailRead.tab;
      const detail = detailRead.value;
      const blocked = pageLooksBlocked(detail);
      if (blocked) throw new Error(blocked);
      const detailWithListingEvidence = mergeListingEvidence(detail, candidate);
      const parsed = parseLeaseDetail(detailWithListingEvidence, request);
      const accepted = parsed.valid && matchesRequest(parsed, request);
      if (accepted) results.push(parsed);
      else {
        skipped += 1;
        skippedReasons.push({
          title: parsed.title || candidate.title,
          url: candidate.url,
          reason: skipReason(detailWithListingEvidence, parsed, request),
        });
      }
      progress({
        phase: "verifying",
        percent: Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63)),
        message: accepted ? `已核验租赁成交案例 ${results.length} 条。` : `已跳过记录 ${skipped} 条：${skippedReasons.at(-1)?.reason || "未通过核验"}。`,
        fetched: candidates.length,
        verified: results.length,
        skipped,
        current: parsed.title || candidate.title,
      });
    } catch (error) {
      const reason = String(error?.message || error);
      const errorCode = String(error?.code || reason);
      if (errorCode === "ALIBABA_LEASE_SCRAPE_STOPPED") {
        return { ok: false, phase: "stopped", errorCode, reason, stopped: true, candidates: candidates.length, results, skipped, security: { credentialsReturned: false } };
      }
      if (["ALIBABA_LEASE_LOGIN_REQUIRED", "ALIBABA_LEASE_VERIFICATION_REQUIRED", "ALIBABA_LEASE_VERIFICATION_TIMEOUT", "ALIBABA_LEASE_TAB_REPLACED", "ALIBABA_LEASE_SCRIPT_EXECUTION_FAILED"].includes(errorCode)) {
        const message = errorCode === "ALIBABA_LEASE_LOGIN_REQUIRED"
          ? "请在当前浏览器标签页完成淘宝登录，完成后点击重试。"
          : errorCode === "ALIBABA_LEASE_VERIFICATION_REQUIRED" || errorCode === "ALIBABA_LEASE_VERIFICATION_TIMEOUT"
            ? "请在当前浏览器标签页完成阿里验证，完成后点击重试。"
            : reason;
        return { ok: false, phase: "failed", errorCode, reason: message, candidates: candidates.length, results, skipped, security: { credentialsReturned: false } };
      }
      skipped += 1;
      progress({ phase: "verifying", percent: Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63)), message: `详情读取失败，已跳过 ${skipped} 条。`, fetched: candidates.length, verified: results.length, skipped, current: candidate.title });
    }
  }

  if (control) control.percent = 99;
  progress(resultGenerationProgress(results, request, {
    fetched: candidates.length,
    verified: results.length,
    skipped,
  }));
  const saved = await context.sendNativeMessage({
    action: "write_alibaba_lease_result",
    request,
    results,
    candidates: candidates.length,
    skipped,
  }, 180000);
  const finalizedAfterStop = Boolean(control?.stopped);
  return {
    ok: !finalizedAfterStop && results.length > 0 && saved?.ok !== false,
    phase: finalizedAfterStop ? "stopped" : "completed",
    stopped: finalizedAfterStop,
    finalized: finalizedAfterStop,
    errorCode: results.length ? "" : "ALIBABA_LEASE_NO_VALID_CASES",
    reason: finalizedAfterStop
      ? "本地结果写入完成，抓取已终止。"
      : results.length
        ? "阿里资产租赁成交案例已完成详情核验。"
        : noValidCasesReason(skippedReasons, candidates.length),
    candidates: candidates.length,
    results: Array.isArray(saved?.results) ? saved.results : results,
    htmlPath: String(saved?.htmlPath || ""),
    mapPath: String(saved?.mapPath || ""),
    historyPath: String(saved?.historyPath || ""),
    skipped,
    skippedReasons: skippedReasons.slice(-20),
    security: { credentialsReturned: false },
  };
}


// 页面没有服务端日期筛选（实测），默认按时间倒序；日期控制靠本地过滤+到页即停。
// 当所有候选都因日期被跳过时，给出带候选日期区间与调整建议的明确原因，
// 而不是看起来像程序失败的通用报错。
function noValidCasesReason(skippedReasons = [], candidates = 0) {
  const reasons = Array.isArray(skippedReasons) ? skippedReasons : [];
  const dates = reasons
    .map((item) => (String(item?.reason || "").match(/结束时间 (\d{4}-\d{2}-\d{2})/) || [])[1])
    .filter(Boolean);
  const allDateOutOfRange = reasons.length > 0
    && reasons.every((item) => /早于所选起始日|晚于所选截止日/.test(String(item?.reason || "")));
  if (allDateOutOfRange) {
    const earliest = dates.slice().sort()[0] || "";
    const latest = dates.slice().sort().at(-1) || "";
    const rangeText = earliest && latest && earliest !== latest ? `${earliest} 至 ${latest}` : earliest || latest || "未知";
    return `候选 ${candidates} 条记录的结束时间（${rangeText}）均不在所选日期范围内。页面按时间倒序展示且无服务端日期筛选，通常说明所选区域在该时间段没有租赁成交案例：请扩大日期范围、更换区域，或改选“全部状态”。已撤并的区（如杭州江干区，2021 年并入上城区）名下只有并区前的旧记录。`;
  }
  if (reasons.length) {
    return `候选记录中没有找到详情页可确认的租赁成交案例。首条跳过原因：${reasons[0].reason}。`;
  }
  return "候选记录中没有找到详情页可确认的租赁成交案例。";
}

// ===== 模块生命周期 =====

export const alibabaLeaseModule = {
  manifest: {
    id: "alibaba-lease",
    type: "feature",
    stage: "stable",
    route: "alibaba-lease",
    displayName: "阿里资产租赁",
    messageNamespace: "alibaba-lease",
    entryElementId: "openAlibabaLease",
    pageElementId: "page-alibaba-lease",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let config = { ...DEFAULT_CONFIG };
    let appliedConfig = null;
    let results = [];
    let htmlPath = "";
    let excelPath = "";
    let mapPath = "";
    let running = false;
    let opening = false;
    let exporting = false;
    let runControl = null;
    let progressState = { phase: "idle", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "等待开始" };

    function storageState() {
      return {
        ...config,
        parameterSnapshot: appliedConfig ? { ...appliedConfig } : null,
        results,
        htmlPath,
        excelPath,
        mapPath,
      };
    }

    function parametersApplied() {
      return Boolean(appliedConfig) && parameterSnapshotMatches(config, appliedConfig);
    }

    function renderParameterState() {
      const state = elements?.alibabaLeaseParameterState;
      if (!state) return;
      const applied = parametersApplied();
      state.textContent = applied ? "参数已应用" : "参数有改动，需重新应用";
      state.dataset.kind = applied ? "ok" : "warn";
    }

    function readConfig() {
      return normalizeConfig({
        provinceCode: elements.alibabaLeaseProvince.value,
        cityCode: elements.alibabaLeaseCity.value,
        districtCode: elements.alibabaLeaseDistrict.value,
        propertyType: elements.alibabaLeasePropertyType.value,
        status: elements.alibabaLeaseStatus.value,
        keyword: elements.alibabaLeaseKeyword.value,
        startDate: elements.alibabaLeaseStartDate.value,
        endDate: elements.alibabaLeaseEndDate.value,
        maxPages: elements.alibabaLeaseMaxPages.value,
        outputDirectory: elements.alibabaLeaseOutputDirectory.value,
        generateMap: elements.alibabaLeaseGenerateMap.checked,
      });
    }

    function renderConfig() {
      renderRegionOptions();
      elements.alibabaLeasePropertyType.value = config.propertyType;
      elements.alibabaLeaseStatus.value = config.status;
      elements.alibabaLeaseKeyword.value = config.keyword;
      elements.alibabaLeaseStartDate.value = config.startDate;
      elements.alibabaLeaseEndDate.value = config.endDate;
      elements.alibabaLeaseMaxPages.value = String(config.maxPages);
      elements.alibabaLeaseOutputDirectory.value = config.outputDirectory;
      elements.alibabaLeaseGenerateMap.checked = Boolean(config.generateMap);
      elements.alibabaLeaseSourceUrl.value = buildSourceUrl(config);
      renderParameterState();
    }

    function renderRegionOptions() {
      const province = elements.alibabaLeaseProvince;
      const city = elements.alibabaLeaseCity;
      const district = elements.alibabaLeaseDistrict;
      province.innerHTML = ALIBABA_REGION_CATALOG
        .map((item) => `<option value="${item.code}">${item.name}</option>`)
        .join("");
      province.value = config.provinceCode;
      const provinceRegion = ALIBABA_REGION_CATALOG.find((item) => item.code === config.provinceCode);
      const cities = provinceRegion?.children || [];
      city.innerHTML = `<option value="">全省</option>${cities.map((item) => `<option value="${item.code}">${item.name}</option>`).join("")}`;
      city.value = config.cityCode;
      const cityRegion = cities.find((item) => item.code === config.cityCode);
      const districts = usableDistricts(cityRegion);
      district.innerHTML = `<option value="">${cityRegion ? "不限定区县" : "请先选择城市"}</option>${districts.map((item) => `<option value="${item.code}">${item.name}</option>`).join("")}`;
      district.disabled = !cityRegion || !districts.length;
      district.value = config.districtCode;
    }

    function syncConfigFromInputs() {
      config = readConfig();
      renderConfig();
      if (!parametersApplied()) setMessage(elements.alibabaLeaseParameterMessage, "参数有改动，需重新应用。", "warn");
    }

    function markConfigDirtyFromInputs() {
      config = readConfig();
      renderParameterState();
      if (!parametersApplied()) setMessage(elements.alibabaLeaseParameterMessage, "参数有改动，需重新应用。", "warn");
    }

    function renderResults() {
      elements.alibabaLeaseResultCount.textContent = `${results.length} 条`;
      elements.clearAlibabaLeaseResults.disabled = !results.length;
      elements.openAlibabaLeaseResult.disabled = !htmlPath;
      elements.exportAlibabaLeaseExcel.disabled = !results.length || running || exporting;
      elements.openAlibabaLeaseExcel.disabled = !excelPath;
      elements.openAlibabaLeaseMap.disabled = !mapPath;
      if (!running) {
        elements.alibabaLeaseResultStatus.textContent = htmlPath && excelPath
          ? "结果页和 Excel 已生成，可在普通应用中打开。"
          : htmlPath
            ? "结果页已生成，可在普通浏览器中打开；需要表格时点击“导出 Excel”。"
            : "尚未读取结果";
      }
    }

    function renderProgress(payload = {}) {
      progressState = { ...progressState, ...payload };
      const percent = Math.max(0, Math.min(100, Number(progressState.percent || 0)));
      const phaseLabels = {
        idle: "等待开始",
        opening: "正在打开页面",
        listing: "正在读取列表",
        verifying: "正在核验详情",
        generating_results: "正在生成结果页",
        loading_detail: "正在等待详情加载",
        verification_required: "等待人工验证",
        paused: "已暂停",
        stopped: "已终止",
        completed: "抓取完成",
        failed: "抓取失败",
      };
      elements.alibabaLeaseProgressPhase.textContent = phaseLabels[progressState.phase] || "正在处理";
      elements.alibabaLeaseProgressPercent.textContent = `${percent}%`;
      elements.alibabaLeaseProgressBar.style.width = `${percent}%`;
      elements.alibabaLeaseProgressBar.parentElement.setAttribute("aria-valuenow", String(percent));
      elements.alibabaLeaseProgressFetched.textContent = String(progressState.fetched ?? 0);
      elements.alibabaLeaseProgressVerified.textContent = String(progressState.verified ?? 0);
      elements.alibabaLeaseProgressSkipped.textContent = String(progressState.skipped ?? 0);
      if (progressState.message) elements.alibabaLeaseResultStatus.textContent = progressState.message;
      if (running && progressState.fetched !== undefined) {
        elements.alibabaLeaseResultCount.textContent = `${progressState.fetched} 条页面记录`;
      }
    }

    function localPathToFileUrl(value) {
      const normalized = String(value || "").trim().replace(/\\/g, "/");
      if (!normalized) return "";
      if (/^file:\/\//i.test(normalized)) return normalized;
      const encoded = normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/");
      return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
    }

    async function openArtifactInCurrentBrowserTab(targetPath, label) {
      const result = await context.sendNativeMessage({
        action: "open_alibaba_lease_path",
        path: targetPath,
        outputDirectory: config.outputDirectory,
        openInCurrentBrowserTab: true,
      }, 15000);
      if (!result?.ok || !result.path) throw new Error(result?.reason || `${label}打开失败`);
      const url = localPathToFileUrl(result.path);
      if (!url) throw new Error(`${label}路径无效`);
      await context.chrome.tabs.create({ url, active: true });
    }

    async function openResultPage() {
      if (!htmlPath) return;
      try {
        await openArtifactInCurrentBrowserTab(htmlPath, "结果页");
        setMessage(elements.alibabaLeaseResultMessage, "已在当前浏览器新标签页打开结果页。", "ok");
        context.setStatus("阿里资产租赁结果页已在当前浏览器打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaLeaseResultMessage, `结果页打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁结果页打开失败", "error");
      }
    }

    async function openExcel() {
      if (!excelPath) return;
      try {
        const result = await context.sendNativeMessage({ action: "open_alibaba_lease_path", path: excelPath, outputDirectory: config.outputDirectory }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "打开 Excel 失败");
        setMessage(elements.alibabaLeaseResultMessage, "已打开本机 Excel 导出文件。", "ok");
        context.setStatus("阿里资产租赁 Excel 已打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaLeaseResultMessage, `Excel 打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁 Excel 打开失败", "error");
      }
    }

    async function openMap() {
      if (!mapPath) return;
      try {
        await openArtifactInCurrentBrowserTab(mapPath, "地图");
        setMessage(elements.alibabaLeaseResultMessage, "已在当前浏览器新标签页打开地图。", "ok");
        context.setStatus("阿里资产租赁地图已在当前浏览器打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaLeaseResultMessage, `地图打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁地图打开失败", "error");
      }
    }

    async function exportExcel() {
      if (exporting || running || !results.length) return;
      const requestConfig = requireAppliedParameters();
      if (!requestConfig) return;
      exporting = true;
      renderResults();
      setMessage(elements.alibabaLeaseResultMessage, "正在生成 Excel，并回读校验文件内容…", "warn");
      context.setStatus("正在导出阿里资产租赁 Excel", "busy");
      try {
        const result = await context.sendNativeMessage({
          action: "write_alibaba_lease_excel",
          request: { ...requestConfig, sourceUrl: buildSourceUrl(requestConfig) },
          results,
          candidates: results.length,
        }, 180000);
        if (!result?.ok || !result.excelPath) throw new Error(result?.reason || "ALIBABA_LEASE_EXCEL_EXPORT_FAILED");
        excelPath = String(result.excelPath).trim();
        await context.storage.save(storageState());
        renderResults();
        setMessage(elements.alibabaLeaseResultMessage, `Excel 已导出并完成校验，共 ${result.rowCount || results.length} 条；点击“打开 Excel”查看。`, "ok");
        context.setStatus("阿里资产租赁 Excel 导出完成", "ok");
      } catch (error) {
        setMessage(elements.alibabaLeaseResultMessage, `Excel 导出失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁 Excel 导出失败", "error");
      } finally {
        exporting = false;
        renderResults();
      }
    }

    function requireAppliedParameters(options = {}) {
      config = readConfig();
      renderParameterState();
      if (!parametersApplied()) {
        const reason = appliedConfig ? "参数有改动，需重新应用。" : "请先点击“确认并应用参数”，再继续。";
        setMessage(elements.alibabaLeaseParameterMessage, reason, "warn");
        context.setStatus("阿里资产租赁参数尚未应用", "warn");
        return null;
      }
      const request = { ...appliedConfig };
      if (options.requireOutput !== false && !request.outputDirectory) {
        setMessage(elements.alibabaLeaseParameterMessage, "请先选择本机输出目录，再开始网络抓取。", "warn");
        context.setStatus("阿里资产租赁尚未选择输出目录", "warn");
        return null;
      }
      return request;
    }

    async function applyParameters() {
      const nextConfig = readConfig();
      if (!nextConfig.outputDirectory) {
        setMessage(elements.alibabaLeaseParameterMessage, "请先选择本机输出目录。", "warn");
        return false;
      }
      if (nextConfig.startDate && nextConfig.endDate && nextConfig.startDate > nextConfig.endDate) {
        setMessage(elements.alibabaLeaseParameterMessage, "结束时间起不能晚于结束时间止。", "error");
        return false;
      }
      config = nextConfig;
      appliedConfig = { ...nextConfig };
      await context.storage.save(storageState());
      renderConfig();
      setMessage(elements.alibabaLeaseParameterMessage, "参数已应用。", "ok");
      context.setStatus("阿里资产租赁参数已应用", "ok");
      return true;
    }

    async function chooseOutputDirectory() {
      try {
        const result = await context.sendNativeMessage({ action: "select_alibaba_lease_output_directory" }, 130000);
        const selected = result?.outputDirectory || result?.path || result?.paths?.[0] || "";
        if (!result?.ok || !selected) {
          if (!result?.cancelled) setMessage(elements.alibabaLeaseParameterMessage, result?.reason || "未选择输出目录", "warn");
          return;
        }
        config.outputDirectory = selected;
        elements.alibabaLeaseOutputDirectory.value = selected;
        renderConfig();
        await context.storage.save(storageState());
        const folderMessage = result.directoryName
          ? `${result.createdDirectory === false ? "已选择" : "已创建并选择"}专用子文件夹：${result.directoryName}`
          : "输出目录已选择";
        const parameterMessage = parametersApplied() ? "" : "参数有改动，需重新应用。";
        setMessage(elements.alibabaLeaseParameterMessage, `${folderMessage}，结果页、Excel 和地图会保存到这里。${parameterMessage}`, parametersApplied() ? "ok" : "warn");
      } catch (error) {
        setMessage(elements.alibabaLeaseParameterMessage, `选择目录失败：${error?.message || String(error)}`, "error");
      }
    }

    async function openSource() {
      if (opening || running) return;
      opening = true;
      elements.openAlibabaLeaseSource.disabled = true;
      try {
        const requestConfig = requireAppliedParameters({ requireOutput: true });
        if (!requestConfig) return;
        let tab = await getCurrentBrowserTab(context.chrome);
        tab = await navigateCurrentTab(context.chrome, tab, buildSourceUrl(requestConfig));
        setMessage(elements.alibabaLeaseParameterMessage, "已在当前浏览器打开阿里资产租赁列表页。等待结果加载完成后即可开始抓取。", "ok");
        context.setStatus("阿里资产租赁检索页已在当前浏览器打开", "ok");
      } catch (error) {
        const errorCode = error?.code && error.code !== error?.message ? `${error.code}：` : "";
        setMessage(elements.alibabaLeaseParameterMessage, `当前浏览器打开失败：${errorCode}${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁页面打开失败", "error");
      } finally {
        opening = false;
        elements.openAlibabaLeaseSource.disabled = running;
      }
    }

    async function runScrape() {
      if (running) return;
      const requestConfig = requireAppliedParameters();
      if (!requestConfig) return;
      running = true;
      runControl = { paused: false, stopped: false, percent: 0, resumeResolvers: [] };
      renderProgress({ phase: "opening", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "正在准备抓取…" });
      elements.runAlibabaLease.disabled = true;
      elements.openAlibabaLeaseSource.disabled = true;
      elements.pauseAlibabaLease.disabled = false;
      elements.stopAlibabaLease.disabled = false;
      elements.pauseAlibabaLease.textContent = "暂停抓取";
      elements.clearAlibabaLeaseResults.disabled = true;
      renderResults();
      setMessage(elements.alibabaLeaseResultMessage, "脚本正在通过浏览器读取租赁列表并逐条核验详情；无需 AI 介入。", "warn");
      context.setStatus("阿里资产租赁脚本正在运行", "busy");
      try {
        const result = await runCurrentTabScrape(context, {
          ...requestConfig,
          sourceUrl: buildSourceUrl(requestConfig),
        }, (payload) => {
          renderProgress(payload);
          if (payload.phase === "generating_results") {
            elements.pauseAlibabaLease.disabled = true;
          }
          elements.alibabaLeaseResultStatus.dataset.kind = "";
        }, runControl);
        if (result?.stopped && result?.finalized) {
          results = Array.isArray(result.results) ? result.results : [];
          htmlPath = String(result.htmlPath || "").trim();
          mapPath = String(result.mapPath || "").trim();
          excelPath = "";
          renderProgress({ phase: "stopped", percent: 100, fetched: result.candidates || 0, verified: results.length, skipped: result.skipped || 0, message: "本地结果写入完成，抓取已终止。" });
          await context.storage.save(storageState());
          renderResults();
          setMessage(elements.alibabaLeaseResultMessage, htmlPath
            ? `抓取已终止，但本次结果已写入本机；页面记录 ${result.candidates || 0} 条，核验通过 ${results.length} 条，跳过 ${result.skipped || 0} 条。`
            : "抓取已终止，未生成可打开的结果文件。", "warn");
          context.setStatus("阿里资产租赁结果已写入，抓取已终止", "warn");
          return;
        }
        if (result?.stopped) {
          renderProgress({ phase: "stopped", message: "抓取已终止；未生成本次半成品结果。" });
          setMessage(elements.alibabaLeaseResultMessage, `抓取已终止，已读取 ${result.candidates || 0} 条页面记录。可以重新开始。`, "warn");
          context.setStatus("阿里资产租赁抓取已终止", "warn");
          return;
        }
        if (!result?.ok) {
          const failure = new Error(result?.reason || result?.errorCode || "ALIBABA_LEASE_FAILED");
          failure.code = result?.errorCode || "ALIBABA_LEASE_FAILED";
          throw failure;
        }
        results = Array.isArray(result.results) ? result.results : [];
        htmlPath = String(result.htmlPath || "").trim();
        mapPath = String(result.mapPath || "").trim();
        excelPath = "";
        renderProgress({ phase: "completed", percent: 100, fetched: result.candidates || 0, verified: results.length, skipped: result.skipped || 0, message: "抓取完成，结果页正在打开…" });
        await context.storage.save(storageState());
        renderConfig();
        renderResults();
        setMessage(elements.alibabaLeaseResultMessage, `抓取完成：页面记录 ${result.candidates || 0} 条，核验通过 ${results.length} 条，跳过 ${result.skipped || 0} 条。`, "ok");
        await openResultPage();
        context.setStatus(`阿里资产租赁抓取完成：${results.length} 条有效案例`, "ok");
      } catch (error) {
        renderProgress({ phase: "failed", message: "抓取失败，请按提示处理后重试" });
        const errorCode = error?.code && error.code !== error?.message ? `${error.code}：` : "";
        setMessage(elements.alibabaLeaseResultMessage, `抓取未完成：${errorCode}${error?.message || String(error)}`, "error");
        context.setStatus("阿里资产租赁抓取失败", "error");
      } finally {
        running = false;
        if (runControl) {
          runControl.paused = false;
          for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
        }
        runControl = null;
        elements.runAlibabaLease.disabled = false;
        elements.openAlibabaLeaseSource.disabled = false;
        elements.pauseAlibabaLease.disabled = true;
        elements.stopAlibabaLease.disabled = true;
        elements.pauseAlibabaLease.textContent = "暂停抓取";
        elements.clearAlibabaLeaseResults.disabled = !results.length;
        renderResults();
      }
    }

    function togglePause() {
      if (!running || !runControl) return;
      if (runControl.paused) {
        runControl.paused = false;
        elements.pauseAlibabaLease.textContent = "暂停抓取";
        for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
        setMessage(elements.alibabaLeaseResultMessage, "已继续抓取，将从当前进度继续。", "ok");
        return;
      }
      runControl.paused = true;
      runControl.percent = Number(progressState.percent || 0);
      elements.pauseAlibabaLease.textContent = "继续抓取";
      renderProgress({ phase: "paused", message: "抓取已暂停；点击“继续抓取”后会从当前进度继续。" });
      setMessage(elements.alibabaLeaseResultMessage, "抓取已暂停，当前标签页可以保留在原位置。", "warn");
    }

    function stopScrape() {
      if (!running || !runControl) return;
      const finalizationPhase = progressState.phase === "generating_results";
      runControl.stopped = true;
      runControl.paused = false;
      for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
      elements.stopAlibabaLease.disabled = true;
      elements.pauseAlibabaLease.disabled = true;
      if (finalizationPhase) {
        renderProgress({ phase: progressState.phase, percent: 99, message: "正在完成本地结果写入，完成后终止" });
        setMessage(elements.alibabaLeaseResultMessage, "正在完成本地结果写入，完成后终止", "warn");
      } else {
        renderProgress({ phase: "stopped", message: "正在终止当前抓取，请稍候…" });
        setMessage(elements.alibabaLeaseResultMessage, "正在终止抓取，不会继续打开新的详情页。", "warn");
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("ALIBABA_LEASE_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = alibabaLeaseTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/alibaba-lease/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        const stored = await context.storage.load({});
        config = normalizeConfig(stored);
        appliedConfig = stored?.parameterSnapshot ? normalizeConfig(stored.parameterSnapshot) : null;
        results = Array.isArray(stored?.results) ? stored.results : [];
        htmlPath = String(stored?.htmlPath || "").trim();
        excelPath = String(stored?.excelPath || "").trim();
        mapPath = String(stored?.mapPath || "").trim();
        progressState = results.length
          ? { phase: "completed", percent: 100, fetched: results.length, verified: results.length, skipped: 0, message: `已保留上次结果：${results.length} 条有效案例` }
          : { phase: "idle", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "等待开始" };
        context.scope.on(elements.openAlibabaLease, "click", () => context.navigate("alibaba-lease"));
        context.scope.on(elements.backFromAlibabaLease, "click", () => context.navigate("home"));
        context.scope.on(elements.openAlibabaLeaseSource, "click", openSource);
        context.scope.on(elements.openAlibabaLeaseResult, "click", openResultPage);
        context.scope.on(elements.exportAlibabaLeaseExcel, "click", exportExcel);
        context.scope.on(elements.openAlibabaLeaseExcel, "click", openExcel);
        context.scope.on(elements.openAlibabaLeaseMap, "click", openMap);
        context.scope.on(elements.chooseAlibabaLeaseOutput, "click", chooseOutputDirectory);
        context.scope.on(elements.runAlibabaLease, "click", () => runScrape());
        context.scope.on(elements.pauseAlibabaLease, "click", togglePause);
        context.scope.on(elements.stopAlibabaLease, "click", stopScrape);
        context.scope.on(elements.saveAlibabaLeaseParams, "click", applyParameters);
        context.scope.on(elements.resetAlibabaLeaseParams, "click", async () => {
          config = { ...DEFAULT_CONFIG, outputDirectory: config.outputDirectory };
          excelPath = "";
          mapPath = "";
          await context.storage.save(storageState());
          renderConfig();
          setMessage(elements.alibabaLeaseParameterMessage, "已恢复默认参数；请点击“确认并应用参数”。", "warn");
        });
        context.scope.on(elements.clearAlibabaLeaseResults, "click", async () => {
          results = [];
          htmlPath = "";
          excelPath = "";
          mapPath = "";
          await context.storage.save(storageState());
          renderResults();
          setMessage(elements.alibabaLeaseResultMessage, "已清空本地结果。", "");
        });
        for (const id of ["alibabaLeasePropertyType", "alibabaLeaseStatus", "alibabaLeaseKeyword", "alibabaLeaseStartDate", "alibabaLeaseEndDate", "alibabaLeaseMaxPages", "alibabaLeaseGenerateMap"]) {
          context.scope.on(elements[id], "change", syncConfigFromInputs);
          if (["alibabaLeaseKeyword", "alibabaLeaseStartDate", "alibabaLeaseEndDate"].includes(id)) {
            context.scope.on(elements[id], "input", markConfigDirtyFromInputs);
          }
        }
        context.scope.on(elements.alibabaLeaseProvince, "change", () => {
          config = normalizeConfig({ ...config, provinceCode: elements.alibabaLeaseProvince.value, city: "", cityCode: "", district: "", districtCode: "" });
          renderConfig();
          setMessage(elements.alibabaLeaseParameterMessage, "参数有改动，需重新应用。", "warn");
        });
        context.scope.on(elements.alibabaLeaseCity, "change", () => {
          config = normalizeConfig({ ...config, city: "", cityCode: elements.alibabaLeaseCity.value, district: "", districtCode: "" });
          renderConfig();
          setMessage(elements.alibabaLeaseParameterMessage, "参数有改动，需重新应用。", "warn");
        });
        context.scope.on(elements.alibabaLeaseDistrict, "change", syncConfigFromInputs);
        renderConfig();
        renderResults();
        renderProgress();
      },
      activate() {
        renderConfig();
        renderResults();
      },
      deactivate() {},
      dispose() {},
    };
  },
};

export {
  DEFAULT_CONFIG,
  DEFAULT_SOURCE_URL,
  RESULT_FIELDS,
  buildSourceUrl,
  candidateInScope,
  canonicalDetailUrl,
  listPageMatchesRequest,
  listPageUrl,
  locationScopeCode,
  matchesRequest,
  mergeListingEvidence,
  noValidCasesReason,
  normalizeConfig,
  pageBeforeRequestedRange,
  pageLooksBlocked,
  pageReady,
  pageWaitState,
  parameterSnapshotMatches,
  parseAmount,
  parseLeaseDetail,
  resultGenerationProgress,
  skipReason,
  usableDistricts,
  waitForRunResume,
};
