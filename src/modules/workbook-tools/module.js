import { userErrorMessage, showUserErrorDiagnostics } from "../../core/user-errors.js";
import { invalidatePickerFeedback, runNativePickerFeedback } from "../../core/native-picker-feedback.js";

// 三个本地 Excel 工具共用交互；只调用工具箱本机助手，不连接天源页面。
let activeJob = null;
const jobs = new Set();
const modes = new Set(["copy_in_source", "overwrite", "new_directory"]);

const definitions = [
  { id: "detail-print-format", name: "明细表打印格式", type: "detail", description: "设置 A4 横向、一页宽度、列宽、打印区域及页脚。", hint: "支持 .xlsx / .xlsm；建议先处理副本，在 Excel/WPS 打印预览中复核。" },
  { id: "declaration-print-format", name: "申报表打印格式", type: "declaration", description: "整理申报表标题、显示列、汇总页与打印格式。", hint: "支持 .xlsx / .xlsm；将隐藏申报表不需要的评估列，并调整标题及空行。" },
  { id: "detail-formula-restore", name: "明细表公式恢复", type: "link", description: "恢复明细表汇总链接并生成对比报告。", hint: "仅支持 .xlsx 资产基础法明细表（表1～表6模板）；恢复后须复核对比报告和 Excel 实算结果。" },
];

function failureText(error) {
  const reason = String(error?.reason || error?.message || error || "");
  if (/APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED|UNKNOWN_ACTION/.test(reason)) return "本机助手尚未更新，不支持此功能。请安装当前平台的完整安装包，确认本机助手更新后重新加载原插件。";
  if (/FILE_PICKER_FAILED/.test(reason)) return "系统文件选择窗口未能打开，请复制诊断详情检查本机助手。";
  if (/SCRIPT_NOT_FOUND|PYTHON_DEPENDENCY_MISSING|No module named/.test(reason)) return "本机处理组件不完整，请安装含这三个开发模块的完整包。";
  if (/NO_PRINT_WORKBOOKS_FOUND/.test(reason)) return "没有找到可处理的 Excel 文件，请检查所选文件或文件夹。";
  if (/PermissionError|EACCES|EPERM|WinError 5/.test(reason)) return "文件可能正被 Excel/WPS 占用，请保存并关闭该文件后重试。";
  return userErrorMessage(reason, "文件处理未完成，请检查文件格式、模板和本机组件；可复制诊断详情。" );
}

