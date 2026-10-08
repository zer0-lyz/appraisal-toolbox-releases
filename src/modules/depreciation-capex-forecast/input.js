import {
  ACTIONS,
  nativeRequest,
  parsePastedTable,
  requiredHeadersFor,
  setMessage,
  templateUrl,
} from "./page-common.js";

const kind = new URLSearchParams(window.location.search).get("kind") === "added" ? "added" : "stock";
const requiredHeaders = requiredHeadersFor(kind);
const title = kind === "added" ? "新增资产" : "存量资产";

const elements = {
  pageTitle: document.getElementById("pageTitle"),
  kindTitle: document.getElementById("kindTitle"),
  requiredHeaders: document.getElementById("requiredHeaders"),
  gridWrap: document.getElementById("gridWrap"),
  inputMessage: document.getElementById("inputMessage"),
  inputErrors: document.getElementById("inputErrors"),
  rowCount: document.getElementById("rowCount"),
  inputStatus: document.getElementById("inputStatus"),
  saveInput: document.getElementById("saveInput"),
  downloadTemplate: document.getElementById("downloadTemplate"),
  loadExisting: document.getElementById("loadExisting"),
  pasteFromClipboard: document.getElementById("pasteFromClipboard"),
  addRow: document.getElementById("addRow"),
  importWorkbook: document.getElementById("importWorkbook"),
  clearInput: document.getElementById("clearInput"),
};

let gridHeaders = [...requiredHeaders];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function rowIsEmpty(row) {
  return gridHeaders.every((header) => isBlank(row.values[header]));
}

function renderErrors(errors) {
  elements.inputErrors.replaceChildren();
  elements.inputErrors.hidden = !errors.length;
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = error;
    elements.inputErrors.appendChild(item);
  }
}

function cellInput(row, header) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = row.values[header] ?? "";
  input.dataset.header = header;
  input.addEventListener("input", () => {
    row.values[header] = input.value;
  });
  return input;
}

function renderGrid(rows) {
  elements.rowCount.textContent = `${rows.length} 行`;
  if (!rows.length) {
    elements.gridWrap.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无数据，点击“添加行”或“读取工作簿已有数据”开始";
    elements.gridWrap.appendChild(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "asset-grid";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const opCell = document.createElement("th");
  opCell.textContent = "操作";
  headRow.appendChild(opCell);
  for (const header of gridHeaders) {
    const th = document.createElement("th");
    th.textContent = header;
    if (requiredHeaders.includes(header)) th.classList.add("required");
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.rowIndex !== null) tr.dataset.rowIndex = String(row.rowIndex);
    const opTd = document.createElement("td");
    opTd.className = "op-cell";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary row-remove";
    remove.textContent = "×";
    remove.title = "从表格移除该行（不影响工作簿已保存的行）";
    remove.addEventListener("click", () => {
      tr.remove();
      const remaining = body.querySelectorAll("tr").length;
      elements.rowCount.textContent = `${remaining} 行`;
      if (!remaining) renderGrid([]);
    });
    opTd.appendChild(remove);
    tr.appendChild(opTd);
    for (const header of gridHeaders) {
      const td = document.createElement("td");
      td.appendChild(cellInput(row, header));
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });
  table.replaceChildren(head, body);
  elements.gridWrap.replaceChildren(table);
}

function collectRows() {
  const table = elements.gridWrap.querySelector("table.asset-grid");
  if (!table) return [];
  const rows = [];
  for (const tr of table.tBodies[0].rows) {
    const values = {};
    gridHeaders.forEach((header, index) => {
      values[header] = tr.cells[index + 1]?.firstChild?.value ?? "";
    });
    if (gridHeaders.every((header) => isBlank(values[header]))) continue;
    const rowIndex = Number(tr.dataset.rowIndex);
    rows.push({
      values,
      rowIndex: Number.isInteger(rowIndex) && rowIndex >= 4 ? rowIndex : null,
    });
  }
  return rows;
}

function unionHeaders(extraHeaders) {
  const merged = [...requiredHeaders];
  for (const header of extraHeaders) {
    if (header && !merged.includes(header)) merged.push(header);
  }
  return merged;
}

function rowsFromRecords(records) {
  return records.map((record) => {
    const values = {};
    for (const header of gridHeaders) values[header] = String(record[header] ?? "");
    const rowIndex = Number(record.rowIndex);
    return { values, rowIndex: Number.isInteger(rowIndex) && rowIndex >= 4 ? rowIndex : null };
  });
}

async function loadExisting({ silent = false } = {}) {
  if (!silent) elements.loadExisting.disabled = true;
  try {
    const result = await nativeRequest({ action: ACTIONS.input, kind }, 60_000);
    const section = result.sections?.[kind];
    if (!section || !Array.isArray(section.headers) || !section.headers.length) {
      throw new Error(result.message || "当前工作簿缺少对应的输入表");
    }
    gridHeaders = unionHeaders(section.headers);
    const rows = rowsFromRecords(section.rows);
    renderGrid(rows);
    elements.inputStatus.textContent = `已读取 ${rows.length} 行`;
    renderErrors([]);
    if (silent) return;
    setMessage(
      elements.inputMessage,
      rows.length
        ? `已读取工作簿中 ${rows.length} 行${title}。直接在表格中修改后保存，会按原行号原位更新。`
        : `工作簿中暂无${title}数据，点击“添加行”开始录入。`,
      "ok",
    );
  } catch (error) {
    if (!silent) setMessage(elements.inputMessage, error.message, "error");
  } finally {
    if (!silent) elements.loadExisting.disabled = false;
  }
}

async function pasteFromClipboard() {
  elements.pasteFromClipboard.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
    if (!lines.length) {
      setMessage(elements.inputMessage, "剪贴板没有可粘贴的数据", "error");
      return;
    }
    const firstLineCells = lines[0].includes("\t") ? lines[0].split("\t") : [lines[0]];
    const knownHeaders = new Set(gridHeaders);
    const looksLikeHeaderRow = firstLineCells.some((cell) => knownHeaders.has(cell.trim()));
    const existingRows = collectRows();
    let appended = 0;
    if (looksLikeHeaderRow) {
      const parsed = parsePastedTable(text, requiredHeaders);
      renderErrors(parsed.errors.filter((message) => !message.startsWith("缺少必填表头")));
      if (parsed.errors.some((message) => !message.startsWith("缺少必填表头"))) {
        setMessage(elements.inputMessage, "粘贴内容校验失败，请检查表头", "error");
        return;
      }
      gridHeaders = unionHeaders(parsed.headers);
      const records = parsed.rows.map((row) => Object.fromEntries(parsed.headers.map((header, index) => [header, row[index] ?? ""])));
      renderGrid([...existingRows, ...rowsFromRecords(records)]);
      appended = records.length;
    } else {
      const records = lines.map((line) => {
        const cells = line.split("\t");
        return Object.fromEntries(gridHeaders.map((header, index) => [header, cells[index] ?? ""]));
      });
      renderGrid([...existingRows, ...rowsFromRecords(records)]);
      appended = records.length;
    }
    elements.inputStatus.textContent = "待保存";
    setMessage(elements.inputMessage, `已按剪贴板内容追加 ${appended} 行；检查无误后点“保存到当前工作簿”。`, "ok");
  } catch (error) {
    setMessage(elements.inputMessage, `读取剪贴板失败：${error.message || error}`, "error");
  } finally {
    elements.pasteFromClipboard.disabled = false;
  }
}

