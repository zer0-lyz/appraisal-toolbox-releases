import { tableFormatTemplate } from "./template.js";

const DEFAULT_CONFIG = {
  outputMode: "copy_in_source",
  outputDirectory: "",
};

function elementMap(documentRef) {
  const ids = [
    "openTableFormat",
    "page-table-format",
    "backFromTableFormat",
    "chooseTableFormatFiles",
    "clearTableFormatFiles",
    "tableFormatInputCount",
    "tableFormatFileList",
    "tableFormatOutputMode",
    "tableFormatOutputDirectoryWrap",
    "tableFormatOutputDirectory",
    "chooseTableFormatOutput",
    "tableFormatProgressText",
    "tableFormatProgressPercent",
    "tableFormatProgressBar",
    "tableFormatTotalCount",
    "tableFormatSuccessCount",
    "tableFormatFailedCount",
    "tableFormatResultMessage",
    "tableFormatResultList",
    "runTableFormat",
    "tableFormatGate",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const outputMode = ["overwrite", "copy_in_source", "new_directory"].includes(source.outputMode)
    ? source.outputMode
    : DEFAULT_CONFIG.outputMode;
  return {
    ...DEFAULT_CONFIG,
    outputMode,
    outputDirectory: String(source.outputDirectory || "").trim(),
  };
}

function fileName(filePath) {
  return String(filePath || "").split(/[\\/]/).pop() || String(filePath || "");
}

function tableFormatFailureMessage(reason) {
  const value = String(reason || "");
  if (value.includes("TABLE_FORMAT_INVALID_DOCX_NOT_ZIP")) {
    return "不是有效的 .docx 文件：文件不是 Office Open XML 压缩包，可能是旧式 .doc 或文件未完整下载。";
  }
  if (value.includes("TABLE_FORMAT_INVALID_DOCX_MISSING_MEMBER")) {
    return "不是完整的 .docx 文件：缺少 word/document.xml，请重新导出或下载后再试。";
  }
  if (value.includes("TABLE_FORMAT_INVALID_DOCX_CORRUPT_MEMBER")) {
    return ".docx 文件已损坏：内部文件无法读取，请使用 Word/WPS 另存为新的 .docx 后再试。";
  }
  if (value.includes("TABLE_FORMAT_PYTHON_DEPENDENCY_MISSING")) {
    return "本机表格设置运行组件不完整，请重新安装工作台本机运行组件。";
  }
  return value || "未知原因";
}

export const tableFormatModule = {
  manifest: {
    id: "table-format",
    type: "feature",
    stage: "stable",
    route: "table-format",
    displayName: "表格设置",
    messageNamespace: "table-format",
    entryElementId: "openTableFormat",
    pageElementId: "page-table-format",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let config = { ...DEFAULT_CONFIG };
    let inputPaths = [];
    let running = false;

    // 主操作门禁：按钮禁用态与前置条件实时同步，原因紧贴按钮持续显示。
    function renderRunGate() {
      const button = elements.runTableFormat;
      const gate = elements.tableFormatGate;
      if (!button) return;
      let reason = "";
      if (running) {
        reason = "正在执行表格设置…";
      } else if (!inputPaths.length) {
        reason = "请先选择至少一个 .docx 文件";
      } else if (config.outputMode === "new_directory" && !config.outputDirectory) {
        reason = "当前输出方式需要先选择目标文件夹";
      }
      const blocked = Boolean(reason);
      button.disabled = blocked;
      if (gate) {
        gate.textContent = blocked ? `暂时无法开始执行：${reason}` : "";
        gate.dataset.kind = blocked ? "warn" : "";
      }
    }

    function renderInputList() {
      const paths = [...inputPaths];
      elements.tableFormatInputCount.textContent = paths.length ? `${paths.length} 个文件` : "未选择";
      elements.clearTableFormatFiles.disabled = !paths.length || running;
      renderRunGate();
      elements.tableFormatFileList.innerHTML = "";
      if (!paths.length) {
        const item = context.document.createElement("li");
        item.className = "muted";
        item.textContent = "尚未选择文件";
        elements.tableFormatFileList.appendChild(item);
        return;
      }
      for (const [index, inputPath] of paths.entries()) {
        const item = context.document.createElement("li");
        item.textContent = `${index + 1}. ${fileName(inputPath)}`;
        item.title = inputPath;
        elements.tableFormatFileList.appendChild(item);
      }
    }

    function renderOutputMode() {
      elements.tableFormatOutputMode.value = config.outputMode;
      elements.tableFormatOutputDirectory.value = config.outputDirectory;
      elements.tableFormatOutputDirectoryWrap.classList.toggle(
        "hidden",
        config.outputMode !== "new_directory",
      );
      renderRunGate();
    }

    function renderProgress(payload = {}) {
      const percent = Math.max(0, Math.min(100, Number(payload.percent || 0)));
      elements.tableFormatProgressBar.value = percent;
      elements.tableFormatProgressPercent.textContent = `${percent}%`;
      if (payload.message) elements.tableFormatProgressText.textContent = payload.message;
      if (payload.total !== undefined) elements.tableFormatTotalCount.textContent = String(payload.total);
      if (payload.successCount !== undefined) elements.tableFormatSuccessCount.textContent = String(payload.successCount);
      if (payload.failedCount !== undefined) elements.tableFormatFailedCount.textContent = String(payload.failedCount);
    }

    function renderResults(results = []) {
      elements.tableFormatResultList.innerHTML = "";
      for (const result of results) {
        const item = context.document.createElement("li");
        item.dataset.kind = result.ok ? "ok" : "error";
        item.textContent = result.ok
          ? `已完成：${fileName(result.outputPath || result.sourcePath)}${result.tableCount !== undefined ? `（${result.tableCount} 个表格）` : ""}${result.clearedShadingCells ? `，清除 ${result.clearedShadingCells} 个底纹单元格` : ""}${result.repairedRelationships ? `，修复 ${result.repairedRelationships} 个无效关系` : ""}${result.cleanedRemarkValues ? `，清理 ${result.cleanedRemarkValues} 个备注占位值` : ""}`
          : `失败：${fileName(result.sourcePath)}，${tableFormatFailureMessage(result.reason)}`;
        elements.tableFormatResultList.appendChild(item);
      }
    }

    async function chooseFiles() {
      if (running) return;
      try {
        const result = await context.sendNativeMessage({ action: "select_table_format_word_files" }, 130000);
        if (!result?.ok) {
          if (result?.cancelled) {
            context.setStatus("已取消选择 Word 文档", "warn");
            return;
          }
          throw new Error(result?.reason || "TABLE_FORMAT_INPUT_SELECTION_FAILED");
        }
        inputPaths = [...new Set(Array.isArray(result.paths) ? result.paths : [])];
        renderInputList();
        renderProgress({ percent: 0, total: inputPaths.length, successCount: 0, failedCount: 0, message: `已选择 ${inputPaths.length} 个 Word 文档` });
        setMessage(elements.tableFormatResultMessage, "文件已选择，请确认输出方式后开始执行。", "ok");
        context.setStatus(`已选择 ${inputPaths.length} 个 Word 文档`, "ok");
      } catch (error) {
        setMessage(elements.tableFormatResultMessage, `选择文件失败：${error?.message || String(error)}`, "error");
        context.setStatus(`选择文件失败：${error?.message || String(error)}`, "error");
      }
    }

    async function chooseOutputDirectory() {
      if (running) return;
      try {
        const result = await context.sendNativeMessage({ action: "select_table_format_output_directory" }, 130000);
        if (!result?.ok) {
          if (result?.cancelled) {
            context.setStatus("已取消选择目标文件夹", "warn");
            return;
          }
          throw new Error(result?.reason || "TABLE_FORMAT_OUTPUT_SELECTION_FAILED");
        }
        config.outputDirectory = String(result.outputDirectory || result.path || result.paths?.[0] || "");
        elements.tableFormatOutputDirectory.value = config.outputDirectory;
        await context.storage.save(config);
        setMessage(elements.tableFormatResultMessage, `已选择并创建专用子文件夹：${result.directoryName || "表格格式设置"}。`, "ok");
        context.setStatus(`已选择目标文件夹：${config.outputDirectory}`, "ok");
      } catch (error) {
        setMessage(elements.tableFormatResultMessage, `选择目标文件夹失败：${error?.message || String(error)}`, "error");
        context.setStatus(`选择目标文件夹失败：${error?.message || String(error)}`, "error");
      }
    }

    async function run() {
      if (running) return;
      if (!inputPaths.length) {
        setMessage(elements.tableFormatResultMessage, "请先选择一个或多个 .docx 文件。", "error");
        context.setStatus("表格设置缺少输入文件", "error");
        return;
      }
      if (config.outputMode === "new_directory" && !config.outputDirectory) {
        setMessage(elements.tableFormatResultMessage, "请先选择指定的目标文件夹。", "error");
        context.setStatus("表格设置缺少目标文件夹", "error");
        return;
      }
      running = true;
      renderRunGate();
      elements.clearTableFormatFiles.disabled = true;
      renderResults([]);
      renderProgress({ percent: 1, total: inputPaths.length, successCount: 0, failedCount: 0, message: "正在准备表格设置" });
      setMessage(elements.tableFormatResultMessage, "正在逐个处理并验证 Word 文档，请不要关闭工作台。", "");
      context.setStatus("正在执行 Word 表格设置…", "idle");
      try {
        const result = await context.streamNativeMessage({
          action: "run_table_format",
          inputPaths: [...inputPaths],
          outputMode: config.outputMode,
          outputDir: config.outputMode === "new_directory" ? config.outputDirectory : "",
        }, (progress) => {
          renderProgress(progress);
          if (progress.results) renderResults(progress.results);
          if (progress.message) context.setStatus(progress.message, "idle");
        });
        renderProgress(result);
        renderResults(result.results || []);
        if (!result?.ok) {
          setMessage(elements.tableFormatResultMessage, `处理完成，但有 ${result.failedCount || 0} 个文件失败。`, "warn");
          context.setStatus("表格设置完成，但存在失败文件", "warn");
        } else {
          setMessage(elements.tableFormatResultMessage, `全部完成：${result.successCount || 0} 个文件，文档已校验。`, "ok");
          context.setStatus("Word 表格设置完成，全部文件校验通过", "ok");
        }
      } catch (error) {
        renderProgress({ percent: 0, message: `执行失败：${error?.message || String(error)}` });
        setMessage(elements.tableFormatResultMessage, error?.message || String(error), "error");
        context.setStatus(`表格设置失败：${error?.message || String(error)}`, "error");
      } finally {
        running = false;
        renderInputList();
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("TABLE_FORMAT_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = tableFormatTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/table-format/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        config = normalizeConfig(await context.storage.load({}));
        context.scope.on(elements.openTableFormat, "click", () => context.navigate("table-format"));
        context.scope.on(elements.backFromTableFormat, "click", () => context.navigate("home"));
        context.scope.on(elements.chooseTableFormatFiles, "click", chooseFiles);
        context.scope.on(elements.clearTableFormatFiles, "click", () => {
          if (running) return;
          inputPaths = [];
          renderInputList();
          renderProgress({ percent: 0, total: 0, successCount: 0, failedCount: 0, message: "等待选择文件" });
          setMessage(elements.tableFormatResultMessage, "已清空文件选择。", "");
        });
        context.scope.on(elements.tableFormatOutputMode, "change", async () => {
          config.outputMode = elements.tableFormatOutputMode.value;
          renderOutputMode();
          await context.storage.save(config);
        });
        context.scope.on(elements.chooseTableFormatOutput, "click", chooseOutputDirectory);
        context.scope.on(elements.runTableFormat, "click", run);
        renderInputList();
        renderOutputMode();
        renderProgress({ percent: 0, total: 0, successCount: 0, failedCount: 0, message: "等待选择文件" });
      },
      activate() {
        renderInputList();
        renderOutputMode();
      },
      deactivate() {},
      dispose() {},
    };
  },
};