export const workbookToolModules = definitions.map(definition => ({
  manifest: {
    id: definition.id, route: definition.id, displayName: definition.name,
    type: "feature", stage: "development", countInModuleBadge: false,
    messageNamespace: definition.id, entryElementId: `open-${definition.id}`,
    pageElementId: `page-${definition.id}`, storageVersion: 1,
    usesLegacyScope: false, scope: { companies: false, subjects: false },
  },
  create() {
    let context, root, controls;
    let inputs = [];
    let config = { outputMode: "copy_in_source", outputDirectory: "" };
    let selecting = false;
    let selectingEpoch = 0;
    const pickerGuard = {};
    const job = { refresh: () => renderGate() };
    const fileName = value => String(value || "").split(/[\\/]/).pop();
    function message(text, kind = "") {
      controls.message.textContent = text;
      controls.message.dataset.kind = kind;
      context.setStatus(text, kind === "error" ? "error" : kind === "warn" ? "warn" : kind === "ok" ? "ok" : "idle");
      if (kind === "error") controls.message.scrollIntoView?.({ block: "nearest" });
    }
    function renderGate() {
      const busy = Boolean(activeJob) || selecting;
      const reason = busy ? "正在处理或选择文件，请稍候" : !inputs.length ? "请先选择 Excel 文件或文件夹" : config.outputMode === "new_directory" && !config.outputDirectory ? "请先选择输出目录" : "";
      controls.run.disabled = Boolean(reason);
      controls.gate.textContent = reason ? `暂时无法开始执行：${reason}` : "";
      controls.gate.dataset.kind = reason ? "warn" : "";
      for (const name of ["files", "folder", "clear", "output", "mode"]) controls[name].disabled = busy;
      controls.clear.disabled = busy || !inputs.length;
      controls.directoryWrap.classList.toggle("hidden", config.outputMode !== "new_directory");
      controls.mode.value = config.outputMode;
      controls.directory.value = config.outputDirectory;
    }
    function refreshAll() { for (const item of jobs) item.refresh(); }
    function renderInputs() {
      controls.inputs.replaceChildren();
      for (const value of inputs) {
        const li = context.document.createElement("li");
        li.textContent = fileName(value); li.title = value;
        controls.inputs.appendChild(li);
      }
      controls.count.textContent = inputs.length ? `${inputs.length} 项输入` : "尚未选择文件";
      renderGate();
    }
    function progress(payload) {
      const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
      controls.progress.value = percent;
      controls.percent.textContent = `${percent}%`;
      // Python 日志留在诊断中，界面只显示阶段和计数。
      controls.progressText.textContent = payload.event === "complete" ? "处理结束" : `正在处理 ${payload.current || 0}/${payload.total || inputs.length}`;
    }
    async function select(kind) {
      if (activeJob || pickerGuard.busy) return;
      const epoch = ++selectingEpoch;
      try {
        return await runNativePickerFeedback({
          button: kind === "files" ? controls.files : controls.folder,
          documentRef: context.document,
          guard: pickerGuard,
          setStatus: context.setStatus,
          onBusyChange: (busy) => { selecting = busy; refreshAll(); },
          busyText: kind === "files" ? "正在打开 Excel 文件选择窗口，请完成选择…" : "正在打开工作簿文件夹选择窗口…",
          cancelText: kind === "files" ? "已取消文件选择，原文件列表保留。" : "已取消文件夹选择，原输入保留。",
          failurePrefix: kind === "files" ? "选择工作簿失败" : "选择工作簿文件夹失败",
          errorMessage: failureText,
          request: () => context.sendNativeMessage({ action: kind === "files" ? "select_print_workbook_files" : "select_print_workbook_directory" }, 130000),
          resolveSelection: (result) => kind === "files"
            ? [...new Set(Array.isArray(result.paths) ? result.paths : [])]
            : result.path || result.paths?.[0] || "",
          onSelected: (_result, selected) => {
            const paths = Array.isArray(selected) ? selected : [selected];
            if (definition.type === "link" && kind === "files" && paths.some(value => !/\.xlsx$/i.test(value))) {
              return { handled: true, text: "公式恢复仅支持 .xlsx，请重新选择；宏工作簿暂不支持。原文件列表保留。", kind: "warn" };
            }
            inputs = paths;
            renderInputs();
          },
          successText: (_result, selected) => kind === "folder"
            ? `已选择工作簿文件夹：${selected}。将递归处理其中的工作簿；请使用单独的待处理文件夹。`
            : `已选择 ${selected.length} 个工作簿，请确认输出方式。${selected[0] ? ` 首个文件：${selected[0]}` : ""}`,
        });
      } finally {
        if (epoch !== selectingEpoch) return;
        if (!pickerGuard.busy) { selecting = false; refreshAll(); }
      }
    }
    async function selectOutput() {
      if (activeJob || pickerGuard.busy) return;
      const epoch = ++selectingEpoch;
      try {
        return await runNativePickerFeedback({
          button: controls.output,
          documentRef: context.document,
          guard: pickerGuard,
          setStatus: context.setStatus,
          onBusyChange: (busy) => { selecting = busy; refreshAll(); },
          busyText: "正在打开工作簿成果目录选择窗口…",
          cancelText: "已取消输出目录选择，原目录保留。",
          failurePrefix: "选择输出目录失败",
          errorMessage: failureText,
          request: () => context.sendNativeMessage({ action: "select_print_output_directory", directoryName: definition.name }, 130000),
          onSelected: (_result, selected) => { config.outputDirectory = selected; renderGate(); },
          persist: () => context.storage.save(config),
          successText: (result, selected) => `${result.createdDirectory === false ? "已复用" : "已创建并选择"}专用成果子文件夹“${result.directoryName || definition.name}”：${selected}`,
        });
      } finally {
        if (epoch !== selectingEpoch) return;
        if (!pickerGuard.busy) { selecting = false; refreshAll(); }
      }
    }
    function renderResults(results) {
      controls.results.replaceChildren();
      for (const item of results || []) {
        const li = context.document.createElement("li");
        const label = context.document.createElement("span");
        label.textContent = `${fileName(item.sourcePath)}：${item.ok ? "处理完成（文件完整性已校验）" : failureText(item)}`;
        li.appendChild(label);
        if (item.ok) for (const [path, title] of [[item.outputPath, "打开文件"], [item.reportPath, "打开对比报告"]]) {
          if (!path) continue;
          const button = context.document.createElement("button");
          button.type = "button"; button.className = "secondary"; button.textContent = title;
          button.addEventListener("click", async () => {
            try {
              const reply = await context.sendNativeMessage({ action: "open_print_workbook_path", path });
              if (!reply.ok) throw Object.assign(new Error(reply.reason), { diagnostics: reply.diagnostics });
              message("已请求打开文件，请在 Excel/WPS 中复核。", "ok");
            } catch (error) { message(failureText(error), "error"); showUserErrorDiagnostics(error, context.document); }
          });
          li.appendChild(button);
        }
        controls.results.appendChild(li);
      }
    }
    async function run() {
      if (activeJob || selecting || !inputs.length || (config.outputMode === "new_directory" && !config.outputDirectory)) return;
      if (config.outputMode === "overwrite" && !context.document.defaultView.confirm("将覆盖所选文件或文件夹中的原工作簿。请确认已另存备份，再继续执行。")) {
        message("已取消覆盖，原文件未修改。", "warn"); return;
      }
      activeJob = job; refreshAll(); renderResults([]);
      message("正在处理，请勿关闭侧栏或打开待处理工作簿。", "");
      try {
        const result = await context.streamNativeMessage({
          action: definition.type === "link" ? "run_link_restore" : "run_print_format",
          formatType: definition.type, inputPaths: [...inputs], outputMode: config.outputMode,
          outputDir: config.outputMode === "new_directory" ? config.outputDirectory : "",
        }, progress);
        progress(result); renderResults(result.results);
        if (!result.ok) {
          message(`处理未全部完成：成功 ${result.successCount || 0}，失败 ${result.failedCount || 0}。${failureText(result)}`, "warn");
        } else {
          message(`处理完成：${result.successCount || 0} 个工作簿。${definition.type === "link" ? "请复核对比报告及 Excel 实算结果。" : "请复核 Excel/WPS 打印预览。"}`, "ok");
        }
      } catch (error) { message(failureText(error), "error"); showUserErrorDiagnostics(error, context.document); }
      finally { activeJob = null; refreshAll(); }
    }
    return {
      async initialize(nextContext) {
        context = nextContext;
        root = context.document.getElementById(context.manifest.pageElementId);
        const prefix = definition.id;
        const id = name => `${prefix}-${name}`;
        root.dataset.moduleId = prefix;
        root.innerHTML = `
          <div class="page-heading"><div><h2>${definition.name}</h2><p>${definition.description}</p></div><button id="${id("back")}" type="button" class="secondary">返回首页</button></div>
          <section class="section workbook-tool-panel">
            <p class="hint">开发中 · 尚未完成评估工具箱实机验收</p><p class="hint">${definition.hint}</p>
            <div class="button-row"><button id="${id("files")}" type="button" class="secondary">选择文件</button><button id="${id("folder")}" type="button" class="secondary">选择文件夹</button><button id="${id("clear")}" type="button" class="secondary">清空</button></div>
            <p id="${id("count")}"></p><ul id="${id("inputs")}" class="workbook-file-list"></ul>
            <label class="field-block"><span>输出方式</span><select id="${id("mode")}"><option value="copy_in_source">在源文件夹生成副本（推荐）</option><option value="new_directory">保存到新的位置</option><option value="overwrite">直接覆盖原文件（需确认）</option></select></label>
            <div id="${id("directoryWrap")}" class="directory-field hidden"><span>输出目录</span><div class="directory-row"><input id="${id("directory")}" type="text" readonly placeholder="请选择本机文件夹"><button id="${id("output")}" type="button" class="secondary">选择</button></div></div>
            <div class="export-progress" aria-live="polite"><div class="progress-heading"><span id="${id("progressText")}">等待执行</span><strong id="${id("percent")}">0%</strong></div><progress id="${id("progress")}" max="100" value="0"></progress></div>
            <p id="${id("gate")}" class="hint"></p><div class="task-actions"><button id="${id("run")}" type="button">${definition.type === "link" ? "执行恢复" : "执行调整"}</button></div>
            <p id="${id("message")}" class="hint" role="status" aria-live="polite"></p><ul id="${id("results")}" class="workbook-file-list"></ul>
          </section>`;
        controls = Object.fromEntries(["back", "files", "folder", "clear", "count", "inputs", "mode", "directoryWrap", "directory", "output", "progressText", "percent", "progress", "gate", "run", "message", "results"].map(name => [name, context.document.getElementById(id(name))]));
        const saved = await context.storage.load({});
        config = { outputMode: modes.has(saved.outputMode) ? saved.outputMode : "copy_in_source", outputDirectory: String(saved.outputDirectory || "") };
        context.scope.on(context.document.getElementById(context.manifest.entryElementId), "click", () => context.navigate(prefix));
        context.scope.on(controls.back, "click", () => context.navigate("home"));
        context.scope.on(controls.files, "click", () => select("files"));
        context.scope.on(controls.folder, "click", () => select("folder"));
        context.scope.on(controls.output, "click", selectOutput);
        context.scope.on(controls.clear, "click", () => { if (activeJob || selecting) return; inputs = []; renderInputs(); });
        context.scope.on(controls.mode, "change", async () => { config.outputMode = controls.mode.value; renderGate(); await context.storage.save(config); });
        context.scope.on(controls.run, "click", run);
        jobs.add(job); context.scope.add(() => jobs.delete(job));
        renderInputs();
      },
      activate() { renderGate(); },
      deactivate() { selectingEpoch += 1; invalidatePickerFeedback(pickerGuard); selecting = false; refreshAll(); },
      dispose() { selectingEpoch += 1; invalidatePickerFeedback(pickerGuard); selecting = false; refreshAll(); },
    };
  },
}));