async function save() {
  const rows = collectRows();
  if (!rows.length) {
    setMessage(elements.inputMessage, "表格中没有可保存的数据", "error");
    return;
  }
  elements.saveInput.disabled = true;
  try {
    const records = rows.map((row) => ({
      ...row.values,
      ...(row.rowIndex !== null ? { rowIndex: row.rowIndex } : {}),
    }));
    const updatedRows = rows.filter((row) => row.rowIndex !== null).length;
    const result = await nativeRequest({
      action: kind === "added" ? "write_added" : ACTIONS.writeAssets,
      kind,
      headers: gridHeaders,
      records,
      values: records,
    }, 120_000);
    setMessage(
      elements.inputMessage,
      `${result.message || `${title}已保存到当前工作簿`}（按原行号更新 ${updatedRows} 行，新增 ${records.length - updatedRows} 行）`,
      "ok",
    );
    elements.inputStatus.textContent = "已保存";
    await loadExisting({ silent: true });
  } catch (error) {
    setMessage(elements.inputMessage, error.message, "error");
    elements.inputStatus.textContent = "保存失败";
  } finally {
    elements.saveInput.disabled = false;
  }
}

async function importWorkbook() {
  elements.importWorkbook.disabled = true;
  try {
    const selected = await nativeRequest({ action: ACTIONS.selectWorkbook }, 130_000);
    const selectedPath = selected.path || selected.sourcePath;
    if (selected.cancelled || selected.canceled || !selectedPath) {
      setMessage(elements.inputMessage, "已取消导入", "");
      return;
    }
    const result = await nativeRequest({ action: ACTIONS.importWorkbook, sourcePath: selectedPath, path: selectedPath }, 60_000);
    setMessage(elements.inputMessage, `${result.message || "已导入为当前工作簿。"}点“读取工作簿已有数据”可将内容载入表格。`, "ok");
    elements.inputStatus.textContent = "工作簿已导入";
  } catch (error) {
    setMessage(elements.inputMessage, error.message, "error");
    elements.inputStatus.textContent = "导入失败";
  } finally {
    elements.importWorkbook.disabled = false;
  }
}

elements.pageTitle.textContent = `${title}输入`;
elements.kindTitle.textContent = title;
elements.downloadTemplate.href = templateUrl();
elements.requiredHeaders.replaceChildren(
  ...requiredHeaders.map((header) => {
    const item = document.createElement("li");
    item.textContent = header;
    return item;
  }),
);
elements.loadExisting.addEventListener("click", () => void loadExisting());
elements.pasteFromClipboard.addEventListener("click", () => void pasteFromClipboard());
elements.addRow.addEventListener("click", () => {
  renderGrid([...collectRows(), { values: {}, rowIndex: null }]);
  elements.inputStatus.textContent = "待保存";
  const inputs = elements.gridWrap.querySelectorAll("tbody tr:last-child input");
  inputs[0]?.focus();
});
elements.saveInput.addEventListener("click", save);
elements.importWorkbook.addEventListener("click", importWorkbook);
elements.clearInput.addEventListener("click", () => {
  gridHeaders = [...requiredHeaders];
  renderGrid([]);
  elements.inputStatus.textContent = "未读取";
  renderErrors([]);
  setMessage(elements.inputMessage, "已清空表格", "");
});
renderGrid([]);
void loadExisting({ silent: true });
