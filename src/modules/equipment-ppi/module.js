import { showUserErrorDiagnostics } from "../../core/user-errors.js";
import { equipmentPpiTemplate } from "./template.js";

const MODULE_ID = "equipment-ppi-update";
const DEFAULT_CONFIG = { workbookPath: "", workspacePath: "", recentMonths: 6 };
const BUTTON_IDS = [
  "equipmentPpiStatus", "equipmentPpiInitialize", "equipmentPpiFetch", "equipmentPpiMerge",
  "equipmentPpiVerify", "equipmentPpiPreview", "equipmentPpiDryRun", "equipmentPpiApply",
  "chooseEquipmentPpiWorkbook", "chooseEquipmentPpiWorkspace",
];

function byId(documentRef, id) { return documentRef.getElementById(id); }

function failureMessage(result = {}) {
  const messages = {
    EQUIPMENT_PPI_WORKSPACE_REQUIRED: "请先选择独立工作目录。",
    EQUIPMENT_PPI_WORKBOOK_REQUIRED: "请先选择有效的 PPI 工作簿。",
    EQUIPMENT_PPI_BASELINE_EXISTS: result.message || "基线已存在，没有覆盖。",
    EQUIPMENT_PPI_NATIVE_APPLY_UNSUPPORTED: result.message || "当前平台不能安全写入原工作簿，可生成预览副本。",
    EQUIPMENT_PPI_NATIVE_EDITOR_MISSING: "未检测到可用的 Windows Excel/WPS 原生编辑组件；原工作簿未写入。请检查本机 Python 的 pywin32 组件后重试。",
    EQUIPMENT_PPI_TIMEOUT: "PPI 操作超时。请检查网络或 NBS 响应后重试；原工作簿未被自动改写。",
    EQUIPMENT_PPI_SKILL_MISSING: "设备价格指数技能文件不完整，请修复或重新安装本机助手。",
    EQUIPMENT_PPI_OPERATION_FAILED: "PPI 步骤未完成。请查看下方诊断信息后重试。",
    EQUIPMENT_PPI_RESULT_MISSING: "技能没有生成预期结果文件。请查看输出目录和诊断信息后重试。",
    EQUIPMENT_PPI_START_FAILED: "无法启动 PPI 技能。请检查本机助手和便携 Python。",
    NATIVE_HELPER_TIMEOUT: "本机助手响应超时，请检查运行环境后重试。",
    NATIVE_STREAM_IDLE_TIMEOUT: "技能长时间没有返回进度。请检查网络或本机运行环境后重试。",
    NATIVE_HOST_START_FAILED: "无法连接本机助手，请检查安装状态后重试。",
    NATIVE_EXPORT_CONNECTION_CLOSED: "本机助手连接中断，请检查安装状态后重试。",
    PYTHON_NOT_FOUND: "本机 Python 运行组件不可用，请修复或重新安装本机助手。",
  };
  if (messages[result.reason]) return messages[result.reason];
  const candidate = String(result.message || "").trim();
  return candidate && !/^[A-Z][A-Z0-9_:-]{2,}$/.test(candidate)
    ? candidate
    : "PPI 操作失败，请检查工作簿、网络连接和本机助手。";
}

