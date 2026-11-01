import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { landPublicityModule } from "../../src/modules/land-publicity/module.js";
import { tableFormatModule } from "../../src/modules/table-format/module.js";
import { workbookToolModules } from "../../src/modules/workbook-tools/module.js";
import { alibabaAuctionModule } from "../../src/modules/alibaba-auction/module.js";
import { alibabaLeaseModule } from "../../src/modules/alibaba-lease/module.js";
import { anjukePropertyModule } from "../../src/modules/anjuke-property/module.js";
import { depreciationCapexModule } from "../../src/modules/depreciation-capex-forecast/module.js";
import { nativeErrorMessage } from "../../src/core/native-errors.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("../../scripts/release/test-tools/node_modules/jsdom");
const { createMacOSAdapter } = require("../../native-helper/platform/macos.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const failures = [];
const checks = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function feedbackAfter(button) {
  const row = button.closest(".directory-row, .button-row, .land-publicity-output-row, .alibaba-auction-output-row, .alibaba-lease-output-row, .anjuke-property-output-row") || button.parentElement;
  const feedback = row?.nextElementSibling;
  assert(feedback?.classList.contains("native-picker-feedback"), `button ${button.id} must have adjacent picker feedback`);
  assert.equal(feedback.getAttribute("role"), "status");
  assert.equal(feedback.getAttribute("aria-live"), "polite");
  return feedback;
}

function createModuleFixture(module, { stored = {}, send = async () => ({ ok: true }), save = async () => {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><button id="${module.manifest.entryElementId}"></button><main><div id="${module.manifest.pageElementId}"></div></main></body></html>`, { url: "https://fixture.invalid/" });
  const handlers = new Map();
  const calls = [];
  const saves = [];
  const context = {
    manifest: module.manifest,
    document: dom.window.document,
    chrome: { runtime: { getURL: (value) => `chrome-extension://fixture/${value}` } },
    scope: {
      on(element, event, callback) {
        assert(element, `scope handler target exists for ${event}`);
        handlers.set(`${element.id}:${event}`, callback);
      },
      add() {},
    },
    storage: {
      load: async () => structuredClone(stored),
      save: async (value) => { saves.push(structuredClone(value)); await save(value); },
    },
    setStatus: (text, kind) => { context.status = { text, kind }; },
    navigate() {},
    sendNativeMessage: async (message, timeout) => { calls.push({ message, timeout }); return await send(message, timeout); },
    streamNativeMessage: async () => { throw new Error("Unexpected streamNativeMessage in picker regression"); },
  };
  return { dom, context, handlers, calls, saves };
}

function actionResponder(answers = {}) {
  return async (message) => {
    if (Object.hasOwn(answers, message.action)) {
      const answer = answers[message.action];
      return typeof answer === "function" ? await answer(message) : answer;
    }
    if (message.action === "list_land_publicity_regions") {
      return { ok: true, regions: [{ name: "浙江省", code: "330000", children: [{ name: "杭州市", code: "330100", children: [] }] }] };
    }
    if (message.action === "list_land_publicity_history" || message.action === "list_alibaba_auction_history") {
      return { ok: true, items: [] };
    }
    return { ok: true, items: [], paths: [], regions: [] };
  };
}

async function invoke(handlers, id, event = "click") {
  const handler = handlers.get(`${id}:${event}`);
  assert.equal(typeof handler, "function", `registered handler for ${id}:${event}`);
  return await handler();
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function testLandDirectoryFeedback() {
  const oldOutput = "C:\\旧资料\\浙江土地成交公示";
  const pending = deferred();
  let outputAnswer = pending.promise;
  let saveFailure = null;
  const fixture = createModuleFixture(landPublicityModule, {
    stored: { outputDirectory: oldOutput, historyDirectory: "" },
    send: actionResponder({ select_land_publicity_output_directory: () => outputAnswer }),
    save: async () => { if (saveFailure) throw saveFailure; },
  });
  const module = landPublicityModule.create();
  await module.initialize(fixture.context);
  await waitFor(() => fixture.calls.some((call) => call.message.action === "list_land_publicity_regions"), "land region warmup");
  await nextTurn();

  const button = fixture.context.document.getElementById("chooseLandPublicityOutput");
  const historyButton = fixture.context.document.getElementById("chooseLandPublicityHistoryDirectory");
  const pendingClick = invoke(fixture.handlers, button.id);
  const feedback = feedbackAfter(button);
  assert.equal(feedback.textContent, "正在打开土地公示输出目录选择窗口…");
  assert.equal(button.disabled, true);
  assert.equal(historyButton.disabled, true);
  await invoke(fixture.handlers, button.id);
  assert.equal(fixture.calls.filter((call) => call.message.action === "select_land_publicity_output_directory").length, 1, "a duplicate click must not issue another native request");
  pending.resolve({ ok: false, cancelled: false, reason: "MANAGED_OUTPUT_PERMISSION_DENIED", diagnostics: { exitCode: null, stderrTail: ["阶段: create_directory", "错误码: EACCES"] } });
  await pendingClick;
  assert.equal(button.disabled, false);
  assert.equal(historyButton.disabled, false);
  assert.equal(fixture.context.document.getElementById("landPublicityOutputDirectory").value, oldOutput, "failed selection must retain the previously saved value");
  assert.match(feedback.textContent, /无法在所选位置创建或写入/);
  assert.match(feedback.textContent, /复制诊断详情/);
  assert.doesNotMatch(feedback.textContent, /MANAGED_OUTPUT_PERMISSION_DENIED|EACCES/);

  outputAnswer = { ok: true, outputDirectory: "C:\\新成果\\浙江土地成交公示", directoryName: "浙江土地成交公示", createdDirectory: true };
  await invoke(fixture.handlers, button.id);
  assert.equal(fixture.context.document.getElementById("landPublicityOutputDirectory").value, outputAnswer.outputDirectory);
  assert.match(feedback.textContent, /已创建并选择专用成果子文件夹/);
  assert.equal(fixture.saves.filter((value) => value?.outputDirectory === outputAnswer.outputDirectory).length, 1, "a successful selection is persisted");

  saveFailure = Object.assign(new Error("EACCES"), { code: "EACCES" });
  outputAnswer = { ok: true, outputDirectory: "C:\\第三次\\浙江土地成交公示", directoryName: "浙江土地成交公示", createdDirectory: true };
  await invoke(fixture.handlers, button.id);
  assert.equal(fixture.context.document.getElementById("landPublicityOutputDirectory").value, outputAnswer.outputDirectory);
  assert.match(feedback.textContent, /目录已选择，但设置保存失败/);
  assert.doesNotMatch(feedback.textContent, /选择输出目录失败/);
  module.deactivate();
  fixture.dom.window.close();
  checks.push("土地模块真实 DOM：就近等待/忙态防重、错误保留旧目录、重试成功、保存失败分开反馈");
}

async function testRelatedModuleButtons() {
  const cases = [
    { module: alibabaAuctionModule, button: "chooseAlibabaAuctionOutput", output: "alibabaAuctionOutputDirectory", action: "select_alibaba_auction_output_directory", stored: { outputDirectory: "C:\\old\\阿里司法拍卖", historyDirectory: "" } },
    { module: alibabaLeaseModule, button: "chooseAlibabaLeaseOutput", output: "alibabaLeaseOutputDirectory", action: "select_alibaba_lease_output_directory", stored: { outputDirectory: "C:\\old\\阿里资产租赁" } },
    { module: anjukePropertyModule, button: "chooseAnjukePropertyOutput", output: "anjukePropertyOutputDirectory", action: "select_anjuke_property_output_directory", stored: { outputDirectory: "C:\\old\\安居客物业案例" } },
  ];
  for (const entry of cases) {
    const selected = `C:\\新目录\\${entry.module.manifest.displayName}`;
    const fixture = createModuleFixture(entry.module, {
      stored: entry.stored,
      send: actionResponder({ [entry.action]: { ok: true, outputDirectory: selected, directoryName: entry.module.manifest.displayName, createdDirectory: false } }),
    });
    const instance = entry.module.create();
    await instance.initialize(fixture.context);
    const button = fixture.context.document.getElementById(entry.button);
    await invoke(fixture.handlers, entry.button);
    const feedback = feedbackAfter(button);
    assert.equal(fixture.context.document.getElementById(entry.output).value, selected);
    assert.match(feedback.textContent, /已复用专用成果子文件夹/);
    assert.equal(button.disabled, false);
    assert(fixture.saves.some((value) => value?.outputDirectory === selected));
    instance.deactivate();
    fixture.dom.window.close();
  }

  const fixture = createModuleFixture(landPublicityModule, {
    stored: { outputDirectory: "C:\\old\\土地", historyDirectory: "C:\\old\\历史" },
    send: actionResponder({ select_land_publicity_history_directory: { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED" } }),
  });
  const land = landPublicityModule.create();
  await land.initialize(fixture.context);
  await nextTurn();
  const history = fixture.context.document.getElementById("chooseLandPublicityHistoryDirectory");
  const previous = fixture.context.document.getElementById("landPublicityHistoryDirectory").value;
  await invoke(fixture.handlers, history.id);
  const feedback = feedbackAfter(history);
  assert.match(feedback.textContent, /已取消历史目录选择，原目录保留/);
  assert.equal(fixture.context.document.getElementById("landPublicityHistoryDirectory").value, previous);
  land.deactivate();
  fixture.dom.window.close();

  const auctionFixture = createModuleFixture(alibabaAuctionModule, {
    stored: { outputDirectory: "", historyDirectory: "C:\\old\\司法拍卖历史" },
    send: actionResponder({ select_alibaba_auction_history_directory: { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED" } }),
  });
  const auction = alibabaAuctionModule.create();
  await auction.initialize(auctionFixture.context);
  await nextTurn();
  const auctionHistory = auctionFixture.context.document.getElementById("chooseAlibabaAuctionHistoryDirectory");
  const oldAuctionHistory = auctionFixture.context.document.getElementById("alibabaAuctionHistoryDirectory").value;
  await invoke(auctionFixture.handlers, auctionHistory.id);
  assert.match(feedbackAfter(auctionHistory).textContent, /已取消历史目录选择，原目录保留/);
  assert.equal(auctionFixture.context.document.getElementById("alibabaAuctionHistoryDirectory").value, oldAuctionHistory);
  auction.deactivate();
  auctionFixture.dom.window.close();
  checks.push("拍卖/租赁/安居客输出及土地/拍卖历史真实 DOM：按钮旁终态、子目录信息、取消保留原选择");
}

async function testTableAndWorkbookInputs() {
  let fileResponse = { ok: true, paths: ["C:\\原文件\\原始.docx"] };
  let outputResponse = { ok: true, outputDirectory: "C:\\旧输出\\表格格式设置", directoryName: "表格格式设置", createdDirectory: false };
  let failSave = null;
  const fixture = createModuleFixture(tableFormatModule, {
    stored: { outputMode: "new_directory", outputDirectory: "C:\\旧输出\\表格格式设置" },
    send: actionResponder({
      select_table_format_word_files: () => fileResponse,
      select_table_format_output_directory: () => outputResponse,
    }),
    save: async () => { if (failSave) throw failSave; },
  });
  const instance = tableFormatModule.create();
  await instance.initialize(fixture.context);
  const filesButton = fixture.context.document.getElementById("chooseTableFormatFiles");
  const outputButton = fixture.context.document.getElementById("chooseTableFormatOutput");
  await invoke(fixture.handlers, filesButton.id);
  const filesFeedback = feedbackAfter(filesButton);
  assert.match(filesFeedback.textContent, /已选择 1 个 Word 文档/);
  assert(fixture.context.document.querySelector("#tableFormatFileList li")?.textContent.endsWith("原始.docx"));

  fileResponse = { ok: false, reason: "FILE_PICKER_TIMEOUT", diagnostics: { exitCode: null, stderrTail: ["阶段: process_timeout", "错误码: ETIMEDOUT"] } };
  await invoke(fixture.handlers, filesButton.id);
  assert(fixture.context.document.querySelector("#tableFormatFileList li")?.textContent.endsWith("原始.docx"), "a failed reselection keeps the prior Word list");
  assert.match(filesFeedback.textContent, /等待系统选择窗口超时/);
  assert.doesNotMatch(filesFeedback.textContent, /FILE_PICKER_TIMEOUT|ETIMEDOUT/);

  failSave = Object.assign(new Error("EACCES"), { code: "EACCES" });
  outputResponse = { ok: true, outputDirectory: "C:\\新输出\\表格格式设置", directoryName: "表格格式设置", createdDirectory: true };
  await invoke(fixture.handlers, outputButton.id);
  const outputFeedback = feedbackAfter(outputButton);
  assert.equal(fixture.context.document.getElementById("tableFormatOutputDirectory").value, outputResponse.outputDirectory);
  assert.match(outputFeedback.textContent, /目录已选择，但设置保存失败/);
  assert.equal(outputButton.disabled, false);
  assert.equal(filesButton.disabled, false);
  assert(nativeErrorMessage(new Error("EXPORT_DIRECTORY_CREATE_FAILED")).includes("专用导出子文件夹"));
  assert(nativeErrorMessage(new Error("APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED")).includes("完整安装包"));
  assert(nativeErrorMessage(new Error("UNKNOWN_ACTION")).includes("完整安装包"));
  instance.deactivate();
  fixture.dom.window.close();

  const workbookModule = workbookToolModules.find((module) => module.manifest.id === "detail-formula-restore");
  const workbookFixture = createModuleFixture(workbookModule, {
    send: actionResponder({ select_print_workbook_files: { ok: true, paths: ["C:\\输入\\宏工作簿.xlsm"] } }),
  });
  const workbook = workbookModule.create();
  await workbook.initialize(workbookFixture.context);
  const workbookFiles = workbookFixture.context.document.getElementById("detail-formula-restore-files");
  await invoke(workbookFixture.handlers, workbookFiles.id);
  const workbookFeedback = feedbackAfter(workbookFiles);
  assert.match(workbookFeedback.textContent, /公式恢复仅支持 \.xlsx/);
  assert.match(workbookFeedback.textContent, /原文件列表保留/);
  assert.equal(workbookFixture.context.document.getElementById("detail-formula-restore-count").textContent, "尚未选择文件");
  workbook.deactivate();
  workbookFixture.dom.window.close();

  const normalWorkbookModule = workbookToolModules.find((module) => module.manifest.id === "detail-print-format");
  const folderFixture = createModuleFixture(normalWorkbookModule, {
    send: actionResponder({
      select_print_workbook_directory: { ok: true, path: "C:\\批次 输入\\待处理工作簿" },
      select_print_output_directory: { ok: true, outputDirectory: "C:\\输出\\明细表打印格式", directoryName: "明细表打印格式", createdDirectory: true },
    }),
  });
  const normalWorkbook = normalWorkbookModule.create();
  await normalWorkbook.initialize(folderFixture.context);
  const folderButton = folderFixture.context.document.getElementById("detail-print-format-folder");
  await invoke(folderFixture.handlers, folderButton.id);
  assert.match(feedbackAfter(folderButton).textContent, /已选择工作簿文件夹：C:\\批次 输入\\待处理工作簿/);
  assert.equal(folderFixture.context.document.getElementById("detail-print-format-count").textContent, "1 项输入");
  const newDirectoryMode = folderFixture.context.document.getElementById("detail-print-format-mode");
  newDirectoryMode.value = "new_directory";
  newDirectoryMode.dispatchEvent(new folderFixture.dom.window.Event("change"));
  await nextTurn();
  const toolOutput = folderFixture.context.document.getElementById("detail-print-format-output");
  await invoke(folderFixture.handlers, toolOutput.id);
  assert.match(feedbackAfter(toolOutput).textContent, /已创建并选择专用成果子文件夹/);
  normalWorkbook.deactivate();
  folderFixture.dom.window.close();
  checks.push("表格/工作簿工具真实 DOM：文件/目录选择、文件错误保留旧列表、保存失败单独反馈、Excel格式限制和旧助手错误中文映射");
}

function queuedChrome(respond, calls = []) {
  return {
    runtime: {
      lastError: null,
      getURL: (value) => `chrome-extension://fixture/${value}`,
      connect() {
        const messageListeners = [];
        const disconnectListeners = [];
        return {
          onMessage: { addListener: (callback) => messageListeners.push(callback) },
          onDisconnect: { addListener: (callback) => disconnectListeners.push(callback) },
          postMessage(request) {
            const message = request.message;
            calls.push(message);
            setImmediate(async () => {
              for (const callback of messageListeners) callback({ type: "started" });
              const payload = await respond(message);
              for (const callback of messageListeners) callback({ type: "result", payload });
            });
          },
          disconnect() { for (const callback of disconnectListeners) callback(); },
        };
      },
    },
    tabs: { create: async () => ({ id: 1 }) },
  };
}

async function testDepreciationModuleWrapper() {
  const nativeCalls = [];
  const chrome = queuedChrome(async (message) => {
    if (message.operation === "select") return { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED", security: { credentialsReturned: false } };
    if (message.operation === "status" || message.operation === "prepare") return { ok: true, workbookPath: "C:\\fixture.xlsx", message: "就绪" };
    return { ok: true };
  }, nativeCalls);
  const fixture = createModuleFixture(depreciationCapexModule, { stored: { withDetails: false } });
  fixture.context.chrome = chrome;
  const instance = depreciationCapexModule.create();
  await instance.initialize(fixture.context);
  const button = fixture.context.document.getElementById("importDepreciationWorkbook");
  await invoke(fixture.handlers, button.id);
  const feedback = feedbackAfter(button);
  await waitFor(() => feedback.textContent.includes("已取消工作簿导入"), "depreciation module cancellation through native wrapper");
  assert.equal(button.disabled, false);
  assert.equal(fixture.context.document.getElementById("depreciationStatusMessage").textContent, "已取消工作簿导入，当前工作簿保留。", "depreciation panel status must end in cancellation state");
  assert.equal(feedback.textContent, "已取消工作簿导入，当前工作簿保留。", "nearby picker feedback must end in cancellation state");
  assert.deepEqual(fixture.context.status, { text: "已取消工作簿导入，当前工作簿保留。", kind: "warn" }, "global status must end in cancellation state");
  assert(nativeCalls.some((message) => message.operation === "select"));
  assert.doesNotMatch(feedback.textContent, /选择工作簿失败/);
  instance.deactivate();
  fixture.dom.window.close();
  checks.push("折旧主页面真实 Native 队列 wrapper：明确取消到达共享选择反馈");
}

async function testMacDepreciationPickerCancellation() {
  const cancelError = Object.assign(new Error("execution error: User canceled. (-128)"), { code: 1 });
  const adapter = createMacOSAdapter({
    execFile(_command, _args, _options, callback) {
      callback(cancelError, "", "");
    },
  });
  const response = await adapter.chooseXlsxFile();
  assert.equal(response.ok, false);
  assert.equal(response.cancelled, true, "macOS osascript cancellation must use the explicit cancellation signal");
  assert.equal(response.reason, "FILE_SELECTION_CANCELLED");
  checks.push("Mac osascript workbook-picker cancellation is normalized for the shared depreciation module");
}

async function testDepreciationStandalonePages() {
  const pageCss = fs.readFileSync(path.join(repoRoot, "src/modules/depreciation-capex-forecast/page.css"), "utf8");
  assert.match(pageCss, /\.native-picker-feedback\s*\{[^}]*overflow-wrap:\s*anywhere/s, "standalone-page feedback must wrap long selected paths");
  const original = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, confirm: globalThis.confirm };
  const globals = [];
  const inputCalls = [];
  let inputNative = queuedChrome(async (message) => {
    if (message.operation === "read_input") return { ok: true, headers: [], rows: [] };
    if (message.operation === "select") return { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED", security: { credentialsReturned: false } };
    if (message.operation === "import") return { ok: true, message: "已导入" };
    return { ok: true };
  }, inputCalls);
  let dom = new JSDOM(fs.readFileSync(path.join(repoRoot, "src/modules/depreciation-capex-forecast/input.html"), "utf8"), { url: "https://fixture.invalid/input.html?kind=stock" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = inputNative;
  globalThis.confirm = () => false;
  await import(`${pathToFileURL(path.join(repoRoot, "src/modules/depreciation-capex-forecast/input.js")).href}?picker-test=${Date.now()}`);
  const importButton = dom.window.document.getElementById("importWorkbook");
  importButton.click();
  const importFeedback = feedbackAfter(importButton);
  await waitFor(() => importFeedback.textContent.includes("已取消工作簿导入"), "standalone depreciation input cancellation through page-common wrapper");
  assert.equal(importButton.disabled, false);
  assert(inputCalls.some((message) => message.operation === "select"));
  globals.push("standalone input import cancellation");
  dom.window.close();

  const resultCalls = [];
  const resultChrome = queuedChrome(async (message) => {
    if (message.operation === "result") return { ok: true, inputValid: true, tables: {} };
    if (message.operation === "select_output_directory") return { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED", security: { credentialsReturned: false } };
    if (message.operation === "export") return { ok: true, outputPath: "C:\\fixture\\底稿.xlsx" };
    return { ok: true };
  }, resultCalls);
  dom = new JSDOM(fs.readFileSync(path.join(repoRoot, "src/modules/depreciation-capex-forecast/results.html"), "utf8"), { url: "https://fixture.invalid/results.html" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.chrome = resultChrome;
  await import(`${pathToFileURL(path.join(repoRoot, "src/modules/depreciation-capex-forecast/results.js")).href}?picker-test=${Date.now()}`);
  const exportButton = dom.window.document.getElementById("exportWorkbook");
  exportButton.click();
  const exportFeedback = feedbackAfter(exportButton);
  await waitFor(() => exportFeedback.textContent.includes("已取消底稿导出"), "standalone depreciation results cancellation through page-common wrapper");
  assert.equal(exportButton.disabled, false);
  assert(resultCalls.some((message) => message.operation === "select_output_directory"));
  assert(!resultCalls.some((message) => message.operation === "export"), "cancelled directory selection must not start export");
  globals.push("standalone results export cancellation");
  dom.window.close();

  Object.assign(globalThis, original);
  checks.push(`折旧独立 HTML 页真实 Native 队列 wrapper：${globals.join("，")}；反馈长路径在页面内换行`);
}

async function main() {
  const unhandled = (reason) => failures.push(String(reason?.message || reason));
  process.on("unhandledRejection", unhandled);
  try {
    await testLandDirectoryFeedback();
    await testRelatedModuleButtons();
    await testTableAndWorkbookInputs();
    await testDepreciationModuleWrapper();
    await testMacDepreciationPickerCancellation();
    await testDepreciationStandalonePages();
    await nextTurn();
    assert.deepEqual(failures, [], "picker DOM flows must not create unhandled Promise rejections");
    const result = { schemaVersion: 1, suite: "native-picker-feedback-regression", status: "passed", checks, unhandledRejections: failures };
    const outputPath = process.argv[2];
    if (outputPath) {
      fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
      fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    process.off("unhandledRejection", unhandled);
  }
}

await main();
