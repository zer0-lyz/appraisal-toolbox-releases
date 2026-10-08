import { anjukePropertyTemplate } from "./template.js";

const DEFAULT_PROFILE_PATH = "~/.tianyuan-workbench/dependencies/anjuke-property-profile";
const DETAIL_DELAY_MS = 2200;
const CAPTURE_STATUSES = ["ok", "blocked_verification", "not_case", "read_failed"];
const DEFAULT_CONFIG = {
  currentUrl: "",
  listUrls: [],
  detailUrls: [],
  caseType: "auto",
  maxCases: 10,
  keyword: "",
  screenshot: false,
  waitVerification: true,
  verificationTimeout: 300,
  headed: true,
  userDataDir: DEFAULT_PROFILE_PATH,
  outputDirectory: "",
  autoOpenResult: true,
};

function elementMap(documentRef) {
  const ids = [
    "openAnjukeProperty", "backFromAnjukeProperty", "anjukePropertyCurrentUrl", "importAnjukePropertyCurrentUrl",
    "anjukePropertyCaseType", "anjukePropertyMaxCases", "anjukePropertyKeyword", "anjukePropertyWaitVerification",
    "anjukePropertyScreenshot", "applyAnjukePropertyParams", "resetAnjukePropertyParams",
    "anjukePropertyParameterState", "anjukePropertyParameterMessage", "anjukePropertyOutputDirectory",
    "chooseAnjukePropertyOutput", "anjukePropertyProfileHint", "openAnjukePropertySource", "runAnjukeProperty", "anjukePropertyGate", "openAnjukePropertyExcel", "openAnjukePropertyCsv",
    "openAnjukePropertyHtml", "openAnjukePropertyResult", "openAnjukePropertyMap", "pauseAnjukeProperty",
    "stopAnjukeProperty", "clearAnjukePropertyResults", "anjukePropertyResultCount", "anjukePropertyResultStatus",
    "anjukePropertyProgressPhase", "anjukePropertyProgressPercent", "anjukePropertyProgressBar",
    "anjukePropertyProgressFetched", "anjukePropertyProgressWritten", "anjukePropertyProgressSkipped",
    "anjukePropertyProgressBlocked", "anjukePropertyAutoOpenResult", "anjukePropertyResultMessage",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

function normalizeAnjukeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) return "";
  return url.href;
}

function isScopedListingUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return false; }
  if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) return false;
  const pathname = url.pathname.replace(/\/+$/, "");
  return /^\/(?:xzl-shou|xzl-zu|sp-shou|sp-zu|sp-rent)\/[^/]+(?:\/[^/]+)*$/i.test(pathname)
    && !/\/\d+$/i.test(pathname);
}

function isAnjukeListingUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return false; }
  if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) return false;
  const pathname = url.pathname.replace(/\/+$/, "");
  return /^\/(?:xzl-shou|xzl-zu|sp-shou|sp-zu|sp-rent)(?:\/[^/]+)*$/i.test(pathname)
    && !/\/\d+$/i.test(pathname);
}

function isAnjukeDetailUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) return false;
  return /\/prop\/view\/[A-Za-z0-9_-]+/i.test(url.pathname)
    || /\/(?:fang5|sale|rent)\/[A-Za-z0-9_-]+/i.test(url.pathname)
    // 商业地产详情是 /{频道}/{≥7位房源id}/；分页（如 gongshu-p2）与列表根凭位数即可区分。
    || /\/(?:xzl-shou|xzl-zu|sp-shou|sp-zu|sp-rent)\/(?:[^/]+\/)*\d{7,}(?:\/|$)/i.test(url.pathname)
    || /\/\d{7,}(?:\/|$)/.test(url.pathname)
    || /\.html(?:$|\?)/i.test(url.pathname);
}

function inferCaseType(url) {
  const path = String(url || "").toLowerCase();
  if (/(sp-rent|rent|zu)/.test(path)) return "rent";
  if (/(sp-shou|sale|shou)/.test(path)) return "sale";
  return "auto";
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const legacyUrl = Array.isArray(source.listUrls) ? source.listUrls[0] : (Array.isArray(source.detailUrls) ? source.detailUrls[0] : "");
  const currentUrl = normalizeAnjukeUrl(source.currentUrl || legacyUrl);
  return {
    ...DEFAULT_CONFIG,
    currentUrl,
    listUrls: currentUrl ? [currentUrl] : [],
    detailUrls: [],
    caseType: ["auto", "sale", "rent"].includes(source.caseType) ? source.caseType : inferCaseType(currentUrl),
    maxCases: Math.max(1, Math.min(100, Number(source.maxCases || 10))),
    keyword: String(source.keyword || "").trim().slice(0, 80),
    screenshot: source.screenshot === true,
    waitVerification: source.waitVerification !== false,
    verificationTimeout: Math.max(1, Math.min(900, Number(source.verificationTimeout || 300))),
    headed: true,
    userDataDir: String(source.userDataDir || DEFAULT_PROFILE_PATH).trim(),
    outputDirectory: String(source.outputDirectory || "").trim(),
    autoOpenResult: source.autoOpenResult !== false,
  };
}

function comparableConfig(config) {
  const normalized = normalizeConfig(config);
  return JSON.stringify({
    currentUrl: normalized.currentUrl,
    caseType: normalized.caseType,
    maxCases: normalized.maxCases,
    keyword: normalized.keyword,
    screenshot: normalized.screenshot,
    waitVerification: normalized.waitVerification,
    outputDirectory: normalized.outputDirectory,
  });
}

