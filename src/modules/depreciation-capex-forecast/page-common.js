export const MODULE_ID = "depreciation-capex-forecast";
export const NATIVE_ACTION = "depreciation_capex_forecast";

export const ACTIONS = Object.freeze({
  status: "status",
  selectWorkbook: "select",
  importWorkbook: "import",
  writeAssets: "write_stock",
  input: "read_input",
  results: "result",
  selectOutputDirectory: "select_output_directory",
  export: "export",
  details: "read_detail",
  annual: "read_annual",
  monthly: "read_monthly",
  process: "read_detail_process",
});

export const STOCK_HEADERS = [
  "序号", "情形描述", "公司主体", "资产科目", "名称", "账面原值", "账面净值", "评估原值",
  "启用时间", "折旧年限", "经济耐用年限", "预计尚可使用年限", "更新后折旧年限", "更新后经济耐用年限",
  "残值率", "费用科目", "折旧摊销", "进项税率", "是否需要更新",
];

export const ADDED_HEADERS = [
  "序号", "情形描述", "公司主体", "资产科目", "名称", "在建工程账面价值", "总投资额（不含税）",
  "预计投入使用时间", "更新后折旧年限", "更新后经济耐用年限", "残值率", "费用科目", "折旧摊销", "进项税率", "是否需要更新",
];

export function nativeRequest(message, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Native Helper 请求超时，请检查本机运行环境"));
    }, timeoutMs);
    const operation = message.operation || message.action;
    const payload = { ...message, action: NATIVE_ACTION, operation };
    chrome.runtime.sendNativeMessage("com.tianyuan.workbench.helper", payload, (response) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "Native Helper 未响应"));
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

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

export function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text || "";
  element.dataset.kind = kind;
}

export function pageLink(route = MODULE_ID) {
  return chrome.runtime.getURL(`src/sidepanel/index.html#${route}`);
}

export function templateUrl() {
  return chrome.runtime.getURL(`src/modules/${MODULE_ID}/assets/折旧摊销预测输入模板.xlsx`);
}

export function requiredHeadersFor(kind) {
  return kind === "added" ? ADDED_HEADERS : STOCK_HEADERS;
}

function splitClipboardLine(line) {
  const separator = line.includes("\t") ? "\t" : ",";
  if (separator === "\t") return line.split("\t");
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function parsePastedTable(text, requiredHeaders) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [], errors: ["没有检测到可粘贴的数据"] };
  const headers = splitClipboardLine(lines[0]).map((value) => String(value).trim());
  const errors = [];
  const seen = new Map();
  headers.forEach((header, index) => {
    if (!header) errors.push(`第 1 行第 ${index + 1} 列表头为空`);
    if (seen.has(header)) errors.push(`表头“${header}”重复（第 ${seen.get(header) + 1} 列和第 ${index + 1} 列）`);
    else seen.set(header, index);
  });
  for (const required of requiredHeaders) {
    if (!seen.has(required)) errors.push(`缺少必填表头“${required}”`);
  }
  const rows = lines.slice(1).map((line, lineIndex) => {
    const values = splitClipboardLine(line);
    if (values.length > headers.length) {
      errors.push(`第 ${lineIndex + 2} 行有 ${values.length} 个单元格，但表头只有 ${headers.length} 列`);
    }
    return headers.map((_, index) => values[index] ?? "");
  });
  return { headers, rows, errors };
}

export function rowsAsRecords(headers, rows) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export function normalizeTable(result = {}) {
  const rawHeaders = result.headers || result.columns || result.tableHeaders || [];
  const rawRows = result.rows || result.data || result.records || result.items || [];
  const headers = Array.isArray(rawHeaders)
    ? rawHeaders.map((header) => typeof header === "object" ? (header.label || header.name || header.key || "") : String(header))
    : [];
  const rows = Array.isArray(rawRows) ? rawRows : [];
  return { headers, rows };
}

export function rowValues(row, headers) {
  if (Array.isArray(row)) return headers.map((_, index) => row[index] ?? "");
  return headers.map((header) => row?.[header] ?? row?.[String(header)] ?? "");
}

export function renderTable(container, table, { maxRows = 200, emptyText = "暂无数据" } = {}) {
  const { headers, rows } = table;
  if (!headers.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const visibleRows = rows.slice(0, maxRows);
  const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("");
  const body = visibleRows.map((row) => `<tr>${rowValues(row, headers).map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
  container.innerHTML = `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${rows.length > maxRows ? `<p class="table-note">仅展示前 ${maxRows} 行，完整结果保留在工作簿。</p>` : ""}`;
}
