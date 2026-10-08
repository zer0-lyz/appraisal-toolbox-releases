import { landPublicityTemplate } from "./template.js";

const FIXED_TRADE_FORM = "国有土地";
const FIXED_TRADE_METHODS = ["挂牌出让", "拍卖出让"];
const FIXED_TRADE_STAGES = ["结果公示"];

const DEFAULT_CONFIG = {
  tradeForm: FIXED_TRADE_FORM,
  tradeMethods: [...FIXED_TRADE_METHODS],
  tradeStages: [...FIXED_TRADE_STAGES],
  district: "",
  county: "",
  provinceWide: false,
  location: "",
  landUses: [],
  startDate: "",
  endDate: "",
  districtExact: false,
  generateMap: true,
  maxPages: "200",
  outputDirectory: "",
  historyDirectory: "",
  historyPath: "",
  historyRefresh: true,
};

function elementMap(documentRef) {
  const ids = [
    "openLandPublicity", "backFromLandPublicity", "landPublicityDistrict", "landPublicityCounty", "landPublicityLocation",
    "landPublicityStartDate", "landPublicityEndDate",
    "landPublicityGenerateMap", "landPublicityOutputDirectory", "chooseLandPublicityOutput", "landPublicityHistoryDirectory", "chooseLandPublicityHistoryDirectory", "loadLandPublicityHistoryCatalog", "landPublicityHistorySelect", "loadLandPublicityHistory", "landPublicityRefreshHistory", "landPublicityHistoryStatus", "clearLandPublicityFilters", "runLandPublicity", "runLandPublicityHistory",
    "reloadLandPublicityRegions", "landPublicityRegionStatus",
    "openLandPublicityHtml", "openLandPublicityExcel", "openLandPublicityMap", "landPublicityProgressText",
    "landPublicityProgressPercent", "landPublicityProgressBar", "landPublicityFetchedCount", "landPublicityFilteredCount",
    "landPublicityWrittenCount", "landPublicityResultMessage",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function checkedValues(root, name) {
  return [...root.querySelectorAll(`input[name="${name}"]:checked`)]
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function setCheckedValues(root, name, values) {
  const selected = new Set(Array.isArray(values) ? values : []);
  root.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
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

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_CONFIG,
    tradeForm: FIXED_TRADE_FORM,
    tradeMethods: [...FIXED_TRADE_METHODS],
    tradeStages: [...FIXED_TRADE_STAGES],
    district: String(source.district || "").trim(),
    county: String(source.county || "").trim(),
    provinceWide: source.provinceWide === true,
    location: String(source.location || "").trim(),
    landUses: Array.isArray(source.landUses) ? source.landUses : [],
    startDate: String(source.startDate || "").trim(),
    endDate: String(source.endDate || "").trim(),
    districtExact: source.districtExact === true,
    generateMap: source.generateMap !== false,
    maxPages: "200",
    outputDirectory: String(source.outputDirectory || "").trim(),
    historyDirectory: String(source.historyDirectory || "").trim(),
    historyPath: String(source.historyPath || "").trim(),
    historyRefresh: source.historyRefresh !== false,
    // 数据源健康状态只来自真实请求结果，持久化以便下次打开先展示最近一次检查结论。
    dataSourceStatus: ["ok", "unavailable"].includes(source.dataSourceStatus) ? source.dataSourceStatus : "",
    dataSourceCheckedAt: String(source.dataSourceCheckedAt || "").trim(),
  };
}

function filterConditionSummary(request) {
  const conditions = [];
  if (request.provinceWide) {
    conditions.push("行政区=全省/不限制行政区");
  } else if (request.district) {
    conditions.push(`行政区=${request.district}`);
  }
  if (!request.provinceWide && request.county) conditions.push(`区县=${request.county}`);
  if (request.location) conditions.push(`位置关键词=${request.location}`);
  conditions.push(`交易形式=${FIXED_TRADE_FORM}`);
  conditions.push(`交易方式=${FIXED_TRADE_METHODS.join("、")}`);
  conditions.push(`交易阶段=${FIXED_TRADE_STAGES.join("、")}`);
  if (request.landUses?.length) conditions.push(`土地用途=${request.landUses.join("、")}`);
  if (request.startDate || request.endDate) conditions.push(`官网查询日期=${request.startDate || "不限"}至${request.endDate || "不限"}`);
  conditions.push("抓取页数上限=50");
  return conditions.join("；") || "未设置额外筛选条件";
}

export const landPublicityModule = {
  manifest: {
    id: "land-publicity",
    type: "feature",
    stage: "stable",
    route: "land-publicity",
    displayName: "浙江土地市场网",
    messageNamespace: "land-publicity",
    entryElementId: "openLandPublicity",
    pageElementId: "page-land-publicity",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let root;
    let elements;
    let config = { ...DEFAULT_CONFIG };
    let lastResult = null;
    let running = false;
    let regionCatalog = [];
    let regionLoading = null;
    let historyCatalog = [];
    let historyCanRefresh = false;

    function regionRoots() {
      const province = regionCatalog.find((item) => item.name === "浙江省" || item.code === "330000");
      return province?.children?.length ? province.children : regionCatalog;
    }

    function selectedCityRegion() {
      return regionRoots().find((item) => item.name === config.district) || null;
    }

    function setRegionStatus(text, kind = "") {
      if (!elements?.landPublicityRegionStatus) return;
      elements.landPublicityRegionStatus.textContent = text;
      elements.landPublicityRegionStatus.dataset.kind = kind;
    }

    function renderRegionOptions() {
      const district = elements?.landPublicityDistrict;
      const county = elements?.landPublicityCounty;
      if (!district || !county) return;
      const cities = regionRoots();
      if (cities.length) {
        district.innerHTML = `<option value="">请选择地市（可不选）</option>${cities.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}`;
        district.value = cities.some((item) => item.name === config.district) ? config.district : "";
      }
      const city = selectedCityRegion();
      const counties = city?.children || [];
      county.innerHTML = `<option value="">${city ? "请选择区县（可不选）" : "请先选择地市"}</option>${counties.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}`;
      county.disabled = !city;
      county.value = counties.some((item) => item.name === config.county) ? config.county : "";
    }

    // 首页健康状态：只由真实请求结果驱动（行政区/列表任一成功→ok；任一失败→unavailable）。
    // 初始渲染使用上一次真实检查的持久化结果，不做静态假设。
    function renderHealthMarker() {
      const marker = context.document.getElementById("landPublicityHealth");
      if (!marker) return;
      const status = config.dataSourceStatus;
      const checkedAt = config.dataSourceCheckedAt
        ? new Date(config.dataSourceCheckedAt).toLocaleTimeString("zh-CN", { hour12: false })
        : "";
      if (status === "ok") {
        marker.hidden = false;
        marker.dataset.kind = "ok";
        marker.textContent = `数据源正常${checkedAt ? `（${checkedAt} 检查）` : ""}`;
      } else if (status === "unavailable") {
        marker.hidden = false;
        marker.dataset.kind = "warn";
        marker.textContent = `数据源异常${checkedAt ? `（${checkedAt} 检查）` : ""}，进入模块重试`;
      } else {
        marker.hidden = true;
        marker.textContent = "";
      }
    }

    function recordDataSourceStatus(status, reason = "") {
      config.dataSourceStatus = status;
      config.dataSourceCheckedAt = new Date().toISOString();
      renderHealthMarker();
      void context.storage.save({ ...config });
      if (status === "unavailable") {
        console.warn(`land-publicity data source unavailable: ${reason}`);
      }
    }

    async function loadRegionCatalog() {
      if (regionLoading) return regionLoading;
      setRegionStatus("正在从浙江土地市场网加载行政区…");
      regionLoading = context.sendNativeMessage({ action: "list_land_publicity_regions" }, 25000)
        .then((result) => {
          if (!result?.ok || !Array.isArray(result.regions) || !result.regions.length) throw new Error(result?.reason || "LAND_REGION_CATALOG_EMPTY");
          regionCatalog = result.regions;
          renderRegionOptions();
          setRegionStatus(`已加载 ${regionRoots().length} 个地市，可继续选择区县。`, "ok");
          recordDataSourceStatus("ok");
          return result;
        })
        .catch((error) => {
          renderRegionOptions();
          setRegionStatus(`行政区加载失败：${error?.message || String(error)}；可点击“刷新行政区”重试。`, "error");
          recordDataSourceStatus("unavailable", error?.message || String(error));
          return null;
        })
        .finally(() => { regionLoading = null; });
      return regionLoading;
    }

    function readConfig() {
      const next = {
        ...DEFAULT_CONFIG,
        tradeForm: FIXED_TRADE_FORM,
        tradeMethods: [...FIXED_TRADE_METHODS],
        tradeStages: [...FIXED_TRADE_STAGES],
        district: elements.landPublicityDistrict.value.trim(),
        county: elements.landPublicityCounty.value.trim(),
        provinceWide: false,
        location: elements.landPublicityLocation.value.trim(),
        landUses: checkedValues(root, "landUse"),
        startDate: elements.landPublicityStartDate.value,
        endDate: elements.landPublicityEndDate.value,
        districtExact: false,
        generateMap: elements.landPublicityGenerateMap.checked,
        maxPages: "200",
        outputDirectory: elements.landPublicityOutputDirectory.value.trim(),
        historyDirectory: elements.landPublicityHistoryDirectory.value.trim(),
        historyPath: elements.landPublicityHistorySelect.value.trim(),
        historyRefresh: elements.landPublicityRefreshHistory.checked,
      };
      return next;
    }

    function renderConfig() {
      setCheckedValues(root, "landUse", config.landUses);
      renderRegionOptions();
      elements.landPublicityDistrict.value = config.district || "";
      elements.landPublicityCounty.value = config.county || "";
      elements.landPublicityLocation.value = config.location || "";
      elements.landPublicityStartDate.value = config.startDate || "";
      elements.landPublicityEndDate.value = config.endDate || "";
      elements.landPublicityGenerateMap.checked = Boolean(config.generateMap);
      elements.landPublicityOutputDirectory.value = config.outputDirectory || "";
      elements.landPublicityHistoryDirectory.value = config.historyDirectory || config.outputDirectory || "";
      elements.landPublicityRefreshHistory.checked = config.historyRefresh !== false;
      renderHistoryOptions();
      if (!running) elements.runLandPublicityHistory.disabled = !config.historyPath || !historyCanRefresh;
      elements.landPublicityCounty.disabled = !selectedCityRegion();
    }

    function renderHistoryOptions() {
      const select = elements?.landPublicityHistorySelect;
      if (!select) return;
      const selected = config.historyPath || "";
      select.innerHTML = `<option value="">请选择历史抓取清单</option>${historyCatalog.map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(item.label || item.name || item.path)}</option>`).join("")}`;
      select.value = historyCatalog.some((item) => item.path === selected) ? selected : "";
    }

    function validateLocal(next) {
      if (!next.outputDirectory) throw new Error("请先选择本机输出目录");
      if (next.startDate && next.endDate && next.startDate > next.endDate) throw new Error("官网查询起始日期不能晚于结束日期");
      const provinceWide = !next.district && !next.county && !next.location;
      const districtExact = Boolean(next.county);
      return {
        ...next,
        district: provinceWide ? "" : next.district,
        county: provinceWide ? "" : next.county,
        districtExact,
        provinceWide,
        tradeForm: FIXED_TRADE_FORM,
        tradeMethods: [...FIXED_TRADE_METHODS],
        tradeStages: [...FIXED_TRADE_STAGES],
        maxPages: 200,
      };
    }

    function renderProgress(payload = {}) {
      const percent = Math.max(0, Math.min(100, Number(payload.percent || 0)));
      elements.landPublicityProgressBar.style.width = `${percent}%`;
      elements.landPublicityProgressPercent.textContent = `${percent}%`;
      if (payload.message) elements.landPublicityProgressText.textContent = payload.message;
      if (payload.fetched !== undefined) elements.landPublicityFetchedCount.textContent = String(payload.fetched);
      if (payload.filtered !== undefined) elements.landPublicityFilteredCount.textContent = String(payload.filtered);
      if (payload.written !== undefined) elements.landPublicityWrittenCount.textContent = String(payload.written);
    }

    function setResultButtons(result) {
      lastResult = result || null;
      elements.openLandPublicityHtml.disabled = !result?.htmlPath;
      elements.openLandPublicityExcel.disabled = !result?.excelPath;
      elements.openLandPublicityMap.disabled = !result?.mapPath;
    }

    async function openResultPath(path, label) {
      if (!path) return;
      try {
        const result = await context.sendNativeMessage({ action: "open_land_publicity_path", path }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "打开失败");
        context.setStatus(`${label}已打开`, "ok");
      } catch (error) {
        context.setStatus(`${label}打开失败：${error?.message || String(error)}`, "error");
      }
    }

    async function chooseOutputDirectory() {
      try {
        const result = await context.sendNativeMessage({ action: "select_land_publicity_output_directory" }, 130000);
        const selected = result?.outputDirectory || result?.path || result?.paths?.[0] || "";
        if (!result?.ok || !selected) {
          if (!result?.cancelled) setMessage(elements.landPublicityResultMessage, result?.reason || "未选择输出目录", "warn");
          return;
        }
        config.outputDirectory = selected;
        if (!config.historyDirectory) config.historyDirectory = selected;
        elements.landPublicityOutputDirectory.value = selected;
        await context.storage.save(config);
        const folderMessage = result.directoryName
          ? `${result.createdDirectory === false ? "已选择" : "已创建并选择"}专用子文件夹：${result.directoryName}`
          : "输出目录已选择";
        setMessage(elements.landPublicityResultMessage, `${folderMessage}，请检查参数后开始抓取`, "ok");
      } catch (error) {
        setMessage(elements.landPublicityResultMessage, `选择目录失败：${error?.message || String(error)}`, "error");
      }
    }

    function pathDirectory(value) {
      const raw = String(value || "");
      const index = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
      return index > 0 ? raw.slice(0, index) : raw;
    }

    async function chooseHistoryDirectory() {
      try {
        const result = await context.sendNativeMessage({ action: "select_land_publicity_history_directory" }, 130000);
        const selected = result?.path || result?.paths?.[0] || "";
        if (!result?.ok || !selected) {
          if (!result?.cancelled) setMessage(elements.landPublicityResultMessage, result?.reason || "未选择历史数据目录", "warn");
          return;
        }
        config.historyDirectory = selected;
        config.historyPath = "";
        historyCatalog = [];
        historyCanRefresh = false;
        renderConfig();
        await context.storage.save(config);
        await loadHistoryCatalog();
      } catch (error) {
        setMessage(elements.landPublicityResultMessage, `选择历史目录失败：${error?.message || String(error)}`, "error");
      }
    }

    async function loadHistoryCatalog() {
      const directory = elements.landPublicityHistoryDirectory.value.trim() || config.historyDirectory || config.outputDirectory;
      if (!directory) {
        setMessage(elements.landPublicityResultMessage, "请先选择历史数据目录", "warn");
        return;
      }
      try {
        const result = await context.sendNativeMessage({ action: "list_land_publicity_history", directory }, 30000);
        if (!result?.ok) throw new Error(result?.reason || "LAND_HISTORY_LIST_FAILED");
        historyCatalog = Array.isArray(result.items) ? result.items : [];
        config.historyDirectory = directory;
        historyCanRefresh = Boolean(historyCatalog.find((item) => item.path === config.historyPath)?.canRefresh);
        renderHistoryOptions();
        elements.landPublicityHistoryStatus.textContent = historyCatalog.length ? `已找到 ${historyCatalog.length} 份历史数据，可选择后加载。` : "当前目录未找到历史清单或旧结果文件。";
        elements.landPublicityHistoryStatus.dataset.kind = historyCatalog.length ? "ok" : "warn";
        await context.storage.save(config);
      } catch (error) {
        historyCatalog = [];
        renderHistoryOptions();
        elements.landPublicityHistoryStatus.textContent = `历史清单加载失败：${error?.message || String(error)}`;
        elements.landPublicityHistoryStatus.dataset.kind = "error";
      }
    }

    async function loadHistorySelection() {
      const historyPath = elements.landPublicityHistorySelect.value.trim();
      if (!historyPath) {
        setMessage(elements.landPublicityResultMessage, "请先选择历史抓取清单", "warn");
        return;
      }
      try {
        const result = await context.sendNativeMessage({ action: "load_land_publicity_history", path: historyPath }, 30000);
        if (!result?.ok) throw new Error(result?.reason || "LAND_HISTORY_LOAD_FAILED");
        historyCanRefresh = result.canRefresh === true;
        config = normalizeConfig({ ...config, ...(result.request || {}), outputDirectory: result.outputDirectory || config.outputDirectory, historyDirectory: pathDirectory(historyPath), historyPath, historyRefresh: historyCanRefresh && elements.landPublicityRefreshHistory.checked });
        renderConfig();
        setResultButtons(result);
        renderProgress({ percent: 100, message: `已加载历史数据：${result.recordCount || 0} 条`, fetched: result.fetchedCount || result.recordCount || 0, filtered: result.filteredCount || result.recordCount || 0, written: result.writtenCount || result.recordCount || 0 });
        setMessage(elements.landPublicityResultMessage, "已加载历史结果；当前操作不会访问网络。需要更新详情时，请在历史数据区勾选并点击“重新抓取历史详情”。", "ok");
        await context.storage.save(config);
      } catch (error) {
        setMessage(elements.landPublicityResultMessage, `历史数据加载失败：${error?.message || String(error)}`, "error");
      }
    }

    async function clearFilters() {
      if (running) return;
      const outputDirectory = elements.landPublicityOutputDirectory.value.trim() || config.outputDirectory || "";
      config = normalizeConfig({ outputDirectory, historyDirectory: elements.landPublicityHistoryDirectory.value.trim() || config.historyDirectory });
      historyCanRefresh = false;
      renderConfig();
      setResultButtons(null);
      renderProgress({ percent: 0, message: "筛选已清空，尚未运行", fetched: 0, filtered: 0, written: 0 });
      setMessage(elements.landPublicityResultMessage, outputDirectory ? "筛选已清空；输出目录已保留。" : "筛选已清空；请先选择输出目录。", outputDirectory ? "ok" : "warn");
      try {
        await context.storage.save(config);
      } catch (error) {
        setMessage(elements.landPublicityResultMessage, `清空后保存失败：${error?.message || String(error)}`, "error");
      }
    }

    async function run(mode = "network") {
      if (running) return;
      let savedConfig;
      try {
        savedConfig = validateLocal(readConfig());
        if (mode === "history" && !savedConfig.historyPath) throw new Error("请先在历史数据区加载一份历史清单");
        if (mode === "history" && !savedConfig.historyRefresh) throw new Error("请勾选“重新抓取历史记录详情”后再执行");
      } catch (error) {
        setMessage(elements.landPublicityResultMessage, error?.message || String(error), "error");
        context.setStatus(`土地公示参数无效：${error?.message || String(error)}`, "error");
        return;
      }
      const request = mode === "history"
        ? savedConfig
        : { ...savedConfig, historyPath: "", historyRefresh: false };
      config = normalizeConfig(savedConfig);
      renderConfig();
      await context.storage.save(config);
      running = true;
      setResultButtons(null);
      elements.runLandPublicity.disabled = true;
      elements.runLandPublicityHistory.disabled = true;
      const operationLabel = mode === "history" ? "历史详情重新抓取" : "网络列表抓取";
      renderProgress({ percent: 1, message: `正在准备${operationLabel}`, fetched: 0, filtered: 0, written: 0 });
      setMessage(elements.landPublicityResultMessage, mode === "history" ? "已进入历史详情重新抓取；此操作会访问网络，但不会重新读取列表。" : "已进入网络抓取；将按当前筛选条件读取官网列表。", "");
      context.setStatus(mode === "history" ? "正在重新抓取历史详情…" : "正在抓取浙江土地市场网…", "idle");
      try {
        const result = await context.streamNativeMessage({ action: "run_land_publicity", request }, (progress) => {
          renderProgress(progress);
          context.setStatus(progress.message || "土地公示处理中…", "idle");
        });
        if (!result?.ok) throw new Error(result?.reason || "LAND_PUBLICITY_RUN_FAILED");
        renderProgress({ ...result, fetched: result.fetchedCount, filtered: result.filteredCount, written: result.writtenCount, message: `完成：已写出 ${result.writtenCount || 0} 条，结果文件回读通过` });
        setResultButtons(result);
        const writtenCount = Number(result.writtenCount || 0);
        const warningCount = (result.filterSummary?.warnings || []).length + (result.filterSummary?.unsupportedFilters || []).length;
        const filterSummary = filterConditionSummary(request);
        const emptySuggestion = writtenCount === 0
          ? `结果为 0 条。当前筛选条件：${filterConditionSummary(request)}。建议检查官网查询日期、行政区或位置关键词，以及接口是否返回记录。`
          : "";
        setMessage(elements.landPublicityResultMessage, `${mode === "history" ? "历史详情重新抓取完成" : "网络抓取完成"}：Excel ${writtenCount} 条；实际条件：${filterSummary}。无坐标 ${result.noCoordinateCount || 0} 条。${warningCount ? `有 ${warningCount} 项筛选限制已在结果页说明。` : ""}${emptySuggestion}`, warningCount || emptySuggestion ? "warn" : "ok");
        await openResultPath(result.htmlPath, "结果页");
        context.setStatus(`${mode === "history" ? "历史详情重新抓取" : "网络抓取"}完成，Excel/HTML 已回读`, "ok");
      } catch (error) {
        renderProgress({ percent: 0, message: `抓取失败：${error?.message || String(error)}` });
        setMessage(elements.landPublicityResultMessage, error?.message || String(error), "error");
        context.setStatus(`土地公示抓取失败：${error?.message || String(error)}`, "error");
      } finally {
        running = false;
        elements.runLandPublicity.disabled = false;
        elements.runLandPublicityHistory.disabled = !config.historyPath || !historyCanRefresh;
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("LAND_PUBLICITY_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = landPublicityTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/land-publicity/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        config = normalizeConfig(await context.storage.load({}));
        renderConfig();
        renderHealthMarker();
        context.scope.on(elements.openLandPublicity, "click", () => context.navigate("land-publicity"));
        context.scope.on(elements.backFromLandPublicity, "click", () => context.navigate("home"));
        context.scope.on(elements.chooseLandPublicityOutput, "click", chooseOutputDirectory);
        context.scope.on(elements.chooseLandPublicityHistoryDirectory, "click", chooseHistoryDirectory);
        context.scope.on(elements.loadLandPublicityHistoryCatalog, "click", loadHistoryCatalog);
        context.scope.on(elements.loadLandPublicityHistory, "click", loadHistorySelection);
        context.scope.on(elements.clearLandPublicityFilters, "click", clearFilters);
        context.scope.on(elements.reloadLandPublicityRegions, "click", loadRegionCatalog);
        context.scope.on(elements.landPublicityDistrict, "change", async () => {
          config.district = elements.landPublicityDistrict.value.trim();
          config.county = "";
          config.provinceWide = false;
          config.districtExact = false;
          renderRegionOptions();
          await context.storage.save({ ...config });
        });
        context.scope.on(elements.landPublicityCounty, "change", async () => {
          config.county = elements.landPublicityCounty.value.trim();
          config.provinceWide = false;
          config.districtExact = Boolean(config.county);
          await context.storage.save({ ...config });
        });
        context.scope.on(elements.runLandPublicity, "click", () => run("network"));
        context.scope.on(elements.runLandPublicityHistory, "click", () => run("history"));
        context.scope.on(elements.openLandPublicityHtml, "click", () => openResultPath(lastResult?.htmlPath, "结果页"));
        context.scope.on(elements.openLandPublicityExcel, "click", () => openResultPath(lastResult?.excelPath, "Excel"));
        context.scope.on(elements.openLandPublicityMap, "click", () => openResultPath(lastResult?.mapPath, "地图"));
        void loadRegionCatalog();
        if (config.historyDirectory || config.outputDirectory) void loadHistoryCatalog();
      },
      activate() { renderConfig(); if (!regionCatalog.length) void loadRegionCatalog(); },
      deactivate() {},
      dispose() {},
    };
  },
};
