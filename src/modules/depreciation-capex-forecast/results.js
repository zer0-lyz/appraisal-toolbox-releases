import {
  ACTIONS,
  escapeHtml,
  nativeRequest,
  normalizeTable,
  pageLink,
  renderTable,
  setMessage,
} from "./page-common.js";

const elements = {
  resultStatus: document.getElementById("resultStatus"),
  inputIssues: document.getElementById("inputIssues"),
  issueList: document.getElementById("issueList"),
  checks: document.getElementById("checks"),
  forecastSummary: document.getElementById("forecastSummary"),
  expenseSummary: document.getElementById("expenseSummary"),
  exportStatus: document.getElementById("exportStatus"),
  refreshResults: document.getElementById("refreshResults"),
  exportWorkbook: document.getElementById("exportWorkbook"),
  openDetails: document.getElementById("openDetails"),
};

function issuesFrom(result) {
  const source = result.issues || result.errors || result.problems || result.checks?.issues || [];
  if (!Array.isArray(source)) return source ? [source] : [];
  return source.map((issue) => typeof issue === "string" ? issue : issue.message || issue.reason || JSON.stringify(issue));
}

function findTable(result, names) {
  const candidates = [result.tables, result.resultTables, result.sheets, result];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const name of names) {
      if (candidate[name]) return normalizeTable(candidate[name]);
      const key = Object.keys(candidate).find((item) => String(item).replace(/\s/g, "") === String(name).replace(/\s/g, ""));
      if (key) return normalizeTable(candidate[key]);
    }
  }
  return { headers: [], rows: [] };
}

function renderIssues(result) {
  const issues = issuesFrom(result);
  elements.issueList.replaceChildren();
  elements.inputIssues.hidden = issues.length === 0;
  for (const issue of issues) {
    const item = document.createElement("li");
    item.textContent = issue;
    elements.issueList.appendChild(item);
  }
  return issues;
}

async function refresh() {
  elements.refreshResults.disabled = true;
  try {
    const result = await nativeRequest({ action: ACTIONS.results }, 120_000);
    const issues = renderIssues(result);
    const invalid = result.inputValid === false || result.checks?.inputValid === false;
    setMessage(elements.resultStatus, issues.length || invalid ? "输入校验未通过，请先修正问题" : (result.message || "结果读取成功"), issues.length || invalid ? "error" : "ok");
    renderTable(elements.checks, findTable(result, ["检查结果", "checks", "checkResult"]), { maxRows: 200, emptyText: "暂无检查结果" });
    renderTable(elements.forecastSummary, findTable(result, ["预测汇总", "forecastSummary", "summary"]), { maxRows: 200, emptyText: "暂无预测汇总" });
    renderTable(elements.expenseSummary, findTable(result, ["费用科目汇总", "expenseSummary", "expense_summary"]), { maxRows: 500, emptyText: "暂无费用科目汇总" });
  } catch (error) {
    setMessage(elements.resultStatus, error.message, "error");
    elements.inputIssues.hidden = true;
  } finally {
    elements.refreshResults.disabled = false;
  }
}

async function exportWorkbook() {
  elements.exportWorkbook.disabled = true;
  try {
    const selected = await nativeRequest({ action: ACTIONS.selectOutputDirectory }, 130_000);
    const selectedDirectory = selected.outputDirectory || selected.path || selected.paths?.[0] || "";
    if (selected.cancelled || selected.canceled || !selectedDirectory) {
      setMessage(elements.exportStatus, "已取消导出", "");
      return;
    }
    const result = await nativeRequest({
      action: ACTIONS.export,
      outputDirectory: selectedDirectory,
      outputPath: selected.outputPath || "",
    }, 120_000);
    const filePath = result.outputPath || result.path || result.file?.path || "";
    const size = result.size || result.file?.size;
    setMessage(elements.exportStatus, `底稿已导出${filePath ? `：${filePath}` : ""}${size ? `（${size} 字节）` : ""}`, "ok");
  } catch (error) {
    setMessage(elements.exportStatus, error.message, "error");
  } finally {
    elements.exportWorkbook.disabled = false;
  }
}

elements.refreshResults.addEventListener("click", refresh);
elements.exportWorkbook.addEventListener("click", exportWorkbook);
elements.openDetails.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/modules/depreciation-capex-forecast/details.html") }));
void pageLink;
void escapeHtml;
void refresh();