function parseResultPaths(result) {
  return {
    excelPath: String(result?.excelPath || "").trim(),
    csvPath: String(result?.csvPath || "").trim(),
    htmlDirectory: String(result?.htmlDirectory || "").trim(),
    resultHtmlPath: String(result?.resultHtmlPath || "").trim(),
    mapPath: String(result?.mapPath || "").trim(),
  };
}

async function captureAnjukeCurrentTab(options = {}) {
  const maxCases = Math.max(1, Math.min(100, Number(options.maxCases || 10)));
  const candidateLimit = Math.min(100, maxCases + 10);
  const keyword = String(options.keyword || "").trim();
  const verificationMarkers = ["验证码", "访问过于频繁", "安全验证", "滑块", "人机验证", "请完成验证", "请拖动滑块", "验证后继续", "风险验证", "人机校验"];
  const bodyText = () => String(document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
  const blocked = (text) => verificationMarkers.some((marker) => text.includes(marker));
  const isDetailUrl = (url) => /\/prop\/view\/[A-Za-z0-9_-]+/i.test(url.pathname)
    || /\/(?:fang5|sale|rent)\/[A-Za-z0-9_-]+/i.test(url.pathname)
    || /\/(?:xzl-shou|xzl-zu|sp-shou|sp-zu|sp-rent)\/(?:[^/]+\/)*\d{7,}(?:\/|$)/i.test(url.pathname)
    || /\/\d{7,}(?:\/|$)/.test(url.pathname)
    || /\.html(?:$|\?)/i.test(url.pathname);
  const currentText = bodyText();
  const sourcePath = location.pathname.replace(/\/+$/, "");
  if (!/^\/(?:xzl-shou|xzl-zu|sp-shou|sp-zu|sp-rent)(?:\/[^/]+)*$/i.test(sourcePath)
    || /\/\d+$/i.test(sourcePath)) {
    return { ok: false, errorCode: "ANJUKE_LIST_PAGE_REQUIRED", reason: "当前页面不是安居客列表页，请先打开列表页。" };
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    window.scrollTo(0, document.body?.scrollHeight || 0);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
  }
  window.scrollTo(0, 0);
  if (blocked(currentText)) {
    return { ok: false, verificationRequired: true, errorCode: "ANJUKE_VERIFICATION_REQUIRED", reason: "当前安居客标签页正在等待验证。" };
  }
  const detailUrls = [];
  const seen = new Set();
  const listPath = location.pathname.replace(/\/$/, "");
  const anchors = [];
  const visitedRoots = new Set();
  const collectAnchors = (root) => {
    if (!root || visitedRoots.has(root)) return;
    visitedRoots.add(root);
    if (root.querySelectorAll) {
      anchors.push(...root.querySelectorAll("a[href]"));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) collectAnchors(element.shadowRoot);
      }
    }
  };
  collectAnchors(document);
  const isRecommendationUrl = (url) => /(?:guessrecommend|recommend|history|similar|related)/i.test(url.search || "");
  const canonicalDetailUrl = (url) => {
    const clean = new URL(url.href);
    clean.search = "";
    clean.hash = "";
    return clean;
  };
  const cardTextOf = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const cardOf = (anchor) => {
    let node = anchor;
    for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
      const text = cardTextOf(node);
      if (text.length >= 40 && text.length <= 2200 && /(?:㎡|平米|平方米)/.test(text) && /(?:万|元\/㎡|元\/月)/.test(text)) return node;
    }
    return anchor.parentElement;
  };
  // 真实列表页的详情入口就是 /{频道}/{≥7位房源id}/ 的标题链接；分页（gongshu-p2）、
  // 列表根与推荐位链接都不能当候选，找不到详情形链接的卡片直接跳过，不做兜底替换。
  for (const anchor of anchors) {
    let href = anchor.getAttribute("href") || "";
    if (!href || href.toLowerCase().startsWith("javascript:")) continue;
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      continue;
    }
    url.hash = "";
    if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) continue;
    if (url.pathname.replace(/\/$/, "") === listPath) continue;
    if (!new RegExp(`/${sourcePath.split("/")[1]}/`, "i").test(url.pathname)) continue;
    if (isRecommendationUrl(url)) continue;
    if (!isDetailUrl(url)) continue;
    const canonical = canonicalDetailUrl(url);
    if (seen.has(canonical.href)) continue;
    if (keyword) {
      const cardText = cardTextOf(cardOf(anchor));
      if (!cardText.includes(keyword) && !canonical.href.includes(keyword)) continue;
    }
    seen.add(canonical.href);
    detailUrls.push(canonical.href);
    if (detailUrls.length >= candidateLimit) break;
  }
  if (!detailUrls.length) {
    return { ok: false, verificationRequired: blocked(currentText), errorCode: "ANJUKE_NO_DETAIL_URLS", reason: "当前安居客页面没有找到详情案例链接。" };
  }
  return { ok: true, detailUrls };
}

