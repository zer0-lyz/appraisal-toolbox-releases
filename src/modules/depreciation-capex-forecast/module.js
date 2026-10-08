import {
  ADDED_HEADERS,
  PARAM_FIELDS,
  STOCK_HEADERS,
  depreciationCapexTemplate,
} from "./template.js";

const ACTIONS = Object.freeze({
  prepare: "prepare",
  status: "status",
  selectWorkbook: "select",
  importWorkbook: "import",
  writeParameters: "write_params",
  preflight: "preflight",
  run: "run",
  results: "result",
  selectOutputDirectory: "select_output_directory",
  export: "export",
});

const NATIVE_ACTION = "depreciation_capex_forecast";

const MODULE_ID = "depreciation-capex-forecast";

function elementMap(documentRef) {
  const ids = [
    "openDepreciationCapex",
    "backFromDepreciation",
    "depreciationWorkbookPath",
    "depreciationStockCount",
    "depreciationAddedCount",
    "depreciationLastRun",
    "depreciationRunBadge",
    "depreciationStatusMessage",
    "importDepreciationWorkbook",
    "refreshDepreciationStatus",
    "downloadDepreciationTemplate",
    "depreciationValuationDate",
    "depreciationEndDate",
    "depreciationDiscountRate",
    "depreciationMinimumYears",
    "depreciationParameterMessage",
    "saveDepreciationParameters",
    "preflightDepreciation",
    "openDepreciationStock",
    "openDepreciationAdded",
    "depreciationWithDetails",
    "depreciationPreflightMessage",
    "runDepreciation",
    "openDepreciationResults",
    "openDepreciationDetails",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function nativeMessage(chromeApi, message, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Native Helper 请求超时，请检查本机运行环境"));
    }, timeoutMs);
    const operation = message.operation || message.action;
    const payload = { ...message, action: NATIVE_ACTION, operation };
    chromeApi.runtime.sendNativeMessage("com.tianyuan.workbench.helper", payload, (response) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      const error = chromeApi.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Native Helper 未响应"));
        return;
      }
      if (!response || response.ok === false) {
        reject(new Error(response?.message || response?.reason || "Native Helper 返回失败"));
        return;
      }
      resolve(response);
    });
  });
}

function safeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readParameters(elements) {
  return {
    valuationDate: safeDate(elements.depreciationValuationDate?.value),
    endDate: safeDate(elements.depreciationEndDate?.value),
    discountRate: safeNumber(elements.depreciationDiscountRate?.value),
    minimumRemainingYears: safeNumber(elements.depreciationMinimumYears?.value),
  };
}

function applyParameters(elements, values = {}) {
  const mapping = {
    valuationDate: elements.depreciationValuationDate,
    endDate: elements.depreciationEndDate,
    discountRate: elements.depreciationDiscountRate,
    minimumRemainingYears: elements.depreciationMinimumYears,
  };
  for (const field of PARAM_FIELDS) {
    const element = mapping[field.key];
    if (!element) continue;
    const value = values[field.key] ?? values[field.cell] ?? "";
    element.value = value === null || value === undefined ? "" : String(value);
  }
}

