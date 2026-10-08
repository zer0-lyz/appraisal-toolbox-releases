import {
  ACTIONS,
  nativeRequest,
  normalizeTable,
  renderTable,
  setMessage,
} from "./page-common.js";

const elements = {
  annualTab: document.getElementById("annualTab"),
  monthlyTab: document.getElementById("monthlyTab"),
  processTab: document.getElementById("processTab"),
  assetFilter: document.getElementById("assetFilter"),
  pageNumber: document.getElementById("pageNumber"),
  pageSize: document.getElementById("pageSize"),
  columnStart: document.getElementById("columnStart"),
  columnCount: document.getElementById("columnCount"),
  loadDetails: document.getElementById("loadDetails"),
  detailStatus: document.getElementById("detailStatus"),
  tableTitle: document.getElementById("tableTitle"),
  tableHint: document.getElementById("tableHint"),
  windowInfo: document.getElementById("windowInfo"),
  detailTable: document.getElementById("detailTable"),
  previousPage: document.getElementById("previousPage"),
  nextPage: document.getElementById("nextPage"),
};

let view = "annual";

const VIEW_META = {
  annual: { title: "资产结果明细（年度）", table: "资产结果明细（年度）" },
  monthly: { title: "资产结果明细（月度）", table: "资产结果明细（月度）" },
  process: { title: "单资产详细过程", table: "详细过程" },
};

function numberValue(element, fallback, minimum = 1) {
  const value = Number(element.value);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

function setView(nextView) {
  view = nextView;
  for (const [key, element] of [["annual", elements.annualTab], ["monthly", elements.monthlyTab], ["process", elements.processTab]]) {
    element.setAttribute("aria-selected", key === view ? "true" : "false");
  }
  const meta = VIEW_META[view];
  elements.tableTitle.textContent = meta.title;
  elements.tableHint.textContent = view === "monthly"
    ? "月度时间轴按当前窗口读取；滚动或修改时间列起点后继续读取。"
    : view === "process"
      ? "需要填写资产编号或名称；服务端只读取该资产的详细过程。"
      : "年度数据按资产行分页读取。";
  elements.columnStart.disabled = view === "process";
  elements.columnCount.disabled = view === "process";
}

async function load() {
  elements.loadDetails.disabled = true;
  try {
    const page = numberValue(elements.pageNumber, 1);
    const pageSize = numberValue(elements.pageSize, 50);
    const columnStart = numberValue(elements.columnStart, 1);
    const columnCount = numberValue(elements.columnCount, 24);
    const assetId = elements.assetFilter.value.trim();
    if (view === "process" && !assetId) {
      throw new Error("单资产详细过程需要填写资产编号或名称");
    }
    const result = await nativeRequest({
      action: view === "annual" ? ACTIONS.annual : view === "monthly" ? ACTIONS.monthly : ACTIONS.process,
      view,
      table: VIEW_META[view].table,
      page,
      pageNumber: page,
      pageSize,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      columnStart,
      columnStartIndex: columnStart - 1,
      columnCount,
      assetId,
      assetFilter: assetId,
    }, 120_000);
    const table = normalizeTable(result);
    renderTable(elements.detailTable, table, { maxRows: pageSize, emptyText: "当前窗口没有数据" });
    const totalRows = result.totalRows ?? result.rowCount ?? result.total ?? "?";
    const totalColumns = result.totalColumns ?? result.columnCount ?? "?";
    elements.windowInfo.textContent = `第 ${page} 页 · ${table.rows.length} 行 · 列 ${columnStart}-${columnStart + Math.max(table.headers.length, 1) - 1} / ${totalColumns}`;
    setMessage(elements.detailStatus, result.message || `已读取 ${totalRows} 行中的当前页`, "ok");
    elements.previousPage.disabled = page <= 1;
    elements.nextPage.disabled = table.rows.length < pageSize || (Number.isFinite(Number(totalRows)) && page * pageSize >= Number(totalRows));
  } catch (error) {
    const message = String(error.message || error);
    const hint = message.includes("RESULT_SHEET_NOT_FOUND")
      ? "当前工作簿还没有该明细表：请先在参数页勾选“包含明细运行”再运行预测。"
      : "";
    setMessage(elements.detailStatus, hint ? `${message}。${hint}` : message, "error");
    elements.previousPage.disabled = true;
    elements.nextPage.disabled = true;
  } finally {
    elements.loadDetails.disabled = false;
  }
}

elements.annualTab.addEventListener("click", () => { setView("annual"); void load(); });
elements.monthlyTab.addEventListener("click", () => { setView("monthly"); void load(); });
elements.processTab.addEventListener("click", () => { setView("process"); });
elements.loadDetails.addEventListener("click", load);
elements.assetFilter.addEventListener("keydown", (event) => { if (event.key === "Enter") void load(); });
elements.previousPage.addEventListener("click", () => {
  elements.pageNumber.value = String(Math.max(1, numberValue(elements.pageNumber, 1) - 1));
  void load();
});
elements.nextPage.addEventListener("click", () => {
  elements.pageNumber.value = String(numberValue(elements.pageNumber, 1) + 1);
  void load();
});
setView("annual");