export const equipmentPpiModule = {
  manifest: {
    id: MODULE_ID,
    type: "feature",
    stage: "development",
    route: MODULE_ID,
    displayName: "设备价格指数更新（PPI）",
    messageNamespace: MODULE_ID,
    entryElementId: "openEquipmentPpi",
    pageElementId: "page-equipment-ppi-update",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let config = { ...DEFAULT_CONFIG };
    let elements = {};
    let running = false;
    let supportsNativeApply = false;

    function renderGate() {
      const readyWorkspace = Boolean(config.workspacePath);
      const readyWorkbook = Boolean(config.workbookPath);
      elements.equipmentPpiGate.textContent = !readyWorkspace
        ? "请先选择工作目录。基线、增量数据和预览文件会放在这个独立目录。"
        : !readyWorkbook
          ? "已设置工作目录；选择 PPI 工作簿后可核对、预览或回填。抓取和基线管理不要求先选底稿。"
          : "工作目录与 PPI 底稿已就绪。原底稿仅在确认“回填原底稿”后写入。";
      elements.equipmentPpiGate.dataset.kind = readyWorkspace ? "ok" : "warn";
      elements.equipmentPpiBusyBadge.textContent = running ? "处理中" : readyWorkspace ? "已就绪" : "待配置";
      for (const id of BUTTON_IDS) if (elements[id]) elements[id].disabled = running;
      elements.equipmentPpiRecentMonths.disabled = running;
      elements.equipmentPpiStatus.disabled = running || !readyWorkspace;
      elements.equipmentPpiInitialize.disabled = running || !readyWorkspace;
      elements.equipmentPpiFetch.disabled = running || !readyWorkspace;
      elements.equipmentPpiMerge.disabled = running || !readyWorkspace;
      for (const id of ["equipmentPpiVerify", "equipmentPpiPreview", "equipmentPpiDryRun", "equipmentPpiApply"])
        elements[id].disabled = running || !readyWorkspace || !readyWorkbook;
      elements.equipmentPpiDryRun.disabled = running || !readyWorkspace || !readyWorkbook || !supportsNativeApply;
      elements.equipmentPpiApply.disabled = running || !readyWorkspace || !readyWorkbook || !supportsNativeApply;
      elements.equipmentPpiProgressBar.classList.toggle("is-running", running);
    }

    async function persist() {
      config.recentMonths = Math.min(24, Math.max(1, Number(elements.equipmentPpiRecentMonths.value) || 6));
      await context.storage.save(config);
    }

    function showOutput(text, kind = "") {
      elements.equipmentPpiOutput.textContent = String(text || "");
      elements.equipmentPpiOutput.dataset.kind = kind;
    }

    function showPathFeedback(text, kind = "") {
      elements.equipmentPpiPathFeedback.textContent = String(text || "");
      elements.equipmentPpiPathFeedback.dataset.kind = kind;
    }

    async function chooseWorkbook() {
      if (running) return;
      running = true;
      renderGate();
      showPathFeedback("正在打开系统文件选择窗口…", "");
      try {
        const result = await context.sendNativeMessage({ action: "select_equipment_ppi_workbook" }, 130000);
        if (result?.cancelled) {
          showPathFeedback("已取消选择 PPI 工作簿，原选择保持不变。", "warn");
          return;
        }
        if (!result?.ok || !result.path) {
          showPathFeedback(`${failureMessage(result)} 当前选择保持不变。`, "error");
          return;
        }
        config.workbookPath = result.path;
        elements.equipmentPpiWorkbook.value = config.workbookPath;
        await persist();
        showPathFeedback("已选择 PPI 工作簿。确认它包含“全年(更新此表数据）”工作表。", "ok");
      } catch (error) {
        showUserErrorDiagnostics(error, context.document);
        showPathFeedback(`${failureMessage({ reason: String(error?.message || error) })} 当前选择保持不变。`, "error");
      } finally {
        running = false;
        renderGate();
      }
    }

    async function chooseWorkspace() {
      if (running) return;
      running = true;
      renderGate();
      showPathFeedback("正在打开系统文件夹选择窗口…", "");
      try {
        const result = await context.sendNativeMessage({ action: "select_equipment_ppi_workspace" }, 130000);
        if (result?.cancelled) {
          showPathFeedback("已取消选择工作目录，原目录保持不变。", "warn");
          return;
        }
        const selected = result?.outputDirectory || result?.path || "";
        if (!result?.ok || !selected) {
          showPathFeedback(`${failureMessage(result)} 当前目录保持不变。`, "error");
          return;
        }
        config.workspacePath = selected;
        elements.equipmentPpiWorkspace.value = config.workspacePath;
        await persist();
        const directoryName = result.directoryName || "设备价格指数更新";
        showPathFeedback(`${result.createdDirectory === false ? "已选择" : "已创建并选择"}专用工作目录：${directoryName}`, "ok");
      } catch (error) {
        showUserErrorDiagnostics(error, context.document);
        showPathFeedback(`${failureMessage({ reason: String(error?.message || error) })} 当前目录保持不变。`, "error");
      } finally {
        running = false;
        renderGate();
      }
    }

    async function run(operation) {
      if (running) return;
      if (!config.workspacePath) return;
      if (["verify", "preview", "apply_dry_run", "apply"].includes(operation) && !config.workbookPath) return;
      if (["apply", "apply_dry_run"].includes(operation) && !supportsNativeApply) {
        showOutput("此操作需要 Windows 上的 WPS/Excel 原生组件。可在当前平台继续抓取、核对和生成预览副本。", "warn");
        return;
      }
      if (operation === "apply" && !window.confirm("将通过 WPS/Excel 原生编辑把空白或 0 值补入所选原底稿。技能会先创建带时间戳的备份；已有非零值不会覆盖。继续吗？")) return;
      await persist();
      running = true;
      elements.equipmentPpiProgress.textContent = operation === "fetch_recent" ? "连接国家统计局并增量抓取…" : "正在运行技能步骤…";
      elements.equipmentPpiProgressBar.style.width = "0%";
      showOutput("", "");
      renderGate();
      try {
        const message = {
          action: "run_equipment_ppi",
          operation,
          workspacePath: config.workspacePath,
          workbookPath: config.workbookPath,
          recentMonths: config.recentMonths,
        };
        const result = await context.streamNativeMessage(message, (progress) => {
          elements.equipmentPpiProgress.textContent = String(progress.message || "正在运行…");
        });
        const output = String(result?.output || "").trim();
        if (result?.ok) {
          elements.equipmentPpiProgressBar.classList.remove("is-running");
          elements.equipmentPpiProgressBar.style.width = "100%";
          elements.equipmentPpiProgress.textContent = operation === "status" ? "基线状态读取完成" : "步骤完成";
          showOutput(output || "操作已完成。", "ok");
        } else {
          elements.equipmentPpiProgressBar.classList.remove("is-running");
          elements.equipmentPpiProgressBar.style.width = "100%";
          elements.equipmentPpiProgress.textContent = "步骤未完成";
          const stderr = Array.isArray(result?.diagnostics?.stderrTail)
            ? result.diagnostics.stderrTail.join("\n")
            : String(result?.diagnostics?.stderrTail || "");
          const detail = [failureMessage(result), output, stderr].filter(Boolean).join("\n\n");
          showOutput(detail, "error");
        }
      } catch (error) {
        showUserErrorDiagnostics(error, context.document);
        elements.equipmentPpiProgressBar.classList.remove("is-running");
        elements.equipmentPpiProgressBar.style.width = "100%";
        elements.equipmentPpiProgress.textContent = "连接失败";
        showOutput(failureMessage({ reason: String(error?.message || error) }), "error");
      } finally {
        running = false;
        renderGate();
      }
    }

    function bind(id, handler) { elements[id]?.addEventListener("click", handler); }

    return {
      async initialize(moduleContext) {
        context = moduleContext;
        const page = byId(moduleContext.document, "page-equipment-ppi-update");
        page.innerHTML = equipmentPpiTemplate;
        elements = Object.fromEntries([
          "page-equipment-ppi-update", "openEquipmentPpi", "backFromEquipmentPpi", "equipmentPpiWorkbook",
          "equipmentPpiWorkspace", "equipmentPpiPathFeedback", "chooseEquipmentPpiWorkbook", "chooseEquipmentPpiWorkspace",
          "equipmentPpiRecentMonths", "equipmentPpiBusyBadge", "equipmentPpiGate", "equipmentPpiProgress",
          "equipmentPpiProgressBar", "equipmentPpiOutput", ...BUTTON_IDS,
        ].map((id) => [id, byId(moduleContext.document, id)]));
        config = { ...DEFAULT_CONFIG, ...(await context.storage.load({}) || {}) };
        elements.equipmentPpiWorkbook.value = config.workbookPath;
        elements.equipmentPpiWorkspace.value = config.workspacePath;
        config.recentMonths = Math.min(24, Math.max(1, Number(config.recentMonths) || 6));
        elements.equipmentPpiRecentMonths.value = config.recentMonths;
        elements["page-equipment-ppi-update"].dataset.moduleId = MODULE_ID;
        try {
          const platform = await context.chrome.runtime.getPlatformInfo();
          supportsNativeApply = platform?.os === "win";
        } catch {
          supportsNativeApply = /Win/i.test(String(context.document.defaultView?.navigator?.platform || ""));
        }
        if (!supportsNativeApply) {
          showPathFeedback("当前平台可抓取、核对和生成预览；原底稿回填需要 Windows WPS/Excel。", "warn");
        }
        bind("chooseEquipmentPpiWorkbook", chooseWorkbook);
        bind("chooseEquipmentPpiWorkspace", chooseWorkspace);
        bind("equipmentPpiStatus", () => run("status"));
        bind("equipmentPpiInitialize", () => run("initialize"));
        bind("equipmentPpiFetch", () => run("fetch_recent"));
        bind("equipmentPpiMerge", () => run("merge"));
        bind("equipmentPpiVerify", () => run("verify"));
        bind("equipmentPpiPreview", () => run("preview"));
        bind("equipmentPpiDryRun", () => run("apply_dry_run"));
        bind("equipmentPpiApply", () => run("apply"));
        bind("backFromEquipmentPpi", () => context.navigate("home"));
        bind("openEquipmentPpi", () => context.navigate(MODULE_ID));
        elements.equipmentPpiRecentMonths.addEventListener("change", persist);
        renderGate();
      },
      activate() { renderGate(); },
      deactivate() {},
      dispose() {},
    };
  },
};