function readAnjukeDetailTab() {
  const text = String(document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60000);
  const html = String(document.documentElement?.outerHTML || "").slice(0, 400000);
  // 只认验证码专属的 DOM 信号；'verify'/'slider' 会误中详情页的"核验"徽章与图片轮播组件。
  const verificationSelectors = [
    "iframe[src*='captcha' i]", "iframe[src*='verify' i]",
    "[id*='captcha' i]", "[class*='captcha' i]",
    ".geetest_panel", ".geetest_slider", ".nc-container", "#nc_1_wrapper", "#tcaptcha", "[class*='yidun' i]",
  ];
  const verificationMarkers = ["验证码", "访问过于频繁", "安全验证", "滑块", "人机验证", "请完成验证", "请拖动滑块", "验证后继续", "风险验证", "人机校验"];
  const detailMarkers = ["总价", "售价", "参考售价", "报价", "租金", "建筑面积", "房屋单价", "单价", "户型", "楼层", "朝向", "装修", "房源编号", "写字楼", "商铺"];
  const source = html;
  const coordinate = (name, minimum, maximum) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`(?:["']?${escapedName}["']?|data-${escapedName})[^0-9-]{0,24}(-?\\d+(?:\\.\\d+)?)`, "i"));
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
  };
  const markerCount = verificationMarkers.filter((marker) => text.includes(marker)).length;
  const captchaDomRequired = verificationSelectors.some((selector) => document.querySelector(selector));
  const detailSignalCount = detailMarkers.filter((marker) => text.includes(marker)).length;
  // 反爬验证页没有案例信号；正常详情页即使出现"验证码"（如查电话组件）也不算被拦截。
  const verificationRequired = captchaDomRequired
    || markerCount >= 2
    || (markerCount >= 1 && detailSignalCount === 0);
  const detailAvailable = !verificationRequired && detailSignalCount >= 2;
  return {
    pageUrl: location.href,
    text,
    html,
    title: String(document.querySelector("h1,.title,.house-title,.main-title")?.innerText || document.title || "").trim().slice(0, 300),
    location: String(document.querySelector(".address,.addr,[class*=address],[class*=addr]")?.innerText || "").trim().slice(0, 300),
    longitude: coordinate("longitude", -180, 180) ?? coordinate("lng", -180, 180) ?? coordinate("lon", -180, 180),
    latitude: coordinate("latitude", -90, 90) ?? coordinate("lat", -90, 90),
    verificationRequired,
    verificationSource: verificationRequired ? (captchaDomRequired ? "captcha-dom" : `text-markers:${markerCount}`) : "",
    detailAvailable,
    detailSignalCount,
    errorCode: detailAvailable ? "" : (verificationRequired ? "ANJUKE_DETAIL_VERIFICATION_REQUIRED" : "ANJUKE_DETAIL_PAGE_NOT_CASE"),
  };
}

function readRestoredListingUrl() {
  return location.href;
}