function statusText(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function statusKind(result) {
  if (result?.inputValid === false || result?.ok === false) return "error";
  if (result?.inputValid === true || result?.lastRun?.ok === true) return "ok";
  return "";
}

function renderStatus(elements, result = {}) {
  const workbook = result.workbook || result.currentWorkbook || {};
  elements.depreciationWorkbookPath.textContent = statusText(
    result.workbookPath || result.workbook_path || workbook.path || result.path,
  );
  const counts = result.counts || result.assetCounts || {};
  elements.depreciationStockCount.textContent = statusText(
    counts.stock ?? result.stockCount ?? result.stockRows,
  );
  elements.depreciationAddedCount.textContent = statusText(
    counts.added ?? counts.new ?? result.addedCount ?? result.addedRows,
  );
  const lastRun = result.lastRun || result.run || {};
  elements.depreciationLastRun.textContent = statusText(
    lastRun.finishedAt || lastRun.updatedAt || result.lastRunAt,
  );
  const label = lastRun.ok === true || result.lastRunOk === true
    ? "运行成功"
    : lastRun.ok === false || result.lastRunOk === false
      ? "运行失败"
      : "尚未运行";
  elements.depreciationRunBadge.textContent = label;
  elements.depreciationRunBadge.dataset.kind = statusKind(result);
  return result;
}

function setMessage(element, message, kind = "") {
  if (!element) return;
  element.textContent = message || "";
  element.dataset.kind = kind;
}

function listIssues(result) {
  const issues = result?.issues || result?.errors || result?.problems || [];
  if (!Array.isArray(issues)) return issues ? [issues] : [];
  return issues.map((issue) => {
    if (typeof issue === "string") return issue;
    const row = issue.row ? `第 ${issue.row} 行` : "";
    const field = issue.header || issue.field || issue.column || "";
    const prefix = [row, field].filter(Boolean).join(" / ");
    return `${prefix}${prefix ? "：" : ""}${issue.message || issue.reason || JSON.stringify(issue)}`;
  });
}

function renderPreflight(elements, result = {}) {
  const issues = listIssues(result);
  if (issues.length) {
    setMessage(elements.depreciationPreflightMessage, `发现 ${issues.length} 个问题：${issues.slice(0, 4).join("；")}`, "error");
    return false;
  }
  if (result.ok === false || result.inputValid === false) {
    setMessage(elements.depreciationPreflightMessage, result.message || "预检未通过，请先修正输入", "error");
    return false;
  }
  setMessage(elements.depreciationPreflightMessage, result.message || "预检通过。点击“运行预测”后还会弹出确认。", "ok");
  return true;
}

export const depreciationCapexModule = {
  manifest: {
    id: MODULE_ID,
    type: "feature",
    stage: "stable",
    route: MODULE_ID,
    displayName: "折旧摊销与资本性支出预测",
    messageNamespace: MODULE_ID,
    entryElementId: "openDepreciationCapex",
    pageElementId: "page-depreciation-capex-forecast",
    controlElementIds: [
      "openDepreciationStock",
      "openDepreciationAdded",
      "openDepreciationResults",
      "openDepreciationDetails",
    ],
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let lastPreflight = null;

    async function call(action, payload = {}, timeoutMs = 30_000) {
      return await nativeMessage(context.chrome, { action: NATIVE_ACTION, operation: action, ...payload }, timeoutMs);
    }

    async function refreshStatus() {
      try {
        const result = await call(ACTIONS.status, {}, 20_000);
        renderStatus(elements, result);
        applyParameters(elements, result.parameters || result.params || {});
        setMessage(elements.depreciationStatusMessage, result.message || "工作簿状态已更新", "ok");
        setMessage(elements.depreciationParameterMessage, "参数已从工作簿读取", "ok");
        return result;
      } catch (error) {
        setMessage(elements.depreciationStatusMessage, error.message, "error");
        return null;
      }
    }

    async function prepare() {
      try {
        const result = await call(ACTIONS.prepare, {}, 60_000);
        renderStatus(elements, result);
        applyParameters(elements, result.parameters || {});
        setMessage(elements.depreciationStatusMessage, result.message || "已准备本机工作副本", "ok");
        return result;
      } catch (error) {
        setMessage(elements.depreciationStatusMessage, error.message, "error");
        return null;
      }
    }

    async function importWorkbook() {
      try {
        const selected = await call(ACTIONS.selectWorkbook, {}, 130_000);
        const selectedPath = selected.path || selected.sourcePath;
        if (selected.cancelled || selected.canceled || !selectedPath) {
          setMessage(elements.depreciationStatusMessage, "已取消导入", "");
          return;
        }
        const result = await call(ACTIONS.importWorkbook, { sourcePath: selectedPath, path: selectedPath }, 60_000);
        renderStatus(elements, result);
        applyParameters(elements, result.parameters || {});
        setMessage(elements.depreciationStatusMessage, result.message || "已导入为本机安全工作副本", "ok");
      } catch (error) {
        setMessage(elements.depreciationStatusMessage, error.message, "error");
      }
    }

    async function saveParameters() {
      const parameters = readParameters(elements);
      if (!parameters.valuationDate || !parameters.endDate || parameters.discountRate === null || parameters.minimumRemainingYears === null) {
        setMessage(elements.depreciationParameterMessage, "请完整填写四项参数", "error");
        return;
      }
      if (parameters.endDate < parameters.valuationDate) {
        setMessage(elements.depreciationParameterMessage, "结束日期不能早于评估基准日", "error");
        return;
      }
      try {
        const result = await call(ACTIONS.writeParameters, {
          parameters,
          values: {
            评估基准日: parameters.valuationDate,
            结束日期: parameters.endDate,
            折现率: parameters.discountRate,
            最低尚可使用年限: parameters.minimumRemainingYears,
          },
        }, 30_000);
        setMessage(elements.depreciationParameterMessage, result.message || "参数已写入当前工作簿", "ok");
        await refreshStatus();
      } catch (error) {
        setMessage(elements.depreciationParameterMessage, error.message, "error");
      }
    }

    async function preflight() {
      try {
        const result = await call(ACTIONS.preflight, {}, 60_000);
        lastPreflight = result;
        renderPreflight(elements, result);
        return result;
      } catch (error) {
        lastPreflight = null;
        setMessage(elements.depreciationPreflightMessage, error.message, "error");
        return null;
      }
    }

    async function run() {
      const result = await preflight();
      if (!result || !renderPreflight(elements, result)) return;
      const confirmed = globalThis.confirm("预检已通过。确认调用 bundled Python 引擎运行预测吗？");
      if (!confirmed) return;
      try {
        const runResult = await call(ACTIONS.run, {
          withDetails: elements.depreciationWithDetails.checked,
        }, 10 * 60_000);
        lastPreflight = null;
        renderStatus(elements, runResult);
        setMessage(elements.depreciationPreflightMessage, runResult.message || "预测已完成，可查看结果或导出底稿", "ok");
        context.setStatus?.("折旧摊销与资本性支出预测已完成", "ok");
      } catch (error) {
        setMessage(elements.depreciationPreflightMessage, error.message, "error");
        await refreshStatus();
      }
    }

    function openPage(page, params = {}) {
      const query = new URLSearchParams(params);
      const url = context.chrome.runtime.getURL(`src/modules/${MODULE_ID}/${page}.html${query.size ? `?${query}` : ""}`);
      return context.chrome.tabs.create({ url, active: true });
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const pageRoot = context.document.getElementById(context.manifest.pageElementId);
        pageRoot.innerHTML = depreciationCapexTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL(`src/modules/${MODULE_ID}/styles.css`);
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        elements.downloadDepreciationTemplate.href = context.chrome.runtime.getURL(
          `src/modules/${MODULE_ID}/assets/折旧摊销预测输入模板.xlsx`,
        );
        context.scope.on(elements.openDepreciationCapex, "click", () => context.navigate(MODULE_ID));
        context.scope.on(elements.backFromDepreciation, "click", () => context.navigate("home"));
        context.scope.on(elements.importDepreciationWorkbook, "click", importWorkbook);
        context.scope.on(elements.refreshDepreciationStatus, "click", refreshStatus);
        context.scope.on(elements.saveDepreciationParameters, "click", saveParameters);
        context.scope.on(elements.preflightDepreciation, "click", preflight);
        context.scope.on(elements.runDepreciation, "click", run);
        context.scope.on(elements.openDepreciationStock, "click", () => openPage("input", { kind: "stock" }));
        context.scope.on(elements.openDepreciationAdded, "click", () => openPage("input", { kind: "added" }));
        context.scope.on(elements.openDepreciationResults, "click", () => openPage("results"));
        context.scope.on(elements.openDepreciationDetails, "click", () => openPage("details"));
        const saved = await context.storage.load({ withDetails: false });
        elements.depreciationWithDetails.checked = saved.withDetails === true;
      },

      async activate() {
        await prepare();
        await refreshStatus();
      },

      deactivate() {},

      async dispose() {
        await context?.storage.save({ withDetails: elements?.depreciationWithDetails?.checked === true });
      },
    };
  },
};

export { ACTIONS as depreciationCapexActions, ADDED_HEADERS, STOCK_HEADERS };
