"use strict";

const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const execFilePromise = promisify(execFile);
const SECURITY = Object.freeze({ credentialsReturned: false });
const PPI_OPERATIONS = new Set(["status", "initialize", "fetch_recent", "merge", "verify", "preview", "apply_dry_run", "apply"]);
const CLASS_LIFE_OPERATIONS = new Set(["lookup", "create", "page", "save_page", "validate", "export", "close"]);

function createEquipmentSkillHandlers({ skillsDirectory, pythonBin, processLauncher, buildRunnerDiagnostics, appendStderrTail }) {
  const ppiRoot = path.join(skillsDirectory, "equipment-price-index-update");
  const ppiScripts = Object.freeze({
    fetch: path.join(ppiRoot, "scripts", "nbs_ppi.py"),
    baseline: path.join(ppiRoot, "scripts", "ppi_baseline.py"),
    verify: path.join(ppiRoot, "scripts", "verify_ppi.py"),
    preview: path.join(ppiRoot, "scripts", "fill_ppi.py"),
    apply: path.join(ppiRoot, "scripts", "apply_ppi_to_draft.py"),
  });
  const classLifeRunner = path.join(skillsDirectory, "equipment-class-and-life", "scripts", "appraisal_toolbox_runner.py");
  const classLifeValidator = path.join(skillsDirectory, "equipment-class-and-life", "scripts", "verify_fill.py");

  function completePpi(emit, payload) {
    const result = { ...payload, security: SECURITY };
    try { emit(result); } catch { /* The panel may have closed during the operation. */ }
    return result;
  }

  function requireWorkbook(rawPath) {
    const raw = String(rawPath || "").trim();
    if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("EQUIPMENT_SKILL_WORKBOOK_INVALID");
    const resolved = fs.realpathSync(raw);
    if (!fs.statSync(resolved).isFile() || !/\.xlsx?m?$/i.test(resolved)) throw new Error("EQUIPMENT_SKILL_WORKBOOK_INVALID");
    return resolved;
  }

  function runPpi(message, emit) {
    const operation = String(message?.operation || "").trim();
    if (!PPI_OPERATIONS.has(operation)) {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_OPERATION_INVALID", message: "设备价格指数操作类型无效。",
      }));
    }
    const rawWorkspace = String(message?.workspacePath || "").trim();
    if (!rawWorkspace || rawWorkspace.includes("\0") || !path.isAbsolute(rawWorkspace)) {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_WORKSPACE_REQUIRED", message: "请先选择设备价格指数工作目录。",
      }));
    }
    let workspace;
    try { workspace = fs.realpathSync(rawWorkspace); } catch {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_WORKSPACE_INVALID", message: "设备价格指数工作目录无效。",
      }));
    }
    if (!fs.statSync(workspace).isDirectory()) {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_WORKSPACE_INVALID", message: "设备价格指数工作目录无效。",
      }));
    }

    let workbook = "";
    if (["verify", "preview", "apply_dry_run", "apply"].includes(operation)) {
      try { workbook = requireWorkbook(message?.workbookPath); } catch {
        return Promise.resolve(completePpi(emit, {
          ok: false, event: "complete", action: "run_equipment_ppi", operation,
          reason: "EQUIPMENT_PPI_WORKBOOK_REQUIRED", message: "请先选择有效的 PPI 底稿工作簿。",
        }));
      }
    }
    if (["apply", "apply_dry_run"].includes(operation) && process.platform !== "win32") {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_NATIVE_APPLY_UNSUPPORTED",
        message: "原底稿安全写入依赖 Windows 上的 WPS/Excel 原生编辑；本机可以生成预览副本。",
      }));
    }

    const scriptFor = {
      status: ppiScripts.baseline,
      initialize: ppiScripts.baseline,
      fetch_recent: ppiScripts.fetch,
      merge: ppiScripts.baseline,
      verify: ppiScripts.verify,
      preview: ppiScripts.preview,
      apply_dry_run: ppiScripts.apply,
      apply: ppiScripts.apply,
    }[operation];
    if (!fs.existsSync(scriptFor)) {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_SKILL_MISSING", message: "设备价格指数技能文件不完整，请重新安装包含新模块的版本。",
      }));
    }

    const baselinePath = path.join(workspace, "data", "ppi_baseline.json");
    if (operation === "initialize" && fs.existsSync(baselinePath)) {
      return Promise.resolve(completePpi(emit, {
        ok: false, event: "complete", action: "run_equipment_ppi", operation,
        reason: "EQUIPMENT_PPI_BASELINE_EXISTS",
        message: "本地基线已存在。为避免重建覆盖历史数据，请查看基线或合并增量。",
      }));
    }

    const args = {
      status: ["--status"],
      initialize: ["--build"],
      fetch_recent: ["--recent", String(Math.min(24, Math.max(1, Number(message?.recentMonths) || 6)))],
      merge: ["--merge"],
      verify: ["--draft", workbook],
      preview: ["--draft", workbook],
      apply_dry_run: ["--draft", workbook, "--dry-run"],
      apply: ["--draft", workbook],
    }[operation];

    if (["initialize", "fetch_recent", "merge"].includes(operation)) {
      fs.mkdirSync(path.join(workspace, "_out"), { recursive: true });
    }
    let previewOutputPath = "";
    const fetchFallbacks = [];
    if (operation === "preview") {
      const outputDirectory = path.join(workspace, "_out");
      fs.mkdirSync(outputDirectory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const extension = path.extname(workbook).toLowerCase() === ".xlsm" ? ".xlsm" : ".xlsx";
      previewOutputPath = path.join(outputDirectory, `${path.parse(workbook).name}_已补PPI_${stamp}_${randomUUID().slice(0, 8)}${extension}`);
      args.push("--output", previewOutputPath);
    }
    if (operation === "fetch_recent") {
      const outputDirectory = path.join(workspace, "_out");
      const historyDirectory = path.join(outputDirectory, "history");
      fs.mkdirSync(historyDirectory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      for (const name of ["nbs_ppi.json", "nbs_ppi.csv"]) {
        const current = path.join(outputDirectory, name);
        if (fs.existsSync(current)) {
          const backup = path.join(historyDirectory, `${path.parse(name).name}_${stamp}_${randomUUID().slice(0, 6)}${path.extname(name)}`);
          fs.copyFileSync(current, backup);
          fs.unlinkSync(current);
          fetchFallbacks.push({ current, backup, historyDirectory });
        }
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let child;
      let timedOut = false;
      const stdoutLines = [];
      const stderrLines = [];
      const finish = (ok, exitCode, reason = "") => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        let finalOk = ok;
        let finalReason = reason;
        if (finalOk && operation === "initialize" && !fs.existsSync(baselinePath)) {
          finalOk = false;
          finalReason = "EQUIPMENT_PPI_RESULT_MISSING";
        }
        if (finalOk && operation === "merge" && !fs.existsSync(baselinePath)) {
          finalOk = false;
          finalReason = "EQUIPMENT_PPI_RESULT_MISSING";
        }
        if (finalOk && operation === "preview" && (!previewOutputPath || !fs.existsSync(previewOutputPath))) {
          finalOk = false;
          finalReason = "EQUIPMENT_PPI_RESULT_MISSING";
        }
        if (finalOk && operation === "fetch_recent") {
          try {
            const fetched = JSON.parse(fs.readFileSync(path.join(workspace, "_out", "nbs_ppi.json"), "utf8"));
            const hasValues = Object.values(fetched?.series || {}).some((series) => (
              series && typeof series === "object" && Object.keys(series).length > 0
            ));
            if (!hasValues) {
              finalOk = false;
              finalReason = "EQUIPMENT_PPI_RESULT_MISSING";
            }
          } catch {
            finalOk = false;
            finalReason = "EQUIPMENT_PPI_RESULT_MISSING";
          }
        }
        if (!finalOk && fetchFallbacks.length) {
          const failedStamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
          for (const item of fetchFallbacks) {
            try {
              if (fs.existsSync(item.current)) {
                const failedPath = path.join(item.historyDirectory, `failed_${path.basename(item.current, path.extname(item.current))}_${failedStamp}_${randomUUID().slice(0, 6)}${path.extname(item.current)}`);
                fs.copyFileSync(item.current, failedPath);
              }
              fs.copyFileSync(item.backup, item.current);
            } catch { /* Keep the timestamped history copy for manual recovery. */ }
          }
        }
        const stderrTail = stderrLines.join("\n").slice(-6000);
        resolve(completePpi(emit, {
          ok: finalOk,
          event: "complete",
          action: "run_equipment_ppi",
          operation,
          phase: finalOk ? "completed" : "failed",
          exitCode,
          ...(finalReason ? { reason: finalReason } : {}),
          ...(stderrTail ? { diagnostics: buildRunnerDiagnostics(exitCode, stderrTail) } : {}),
          output: stdoutLines.join("\n").slice(-18000),
        }));
      };
      try {
        const launch = processLauncher.commandLaunchSpec(pythonBin, ["-X", "utf8", "-u", scriptFor, ...args]);
        child = spawn(launch.command, launch.args, {
          cwd: path.dirname(scriptFor),
          env: {
            ...process.env,
            ...launch.env,
            FA_WORKSPACE: workspace,
            FA_BASELINE: baselinePath,
            ...(workbook ? { FA_DRAFT: workbook } : {}),
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        finish(false, null, error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : "EQUIPMENT_PPI_START_FAILED");
        return;
      }
      const consume = (line, stream) => {
        const text = String(line || "").trim();
        if (!text) return;
        if (stream === "stderr") appendStderrTail(stderrLines, text);
        else {
          stdoutLines.push(text);
          while (stdoutLines.length > 180) stdoutLines.shift();
        }
        try {
          emit({ ok: true, event: "progress", action: "run_equipment_ppi", operation, phase: "running", message: text.slice(0, 800), security: SECURITY });
        } catch { /* Keep processing if the UI disconnects. */ }
      };
      readline.createInterface({ input: child.stdout }).on("line", (line) => consume(line, "stdout"));
      readline.createInterface({ input: child.stderr }).on("line", (line) => consume(line, "stderr"));
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch { /* The process may already have ended. */ }
      }, 20 * 60 * 1000);
      child.once("error", (error) => finish(false, null, error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : "EQUIPMENT_PPI_START_FAILED"));
      child.once("close", (code) => {
        if (timedOut) finish(false, code, "EQUIPMENT_PPI_TIMEOUT");
        else {
          const outputText = stdoutLines.join("\n");
          const missingEditor = code === 5 && /缺少 Windows WPS\/Excel 原生编辑组件/i.test(outputText);
          finish(code === 0 || operation === "status", code, code === 0 || operation === "status" ? ""
            : missingEditor ? "EQUIPMENT_PPI_NATIVE_EDITOR_MISSING" : "EQUIPMENT_PPI_OPERATION_FAILED");
        }
      });
      try { emit({ ok: true, event: "progress", action: "run_equipment_ppi", operation, phase: "starting", message: "正在启动设备价格指数技能…", security: SECURITY }); } catch { /* Continue if the UI disconnected. */ }
    });
  }

  async function runClassLife(message) {
    const operation = String(message?.operation || "").trim();
    if (!CLASS_LIFE_OPERATIONS.has(operation)) {
      return { ok: false, reason: "CLASS_LIFE_OPERATION_INVALID", message: "设备分类模块操作类型无效。", security: SECURITY };
    }
    if (!fs.existsSync(classLifeRunner)) {
      return { ok: false, reason: "CLASS_LIFE_SKILL_MISSING", message: "设备分类技能文件不完整，请重新安装包含新模块的版本。", security: SECURITY };
    }
    const request = {
      operation,
      ...(message?.workbookPath ? { workbookPath: String(message.workbookPath) } : {}),
      ...(message?.sheetName ? { sheetName: String(message.sheetName) } : {}),
      ...(Number.isFinite(Number(message?.offset)) ? { offset: Number(message.offset) } : {}),
      ...(Number.isFinite(Number(message?.limit)) ? { limit: Number(message.limit) } : {}),
      ...(message?.sessionId ? { sessionId: String(message.sessionId) } : {}),
      ...(message?.outputDirectory ? { outputDirectory: String(message.outputDirectory) } : {}),
      ...(message?.query ? { query: String(message.query).slice(0, 100) } : {}),
      ...(Array.isArray(message?.rows) ? { rows: message.rows.slice(0, 100) } : {}),
    };
    const requestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atb-class-life-"));
    const requestPath = path.join(requestDirectory, "request.json");
    const parseResult = (stdout) => {
      const line = String(stdout || "").split(/\r?\n/).reverse().find((item) => item.startsWith("ATB_CLASS_LIFE_JSON:"));
      if (!line) return null;
      try { return JSON.parse(line.slice("ATB_CLASS_LIFE_JSON:".length)); } catch { return null; }
    };
    try {
      fs.writeFileSync(requestPath, JSON.stringify(request), { encoding: "utf8", mode: 0o600, flag: "wx" });
      const result = await execFilePromise(pythonBin, ["-X", "utf8", "-u", classLifeRunner, "--request-file", requestPath], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      });
      return { ...(parseResult(result.stdout) || { ok: false, reason: "CLASS_LIFE_RESULT_MISSING", message: "设备分类技能没有返回结果。" }), security: SECURITY };
    } catch (error) {
      const parsed = parseResult(error?.stdout);
      if (parsed) return { ...parsed, security: SECURITY };
      const raw = String(error?.stderr || error?.message || "");
      const code = /CLASS_LIFE_[A-Z0-9_]+/.exec(raw)?.[0]
        || (error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : "CLASS_LIFE_OPERATION_FAILED");
      return {
        ok: false,
        reason: code,
        message: code === "PYTHON_NOT_FOUND" ? "本机 Python 运行组件不可用。"
          : code === "CLASS_LIFE_NATIVE_EDITOR_REQUIRED" ? "此工作簿需要 WPS/Excel 原生编辑组件；未写入任何文件。"
            : code === "CLASS_LIFE_DEPENDENCY_MISSING" ? "本机缺少设备分类模块所需的 Python 组件。"
              : "设备分类操作失败，请检查工作簿、参考文件和输出目录后重试。",
        diagnostics: buildRunnerDiagnostics(Number.isInteger(error?.code) ? error.code : null, raw),
        security: SECURITY,
      };
    } finally {
      fs.rmSync(requestDirectory, { recursive: true, force: true });
    }
  }

  return {
    ppiScripts,
    classLifeRunner,
    classLifeValidator,
    runPpi,
    runClassLife,
  };
}

module.exports = { createEquipmentSkillHandlers };