export const anjukePropertyModule = {
  manifest: {
    id: "anjuke-property",
    type: "feature",
    stage: "stable",
    route: "anjuke-property",
    displayName: "安居客数据",
    messageNamespace: "anjuke-property",
    entryElementId: "openAnjukeProperty",
    pageElementId: "page-anjuke-property",
    storageVersion: 3,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let config = { ...DEFAULT_CONFIG };
    let appliedConfig = null;
    let results = [];
    let paths = { excelPath: "", csvPath: "", htmlDirectory: "", resultHtmlPath: "", mapPath: "" };
    let running = false;
    let runControl = { paused: false, stopRequested: false, resumeResolvers: [], verificationWaitUsedMs: 0 };

    function state() {
      return { ...config, results, ...paths, appliedConfig };
    }

    function readConfig() {
      return normalizeConfig({
        currentUrl: elements.anjukePropertyCurrentUrl.value,
        caseType: elements.anjukePropertyCaseType.value,
        maxCases: elements.anjukePropertyMaxCases.value,
        keyword: elements.anjukePropertyKeyword.value,
        screenshot: elements.anjukePropertyScreenshot.checked,
        waitVerification: elements.anjukePropertyWaitVerification.checked,
        outputDirectory: elements.anjukePropertyOutputDirectory.value,
        autoOpenResult: elements.anjukePropertyAutoOpenResult.checked,
        userDataDir: config.userDataDir,
      });
    }

    function parametersApplied() {
      return Boolean(appliedConfig) && comparableConfig(config) === comparableConfig(appliedConfig);
    }

    function renderParameterState() {
      if (!config.currentUrl) {
        elements.anjukePropertyParameterState.textContent = "未导入网址";
        elements.anjukePropertyParameterState.dataset.kind = "pending";
        return;
      }
      const applied = parametersApplied();
      elements.anjukePropertyParameterState.textContent = applied ? "参数已应用" : "参数有改动，需重新应用";
      elements.anjukePropertyParameterState.dataset.kind = applied ? "ok" : "warn";
      renderRunGate();
    }

    function renderConfig() {
      elements.anjukePropertyCurrentUrl.value = config.currentUrl;
      elements.anjukePropertyCaseType.value = config.caseType;
      elements.anjukePropertyMaxCases.value = String(config.maxCases);
      elements.anjukePropertyKeyword.value = config.keyword;
      elements.anjukePropertyScreenshot.checked = config.screenshot;
      elements.anjukePropertyWaitVerification.checked = config.waitVerification;
      elements.anjukePropertyOutputDirectory.value = config.outputDirectory;
      elements.anjukePropertyAutoOpenResult.checked = config.autoOpenResult;
      renderParameterState();
    }

    // 主操作门禁：未导入网址 / 未选目录 / 参数未应用 / 运行中，均实时禁用并说明原因。
    function renderRunGate() {
      const button = elements.runAnjukeProperty;
      const gate = elements.anjukePropertyGate;
      if (!button) return;
      const missing = [];
      if (running) {
        missing.push("正在抓取中");
      } else {
        if (!config.currentUrl) missing.push("先导入安居客列表网址");
        if (!config.outputDirectory) missing.push("先选择输出目录");
        if (!parametersApplied()) missing.push("先点击“确认并应用参数”");
      }
      const blocked = missing.length > 0;
      button.disabled = blocked;
      if (gate) {
        gate.textContent = blocked ? `暂时无法开始抓取：${missing.join("、")}` : "";
        gate.dataset.kind = blocked ? "warn" : "";
      }
    }

    function renderRunButtons() {
      elements.pauseAnjukeProperty.disabled = !running;
      elements.stopAnjukeProperty.disabled = !running;
      elements.pauseAnjukeProperty.textContent = runControl.paused ? "继续抓取" : "暂停抓取";
      renderRunGate();
      elements.openAnjukePropertySource.disabled = running;
      elements.importAnjukePropertyCurrentUrl.disabled = running;
    }

    function renderProgress(payload = {}) {
      const percent = Math.max(0, Math.min(100, Number(payload.percent || 0)));
      const phases = {
        opening: "正在读取当前安居客标签页",
        capturing: "正在抓取详情并归档证据",
        paused: "已暂停",
        writing: "正在生成输出",
        completed: "抓取完成",
        failed: "抓取失败",
      };
      elements.anjukePropertyProgressPhase.textContent = phases[payload.phase] || "正在处理";
      elements.anjukePropertyProgressPercent.textContent = `${percent}%`;
      elements.anjukePropertyProgressBar.style.width = `${percent}%`;
      elements.anjukePropertyProgressBar.parentElement.setAttribute("aria-valuenow", String(percent));
      if (payload.fetched !== undefined) elements.anjukePropertyProgressFetched.textContent = String(payload.fetched);
      if (payload.written !== undefined) elements.anjukePropertyProgressWritten.textContent = String(payload.written);
      if (payload.skipped !== undefined) elements.anjukePropertyProgressSkipped.textContent = String(payload.skipped);
      if (payload.blocked !== undefined) elements.anjukePropertyProgressBlocked.textContent = String(payload.blocked);
      if (payload.message) elements.anjukePropertyResultStatus.textContent = payload.message;
    }

    function renderResults() {
      elements.anjukePropertyResultCount.textContent = `${results.length} 条`;
      elements.openAnjukePropertyExcel.disabled = !paths.excelPath;
      elements.openAnjukePropertyCsv.disabled = !paths.csvPath;
      elements.openAnjukePropertyHtml.disabled = !paths.htmlDirectory;
      elements.openAnjukePropertyResult.disabled = !paths.resultHtmlPath;
      elements.openAnjukePropertyMap.disabled = !paths.mapPath;
      elements.clearAnjukePropertyResults.disabled = !results.length;
    }

    function outcomeCounts(outcomes = []) {
      let written = 0;
      let skipped = 0;
      let blocked = 0;
      for (const outcome of outcomes) {
        if (outcome.captureStatus === "ok") written += 1;
        else if (outcome.captureStatus === "blocked_verification") blocked += 1;
        else skipped += 1;
      }
      return { fetched: outcomes.length, written, skipped, blocked };
    }

    function waitWhilePaused() {
      if (!runControl.paused || runControl.stopRequested) return Promise.resolve();
      renderProgress({ phase: "paused", message: "抓取已暂停；点击“继续抓取”后从当前进度继续。" });
      return new Promise((resolve) => runControl.resumeResolvers.push(resolve));
    }

    function resumeCapture() {
      runControl.paused = false;
      const resolvers = runControl.resumeResolvers;
      runControl.resumeResolvers = [];
      for (const resolve of resolvers) resolve();
      renderProgress({ phase: "capturing", percent: Math.max(8, Number(elements.anjukePropertyProgressPercent.textContent.replace("%", "")) || 8), message: "已继续抓取。" });
    }

    function togglePause() {
      if (!running) return;
      if (runControl.paused) {
        resumeCapture();
      } else {
        runControl.paused = true;
        renderRunButtons();
        renderProgress({ phase: "paused", message: "抓取已暂停；点击“继续抓取”后从当前进度继续。" });
        setMessage(elements.anjukePropertyResultMessage, "抓取已暂停，当前详情处理完成后不再继续。", "warn");
      }
    }

    function stopCapture() {
      if (!running) return;
      runControl.stopRequested = true;
      runControl.paused = false;
      const resolvers = runControl.resumeResolvers;
      runControl.resumeResolvers = [];
      for (const resolve of resolvers) resolve();
      renderRunButtons();
      renderProgress({ phase: "capturing", message: "正在终止抓取；已完成证据会保留并恢复列表页。" });
      setMessage(elements.anjukePropertyResultMessage, "已请求终止抓取；正在保存已完成结果并恢复列表页。", "warn");
    }

    async function importCurrentUrl() {
      try {
        const [tab] = await context.chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const currentUrl = normalizeAnjukeUrl(tab?.url);
        if (!currentUrl) {
          setMessage(elements.anjukePropertyParameterMessage, "当前标签页不是可用的安居客网页，请先在安居客上选好范围。", "warn");
          return;
        }
        if (!isAnjukeListingUrl(currentUrl)) {
          setMessage(elements.anjukePropertyParameterMessage, `当前页面不是安居客列表页：${currentUrl}。请先进入列表页后再导入。`, "warn");
          return;
        }
        config = normalizeConfig({ ...config, currentUrl, caseType: elements.anjukePropertyCaseType.value || inferCaseType(currentUrl) });
        await context.storage.save(state());
        renderConfig();
        renderParameterState();
        setMessage(elements.anjukePropertyParameterMessage, `已导入当前列表页${isScopedListingUrl(currentUrl) ? "（已带区域条件）" : "（将按页面当前筛选条件）"}。请确认参数后点击“确认并应用参数”。`, "ok");
      } catch (error) {
        setMessage(elements.anjukePropertyParameterMessage, `导入当前网址失败：${error?.message || String(error)}`, "error");
      }
    }

    async function openSource() {
      if (running) return;
      if (!config.currentUrl) {
        setMessage(elements.anjukePropertyParameterMessage, "还没有导入列表页网址，请先点击“导入当前网址”。", "warn");
        return;
      }
      try {
        const [tab] = await context.chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error("当前没有可用标签页");
        await context.chrome.tabs.update(tab.id, { url: config.currentUrl });
        setMessage(elements.anjukePropertyParameterMessage, "已在当前标签页打开安居客列表页，选好范围后再导入网址。", "ok");
      } catch (error) {
        setMessage(elements.anjukePropertyParameterMessage, `打开安居客失败：${error?.message || String(error)}`, "error");
      }
    }

    async function applyParameters() {
      const nextConfig = readConfig();
      if (!nextConfig.currentUrl) {
        setMessage(elements.anjukePropertyParameterMessage, "请先点击“导入当前网址”。", "warn");
        return;
      }
      if (!isAnjukeListingUrl(nextConfig.currentUrl)) {
        setMessage(elements.anjukePropertyParameterMessage, "当前网址不是安居客列表页，无法应用参数；请重新导入列表页。", "warn");
        return;
      }
      if (!nextConfig.outputDirectory) {
        setMessage(elements.anjukePropertyParameterMessage, "请先选择本机输出目录。", "warn");
        return;
      }
      config = nextConfig;
      appliedConfig = { ...config };
      await context.storage.save(state());
      renderConfig();
      setMessage(elements.anjukePropertyParameterMessage, "参数已应用；可以开始网络抓取。", "ok");
      context.setStatus("安居客参数已应用", "ok");
    }

    async function chooseOutput() {
      const result = await context.sendNativeMessage({ action: "select_anjuke_property_output_directory" }, 130000);
      const selected = result?.outputDirectory || result?.path || result?.paths?.[0] || "";
      if (!result?.ok || !selected) {
        if (!result?.cancelled) setMessage(elements.anjukePropertyParameterMessage, result?.reason || "未选择输出目录", "warn");
        return;
      }
      config.outputDirectory = selected;
      renderConfig();
      renderParameterState();
      await context.storage.save(state());
      setMessage(elements.anjukePropertyParameterMessage, `已选择专用子文件夹：${result.directoryName || "安居客物业案例"}。参数有改动时请重新应用。`, "ok");
    }

    function waitForTabLoaded(tabId, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          context.chrome.tabs.onUpdated.removeListener(onUpdated);
          if (timer) window.clearTimeout(timer);
        };
        const finish = (callback, value) => {
          cleanup();
          callback(value);
        };
        const onUpdated = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === "complete") finish(resolve, true);
        };
        context.chrome.tabs.onUpdated.addListener(onUpdated);
        timer = window.setTimeout(() => finish(reject, new Error("ANJUKE_TAB_LOAD_TIMEOUT")), timeoutMs);
        context.chrome.tabs.get(tabId).then((tab) => {
          if (tab?.status === "complete") finish(resolve, true);
        }).catch((error) => finish(reject, error));
      });
    }

    async function focusTab(tabId) {
      try {
        const tab = await context.chrome.tabs.update(tabId, { active: true });
        if (tab?.windowId !== undefined) {
          await context.chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
      } catch {
        // Tab may be gone; the wait loop will still honour its deadline.
      }
    }

    // 安居客的反爬验证是会话级的：每个详情候选都可能触发等待。
    // 给整轮设一个总预算，超时后剩余候选直接记为验证阻断，避免数十分钟假死。
    const VERIFICATION_TOTAL_BUDGET_MS = 600000;

    function verificationBudgetRemainingMs() {
      runControl.verificationWaitUsedMs = runControl.verificationWaitUsedMs || 0;
      return Math.max(0, VERIFICATION_TOTAL_BUDGET_MS - runControl.verificationWaitUsedMs);
    }

    async function currentTabUrl(tabId) {
      try {
        const tab = await context.chrome.tabs.get(tabId);
        return String(tab?.url || "");
      } catch {
        return "";
      }
    }

    // 58 系反爬验证页（callback.58.com/antibot）不在宿主权限内，无法注入读取；
    // 唯一正确语义是"等待人工验证"：聚焦标签页，等会话恢复、URL 回到安居客再继续读。
    async function waitForVerificationIfRedirected(tabId, request, deadline) {
      const tabUrl = await currentTabUrl(tabId);
      if (!tabUrl || /(^|\.)anjuke\.com\//i.test(tabUrl)) return false;
      if (!request.waitVerification || Date.now() >= deadline - 2000) {
        return { captureStatus: "blocked_verification", errorCode: "ANJUKE_REDIRECTED_TO_VERIFICATION", text: "", html: "", title: "", location: "", pageUrl: tabUrl };
      }
      await focusTab(tabId);
      setMessage(elements.anjukePropertyResultMessage, "安居客把标签页跳转到了 58 反爬验证页：已在浏览器中聚焦，请完成滑块验证，完成后脚本会自动继续。", "warn");
      renderProgress({ phase: "capturing", percent: 12, message: `等待安居客反爬验证完成…（剩余 ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))} 秒）` });
      runControl.verificationWaitUsedMs = (runControl.verificationWaitUsedMs || 0) + 2000;
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      return null;
    }

    async function readDetailOutcome(tabId, request) {
      if (request.waitVerification && verificationBudgetRemainingMs() <= 0) {
        return { captureStatus: "blocked_verification", errorCode: "ANJUKE_VERIFICATION_BUDGET_EXHAUSTED", text: "", html: "", title: "", location: "", pageUrl: "" };
      }
      const budgetMs = verificationBudgetRemainingMs();
      const waitCeiling = request.waitVerification ? Math.min(request.verificationTimeout * 1000, budgetMs) : 0;
      const deadline = Date.now() + (waitCeiling > 0 ? waitCeiling : 10000);
      const contentSettleDeadline = Math.min(deadline, Date.now() + 15000);
      const remainingText = () => `剩余 ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))} 秒`;
      while (Date.now() < deadline) {
        const redirected = await waitForVerificationIfRedirected(tabId, request, deadline);
        if (redirected) return redirected;
        const allTabs = await context.chrome.tabs.query({});
        const verificationTab = allTabs.find((candidate) => {
          if (candidate.id === tabId) return false;
          try {
            const candidateUrl = new URL(candidate.url || "");
            return /(^|\.)anjuke\.com$/i.test(candidateUrl.hostname)
              && /(captcha|verify|verification|security|安全验证|验证码)/i.test(`${candidate.url || ""} ${candidate.title || ""}`);
          } catch {
            return false;
          }
        });
        if (verificationTab?.id) {
          if (!request.waitVerification || Date.now() >= deadline - 2000) {
            return { captureStatus: "blocked_verification", errorCode: "ANJUKE_DETAIL_VERIFICATION_REQUIRED", text: "", html: "", title: "", location: "", pageUrl: "" };
          }
          await focusTab(verificationTab.id);
          setMessage(elements.anjukePropertyResultMessage, "安居客验证页已在浏览器中聚焦：请完成滑块验证（也可以关闭该验证标签页），脚本会继续等待。", "warn");
          renderProgress({ phase: "capturing", percent: 12, message: `等待安居客验证完成…（${remainingText()}）` });
          runControl.verificationWaitUsedMs = (runControl.verificationWaitUsedMs || 0) + 2000;
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          continue;
        }
        let result;
        try {
          result = await context.chrome.scripting.executeScript({ target: { tabId }, func: readAnjukeDetailTab });
        } catch (error) {
          // 注入失败多半是导航中又被跳到无权限的 58 验证页：转回验证等待而不是记失败。
          const redirected = await waitForVerificationIfRedirected(tabId, request, deadline);
          if (redirected) return redirected;
          return { captureStatus: "read_failed", errorCode: `ANJUKE_INJECT_FAILED:${String(error?.message || error || "").slice(0, 100)}`, text: "", html: "", title: "", location: "", pageUrl: "" };
        }
        const detail = result?.result;
        if (detail?.verificationRequired) {
          if (!request.waitVerification || Date.now() >= deadline - 2000) {
            return { captureStatus: "blocked_verification", errorCode: "ANJUKE_DETAIL_VERIFICATION_REQUIRED", ...detail };
          }
          await focusTab(tabId);
          setMessage(elements.anjukePropertyResultMessage, "安居客要求验证：已在浏览器中聚焦当前标签页，请完成滑块验证，脚本会继续等待。", "warn");
          renderProgress({ phase: "capturing", percent: 12, message: `详情页需要验证，请在已聚焦的标签页完成验证…（${remainingText()}）` });
          runControl.verificationWaitUsedMs = (runControl.verificationWaitUsedMs || 0) + 2000;
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          continue;
        }
        if (!isAnjukeDetailUrl(detail?.pageUrl)) {
          return { captureStatus: "not_case", errorCode: "ANJUKE_DETAIL_ROUTE_INVALID", ...detail };
        }
        if (!detail?.detailAvailable) {
          if (Date.now() < contentSettleDeadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            continue;
          }
          const status = detail?.errorCode === "ANJUKE_DETAIL_VERIFICATION_REQUIRED" ? "blocked_verification" : "not_case";
          return { captureStatus: status, errorCode: detail?.errorCode || "ANJUKE_DETAIL_PAGE_NOT_CASE", ...detail };
        }
        if (detail?.text || detail?.html) return { captureStatus: "ok", errorCode: "", ...detail };
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      return { captureStatus: "blocked_verification", errorCode: "ANJUKE_DETAIL_VERIFICATION_TIMEOUT", text: "", html: "", title: "", location: "", pageUrl: "" };
    }

    async function restoreListingPage(tabId, request) {
      try {
        await context.chrome.tabs.update(tabId, { url: request.currentUrl });
        await waitForTabLoaded(tabId, 30000);
        const [readback] = await context.chrome.scripting.executeScript({
          target: { tabId },
          func: readRestoredListingUrl,
        });
        const restored = String(readback?.result || "");
        return restored.startsWith(request.currentUrl) ? "restored" : "restore_failed";
      } catch {
        return "restore_failed";
      }
    }

    async function captureCurrentTab(request) {
      const [tab] = await context.chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeUrl = normalizeAnjukeUrl(tab?.url);
      if (!tab?.id || !activeUrl) throw new Error("当前标签页不是可用的安居客网页。");
      if (activeUrl !== request.currentUrl) throw new Error("当前标签页网址已变化，请重新点击“导入当前网址”。");
      if (!isAnjukeListingUrl(activeUrl)) throw new Error("ANJUKE_LIST_PAGE_REQUIRED");
      if (request.screenshot) throw new Error("当前浏览器标签页模式暂不支持详情页全页截图，请取消勾选“保存全页截图”。");
      const deadline = Date.now() + (request.waitVerification ? request.verificationTimeout * 1000 : 0);
      while (true) {
        const [result] = await context.chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: captureAnjukeCurrentTab,
          args: [{ maxCases: request.maxCases, keyword: request.keyword }],
        });
        const capture = result?.result;
        if (capture === undefined) {
          throw new Error(`ANJUKE_INJECT_SCRIPT_FAILED:${String(result?.error || "页面脚本无返回，请重试或更换列表页").slice(0, 160)}`);
        }
        if (capture?.ok) {
          const outcomes = [];
          let stopped = false;
          let restoreStatus = "skipped";
          try {
            for (const [index, detailUrl] of capture.detailUrls.entries()) {
              await waitWhilePaused();
              if (runControl.stopRequested) {
                stopped = true;
                break;
              }
              if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, DETAIL_DELAY_MS));
              let outcome;
              try {
                await context.chrome.tabs.update(tab.id, { url: detailUrl });
                await waitForTabLoaded(tab.id);
                outcome = await readDetailOutcome(tab.id, request);
              } catch (error) {
                outcome = { captureStatus: "read_failed", errorCode: String(error?.message || error || "ANJUKE_DETAIL_READ_FAILED").slice(0, 120) };
              }
              outcomes.push({ url: detailUrl, ...outcome });
              const counts = outcomeCounts(outcomes);
              renderProgress({
                phase: "capturing",
                percent: 8 + Math.round((index + 1) / capture.detailUrls.length * 80),
                fetched: capture.detailUrls.length,
                written: counts.written,
                skipped: counts.skipped,
                blocked: counts.blocked,
                message: `已处理详情 ${index + 1}/${capture.detailUrls.length}；有效 ${counts.written}，跳过 ${counts.skipped}，验证阻断 ${counts.blocked}。`,
              });
            }
          } finally {
            renderProgress({ phase: "writing", percent: 92, message: "正在恢复安居客列表页…" });
            restoreStatus = await restoreListingPage(tab.id, request);
            if (restoreStatus === "restore_failed") {
              setMessage(elements.anjukePropertyResultMessage, "列表页恢复失败，请手动返回安居客列表页。", "warn");
            }
          }
          const runStatus = stopped
            ? "stopped"
            : (outcomes.length && outcomes.every((item) => item.captureStatus === "ok") ? "complete" : "partial");
          return { tab, capture: { outcomes, runStatus, restoreStatus } };
        }
        if (!capture?.verificationRequired || Date.now() >= deadline) {
          throw new Error(capture?.reason || capture?.errorCode || "ANJUKE_CURRENT_TAB_CAPTURE_FAILED");
        }
        setMessage(elements.anjukePropertyResultMessage, "请在当前安居客标签页完成验证，脚本会继续等待，不会关闭页面。", "warn");
        renderProgress({ phase: "capturing", percent: 5, fetched: 0, written: 0, skipped: 0, blocked: 0, message: "等待当前标签页完成安居客验证…" });
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
    }

    async function run() {
      if (running) return;
      if (!parametersApplied()) {
        setMessage(elements.anjukePropertyParameterMessage, "参数有改动，请先点击“确认并应用参数”。", "warn");
        return;
      }
      running = true;
      runControl = { paused: false, stopRequested: false, resumeResolvers: [], verificationWaitUsedMs: 0 };
      renderRunButtons();
      renderProgress({ phase: "opening", percent: 1, fetched: 0, written: 0, skipped: 0, blocked: 0, message: "正在读取当前安居客标签页…" });
      setMessage(elements.anjukePropertyResultMessage, "抓取将在当前浏览器标签页中执行；遇到验证会等待人工完成。", "warn");
      context.setStatus("安居客脚本正在运行", "busy");
      try {
        const { tab, capture } = await captureCurrentTab({ ...appliedConfig, listUrls: [appliedConfig.currentUrl], detailUrls: [] });
        const counts = outcomeCounts(capture.outcomes);
        renderProgress({ phase: "writing", percent: 94, ...counts, message: `已处理 ${counts.fetched} 个候选，正在生成输出与证据索引…` });
        const request = {
          ...appliedConfig,
          listUrls: [appliedConfig.currentUrl],
          detailUrls: [],
          tabId: tab.id,
          candidateOutcomes: capture.outcomes,
          runStatus: capture.runStatus,
          restoreStatus: capture.restoreStatus || "skipped",
        };
        const result = await context.streamNativeMessage({ action: "run_anjuke_property", request }, (progress) => renderProgress(progress));
        if (!result?.ok) throw new Error(result?.reason || result?.errorCode || "ANJUKE_CAPTURE_FAILED");
        results = Array.isArray(result.results) ? result.results : [];
        paths = parseResultPaths(result);
        config = normalizeConfig({ ...config, ...appliedConfig });
        renderProgress({ phase: "completed", percent: 100, ...counts, message: result.status === "partial" || result.status === "stopped" ? "部分完成：结果与证据索引已保留。" : "抓取完成，输出文件回读通过。" });
        await context.storage.save(state());
        renderConfig();
        renderResults();
        if (config.autoOpenResult && paths.resultHtmlPath) {
          await openPath(paths.resultHtmlPath, "结果页", { quiet: true });
        }
        const skippedNote = counts.skipped ? `跳过 ${counts.skipped} 条` : "";
        const blockedNote = counts.blocked ? `验证阻断 ${counts.blocked} 条` : "";
        const restoreNote = result.restoreStatus === "restore_failed" ? "；列表页恢复失败，请手动返回。" : "";
        const headline = result.status === "stopped"
          ? `已终止：保留 ${results.length} 条已完成结果。`
          : result.status === "partial"
            ? `部分完成：有效 ${results.length} 条。`
            : `已完成 ${results.length} 条。`;
        const details = [skippedNote, blockedNote].filter(Boolean).join("，");
        setMessage(
          elements.anjukePropertyResultMessage,
          `${headline}${details ? `（${details}）` : ""}结果页、地图、Excel、CSV、JSON、证据索引和原始 HTML 已写入本机。${restoreNote}`,
          result.status === "complete" ? (counts.skipped || counts.blocked ? "warn" : "ok") : "warn",
        );
        context.setStatus(`安居客抓取${result.status === "complete" ? "完成" : "部分完成"}：${results.length} 条`, result.status === "complete" ? "ok" : "warn");
      } catch (error) {
        renderProgress({ phase: "failed", percent: 0, message: "抓取失败" });
        setMessage(elements.anjukePropertyResultMessage, `抓取未完成：${error?.message || String(error)}`, "error");
        context.setStatus("安居客抓取失败", "error");
      } finally {
        running = false;
        runControl = { paused: false, stopRequested: false, resumeResolvers: [], verificationWaitUsedMs: 0 };
        renderRunButtons();
      }
    }

    async function openPath(value, label, options = {}) {
      if (!value) return;
      const result = await context.sendNativeMessage({ action: "open_anjuke_property_path", path: value, outputDirectory: config.outputDirectory }, 15000);
      if (options.quiet && result?.ok) return;
      setMessage(elements.anjukePropertyResultMessage, result?.ok ? `已打开${label}。` : `${label}打开失败：${result?.reason || "未知错误"}`, result?.ok ? "ok" : "error");
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("ANJUKE_PROPERTY_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = anjukePropertyTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/anjuke-property/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        const stored = await context.storage.load({});
        config = normalizeConfig({ ...stored, userDataDir: stored.userDataDir || DEFAULT_PROFILE_PATH });
        appliedConfig = stored?.appliedConfig && typeof stored.appliedConfig === "object" ? normalizeConfig({ ...stored.appliedConfig, userDataDir: config.userDataDir }) : null;
        results = Array.isArray(stored?.results) ? stored.results : [];
        paths = { excelPath: String(stored?.excelPath || ""), csvPath: String(stored?.csvPath || ""), htmlDirectory: String(stored?.htmlDirectory || ""), resultHtmlPath: String(stored?.resultHtmlPath || ""), mapPath: String(stored?.mapPath || "") };
        renderConfig();
        renderResults();
        renderRunButtons();
        context.scope.on(elements.openAnjukeProperty, "click", () => context.navigate("anjuke-property"));
        context.scope.on(elements.backFromAnjukeProperty, "click", () => context.navigate("home"));
        context.scope.on(elements.importAnjukePropertyCurrentUrl, "click", importCurrentUrl);
        context.scope.on(elements.openAnjukePropertySource, "click", openSource);
        context.scope.on(elements.chooseAnjukePropertyOutput, "click", chooseOutput);
        context.scope.on(elements.applyAnjukePropertyParams, "click", applyParameters);
        context.scope.on(elements.runAnjukeProperty, "click", run);
        context.scope.on(elements.pauseAnjukeProperty, "click", togglePause);
        context.scope.on(elements.stopAnjukeProperty, "click", stopCapture);
        context.scope.on(elements.openAnjukePropertyExcel, "click", () => openPath(paths.excelPath, "Excel"));
        context.scope.on(elements.openAnjukePropertyCsv, "click", () => openPath(paths.csvPath, "CSV"));
        context.scope.on(elements.openAnjukePropertyHtml, "click", () => openPath(paths.htmlDirectory, "证据目录"));
        context.scope.on(elements.openAnjukePropertyResult, "click", () => openPath(paths.resultHtmlPath, "结果页"));
        context.scope.on(elements.openAnjukePropertyMap, "click", () => openPath(paths.mapPath, "地图"));
        context.scope.on(elements.resetAnjukePropertyParams, "click", async () => {
          config = normalizeConfig({ ...DEFAULT_CONFIG, outputDirectory: config.outputDirectory, userDataDir: config.userDataDir });
          appliedConfig = null;
          await context.storage.save(state());
          renderConfig();
          setMessage(elements.anjukePropertyParameterMessage, "已恢复默认参数；请重新导入安居客列表页并应用。", "warn");
        });
        context.scope.on(elements.clearAnjukePropertyResults, "click", async () => {
          results = [];
          paths = { excelPath: "", csvPath: "", htmlDirectory: "", resultHtmlPath: "", mapPath: "" };
          await context.storage.save(state());
          renderResults();
          setMessage(elements.anjukePropertyResultMessage, "已清空本地结果记录，原始文件未自动删除。", "ok");
        });
        for (const id of ["anjukePropertyCaseType", "anjukePropertyMaxCases", "anjukePropertyKeyword", "anjukePropertyWaitVerification", "anjukePropertyScreenshot", "anjukePropertyAutoOpenResult"]) {
          context.scope.on(elements[id], "input", () => {
            config = readConfig();
            renderParameterState();
          });
          context.scope.on(elements[id], "change", () => {
            config = readConfig();
            renderParameterState();
          });
        }
      },
      activate() { renderConfig(); renderResults(); renderRunButtons(); },
      deactivate() {},
      dispose() {},
    };
  },
};
