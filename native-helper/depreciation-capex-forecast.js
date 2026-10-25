"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { redactDiagnosticText, buildRunnerDiagnostics } = require("./diagnostics.js");
const { ensureManagedOutputDirectory } = require("./managed-output-directory.js");
const { resolvePythonBin } = require("./runtime_config.js");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");

const SKILL_NAME = "depreciation-capex-forecast";
const WORKBOOK_NAME = "折旧摊销预测输入模板.xlsx";
const NAMESPACE = "depreciation-capex-forecast";
const ACTION_NAMESPACE = "depreciation_capex_forecast";
const SHEETS = Object.freeze({
  summary: "预测汇总",
  annual: "资产结果明细（年度）",
  monthly: "资产结果明细（月度）",
  detailProcess: "详细过程",
});
const REQUIRED_FILES = Object.freeze([
  "SKILL.md",
  "agents/openai.yaml",
  "tests/test_workbook.py",
  "references/workflow.md",
  "assets/折旧摊销预测输入模板.xlsx",
  "scripts/workflow.py",
  "scripts/depreciation_forecast/__init__.py",
  "scripts/depreciation_forecast/__main__.py",
  "scripts/depreciation_forecast/cli.py",
  "scripts/depreciation_forecast/model.py",
  "scripts/depreciation_forecast/workbook.py",
]);

function security(extra = {}) {
  return {
    credentialsReturned: false,
    credentialsRead: false,
    credentialsWritten: false,
    ...extra,
  };
}

function safeReason(error) {
  return redactDiagnosticText(error?.message || error || "DEPRECIATION_CAPEX_FORECAST_FAILED").slice(0, 700);
}

function ensureAbsolutePath(value, reason = "WORKBOOK_PATH_INVALID") {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error(reason);
  return path.resolve(raw);
}

function isXlsxPath(value) {
  return path.extname(String(value || "")).toLowerCase() === ".xlsx";
}

function selectedPath(result) {
  return String(result?.paths?.[0] || result?.path || "").trim();
}

function managedOutputDirectory(value) {
  return ensureManagedOutputDirectory(value, "折旧摊销预测");
}

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(5).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function readJson(filePath, fallback = {}) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return payload && typeof payload === "object" ? payload : fallback;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function replaceAtomicFile(temporary, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) {
    fs.renameSync(temporary, target);
    return;
  }
  const backup = `${target}.backup-${process.pid}-${randomBytes(5).toString("hex")}`;
  fs.renameSync(target, backup);
  try {
    fs.renameSync(temporary, target);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(target, { force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

function parseJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("DEPRECIATION_WORKFLOW_EMPTY_OUTPUT");
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      try {
        return JSON.parse(line);
      } catch {
        // Keep scanning for the final JSON object.
      }
    }
    throw new Error("DEPRECIATION_WORKFLOW_INVALID_JSON");
  }
}

function resolveSkillRoot({ skillRoot, runtimeDirectory }) {
  const dataDirectory = nativeHelperDataDirectory(__dirname);
  const candidates = [
    skillRoot,
    process.env.TIANYUAN_DEPRECIATION_SKILL_DIR,
    path.join(dataDirectory, "..", "skills", SKILL_NAME),
    path.join(runtimeDirectory, "..", "skills", SKILL_NAME),
    path.join(process.cwd(), "skills", SKILL_NAME),
  ].filter(Boolean).map((item) => path.resolve(String(item)));
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "scripts", "workflow.py"))) || candidates[0];
}

function createDepreciationCapexForecastService(options = {}) {
  const platformAdapter = options.platformAdapter;
  const runtimeDirectory = path.resolve(options.runtimeDirectory || platformAdapter?.runtimeRoot || os.tmpdir());
  const skillRoot = resolveSkillRoot({ skillRoot: options.skillRoot, runtimeDirectory });
  const workflowScript = path.join(skillRoot, "scripts", "workflow.py");
  const pythonBin = String(options.pythonBin || resolvePythonBin({ platform: platformAdapter }));
  const statePath = path.join(runtimeDirectory, "depreciation-capex-forecast-state.json");
  const workbookDirectory = path.resolve(
    options.workbookDirectory
      || path.join(runtimeDirectory, "..", "projects", "评估工具箱", "workbooks"),
  );
  const legacyProjectSegment = "天源评估系统";

  function isLegacyProjectPath(value) {
    return String(value || "").split(/[\\/]+/).includes(legacyProjectSegment);
  }

  function defaultWorkingPath() {
    const configured = process.env.TIANYUAN_DEPRECIATION_WORKBOOK_PATH;
    const candidate = configured && !isLegacyProjectPath(configured)
      ? configured
      : path.join(workbookDirectory, WORKBOOK_NAME);
    return ensureAbsolutePath(candidate);
  }

  function state() {
    return readJson(statePath, { version: 1, namespace: NAMESPACE });
  }

  function remember(workbookPath, extra = {}) {
    const previous = state();
    const payload = {
      ...previous,
      version: 1,
      namespace: NAMESPACE,
      workbookPath,
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    atomicWriteJson(statePath, payload);
    return payload;
  }

  function workingPath(input = {}) {
    const explicitPath = String(input.workbookPath || "").trim();
    if (explicitPath && isLegacyProjectPath(explicitPath)) {
      throw new Error("DEPRECIATION_LEGACY_PATH_REQUIRES_IMPORT");
    }
    const savedPath = state().workbookPath;
    const compatibleSavedPath = savedPath && !isLegacyProjectPath(savedPath) ? savedPath : "";
    const target = ensureAbsolutePath(explicitPath || compatibleSavedPath || defaultWorkingPath());
    if (!isXlsxPath(target)) throw new Error("WORKBOOK_PATH_MUST_BE_XLSX");
    return target;
  }

  async function invoke(command, args = [], { timeout = 180000 } = {}) {
    if (!fs.existsSync(workflowScript)) {
      return { ok: false, reason: "DEPRECIATION_SKILL_NOT_INSTALLED", security: security() };
    }
    const result = await new Promise((resolve) => {
      execFile(pythonBin, ["-X", "utf8", "-u", workflowScript, command, ...args], {
        timeout,
        encoding: "utf8",
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        maxBuffer: 20 * 1024 * 1024,
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    let payload;
    try {
      payload = parseJsonOutput(result.stdout || result.stderr);
    } catch (error) {
      return {
        ok: false,
        reason: result.error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : safeReason(error),
        diagnostics: buildRunnerDiagnostics(
          Number.isInteger(result.error?.code) ? result.error.code : null,
          result.stderr || result.error?.message || error?.message,
        ),
        security: security(),
      };
    }
    if (result.error) {
      return {
        ...payload,
        ok: false,
        reason: payload?.reason || safeReason(result.error),
        diagnostics: buildRunnerDiagnostics(
          Number.isInteger(result.error.code) ? result.error.code : null,
          [payload?.stderr, result.stderr || result.error.message].filter(Boolean).join("\n"),
        ),
        security: security(),
      };
    }
    if (payload?.status === "error") {
      return {
        ...payload,
        ok: false,
        reason: payload.reason || payload.message || "DEPRECIATION_WORKFLOW_FAILED",
        diagnostics: buildRunnerDiagnostics(
          Number.isInteger(result.error?.code) ? result.error.code : null,
          [payload?.stderr, result.stderr].filter(Boolean).join("\n"),
        ),
        security: security(),
      };
    }
    return { ok: true, ...payload, security: security() };
  }

  async function prepare(input = {}) {
    const target = workingPath(input);
    const args = ["--output", target];
    if (input.reset === true) args.push("--reset");
    const result = await invoke("prepare", args);
    if (!result.ok) return result;
    remember(target, { source: result.source || "skill-asset" });
    return {
      ...result,
      action: "depreciation_capex_forecast_prepared",
      namespace: NAMESPACE,
      workbookPath: target,
      security: security(),
    };
  }

  async function currentStatus(input = {}) {
    const target = workingPath(input);
    const result = await invoke("status", ["--input", target]);
    if (!result.ok) return result;
    const previous = state();
    const ignoredLegacyPath = isLegacyProjectPath(previous.workbookPath);
    return {
      ...result,
      action: "depreciation_capex_forecast_status",
      namespace: NAMESPACE,
      workbookPath: target,
      state: ignoredLegacyPath ? { ...previous, workbookPath: undefined } : previous,
      legacyWorkbookPathIgnored: ignoredLegacyPath,
      ...(ignoredLegacyPath ? { compatibilityNotice: "检测到旧项目路径记录；原工作簿保持原位。请通过“导入工作簿”将副本导入评估工具箱工作区。" } : {}),
      lastRun: previous.lastRun || null,
      lastRunAt: previous.lastRunAt || null,
      security: security(),
    };
  }

  async function selectXlsx() {
    if (!platformAdapter?.chooseXlsxFile) {
      return { ok: false, cancelled: false, reason: "PLATFORM_FILE_PICKER_UNSUPPORTED", action: "depreciation_capex_forecast_xlsx_selection_failed", namespace: NAMESPACE, security: security() };
    }
    const result = await platformAdapter.chooseXlsxFile();
    const selected = result?.paths?.[0] || "";
    if (!result?.ok) {
      const cancelled = result?.cancelled === true || result?.canceled === true;
      return {
        ...result,
        cancelled,
        action: cancelled
          ? "depreciation_capex_forecast_xlsx_selection_cancelled"
          : "depreciation_capex_forecast_xlsx_selection_failed",
        namespace: NAMESPACE,
        security: security(),
      };
    }
    if (!selected) {
      return {
        ...result,
        ok: false,
        cancelled: false,
        reason: "FILE_PICKER_EMPTY_RESULT",
        action: "depreciation_capex_forecast_xlsx_selection_failed",
        namespace: NAMESPACE,
        diagnostics: result?.diagnostics || {
          exitCode: null,
          stderrTail: ["阶段: response_validation", "错误码: FILE_PICKER_EMPTY_RESULT"],
        },
        security: security(),
      };
    }
    if (!isXlsxPath(selected)) {
      return { ok: false, cancelled: false, reason: "IMPORT_SOURCE_MUST_BE_XLSX", action: "depreciation_capex_forecast_xlsx_selection_failed", namespace: NAMESPACE, security: security() };
    }
    return {
      ok: true,
      action: "depreciation_capex_forecast_xlsx_selected",
      namespace: NAMESPACE,
      sourcePath: path.resolve(selected),
      security: security({ fileContentsReturned: false }),
    };
  }

  async function importWorkbook(input = {}) {
    let source = String(input.sourcePath || input.filePath || "").trim();
    if (!source) {
      const selected = await selectXlsx();
      if (!selected.ok) return selected;
      source = selected.sourcePath;
    }
    source = fs.realpathSync(ensureAbsolutePath(source, "IMPORT_SOURCE_PATH_INVALID"));
    if (!isXlsxPath(source)) throw new Error("IMPORT_SOURCE_MUST_BE_XLSX");
    const target = workingPath(input);
    if (source === target) throw new Error("IMPORT_SOURCE_EQUALS_WORKING_COPY");
    const temporary = `${target}.import-${process.pid}-${randomBytes(5).toString("hex")}.xlsx`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, temporary);
      const preflight = await invoke("preflight", ["--input", temporary]);
      if (!preflight.ok || preflight.compatible !== true) {
        throw new Error(preflight.reason || "TEMPLATE_INCOMPATIBLE");
      }
      replaceAtomicFile(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    remember(target, { importedFrom: path.basename(source), sourceSize: fs.statSync(source).size });
    return {
      ok: true,
      action: "depreciation_capex_forecast_imported",
      namespace: NAMESPACE,
      sourcePath: source,
      workbookPath: target,
      sourceOverwritten: false,
      security: security({ fileContentsReturned: false }),
    };
  }

  async function selectOutputDirectory() {
    if (!platformAdapter?.chooseDirectory) {
      return { ok: false, cancelled: false, reason: "PLATFORM_FILE_PICKER_UNSUPPORTED", action: "depreciation_capex_forecast_output_directory_selection_failed", namespace: NAMESPACE, security: security() };
    }
    const result = await platformAdapter.chooseDirectory("选择折旧摊销预测底稿导出目录");
    const selected = selectedPath(result);
    if (!result?.ok) {
      const cancelled = result?.cancelled === true || result?.canceled === true;
      return {
        ...result,
        cancelled,
        action: cancelled
          ? "depreciation_capex_forecast_output_directory_selection_cancelled"
          : "depreciation_capex_forecast_output_directory_selection_failed",
        namespace: NAMESPACE,
        security: security(),
      };
    }
    if (!selected) {
      return {
        ...result,
        ok: false,
        cancelled: false,
        reason: "FILE_PICKER_EMPTY_RESULT",
        action: "depreciation_capex_forecast_output_directory_selection_failed",
        namespace: NAMESPACE,
        diagnostics: result?.diagnostics || {
          exitCode: null,
          stderrTail: ["阶段: response_validation", "错误码: FILE_PICKER_EMPTY_RESULT"],
        },
        security: security(),
      };
    }
    const managed = managedOutputDirectory(selected);
    return {
      ok: true,
      action: "depreciation_capex_forecast_output_directory_selected",
      namespace: NAMESPACE,
      ...managed,
      security: security({ fileContentsReturned: false }),
    };
  }

  async function writeInput(input = {}) {
    const target = workingPath(input);
    const section = String(input.section || input.kind || "").trim();
    const values = input.values !== undefined ? input.values : input.rows;
    if (values === undefined) throw new Error("INPUT_VALUES_REQUIRED");
    const args = [
      "--input", target,
      "--section", section,
      "--values", JSON.stringify(values),
    ];
    if (Number.isInteger(input.rowIndex)) args.push("--row-index", String(input.rowIndex));
    const result = await invoke("write", args);
    if (!result.ok) return result;
    remember(target, { lastWriteSection: section });
    return {
      ...result,
      action: "depreciation_capex_forecast_input_written",
      namespace: NAMESPACE,
      workbookPath: target,
      security: security({ fileContentsReturned: false }),
    };
  }

  async function readExistingInput(input = {}) {
    const target = workingPath(input);
    const section = String(input.section || input.kind || "").trim().toLowerCase();
    const args = ["--input", target];
    if (section) args.push("--section", section);
    const result = await invoke("read-input", args);
    if (!result.ok) return result;
    return {
      ...result,
      action: "depreciation_capex_forecast_input_read",
      namespace: NAMESPACE,
      workbookPath: target,
      security: security({ fileContentsReturned: true }),
    };
  }

  async function preflight(input = {}) {
    const target = workingPath(input);
    const result = await invoke("preflight", ["--input", target]);
    const checkedAt = new Date().toISOString();
    remember(target, {
      lastPreflightAt: checkedAt,
      lastPreflightOk: result.ok === true && result.compatible !== false && result.status !== "error",
    });
    return {
      ...result,
      action: "depreciation_capex_forecast_preflight",
      namespace: NAMESPACE,
      security: security(),
    };
  }

  async function run(input = {}) {
    const target = workingPath(input);
    const args = ["--input", target];
    if (input.withDetails === true || input.includeDetails === true) args.push("--with-details");
    if (input.detailAssetId !== undefined && input.detailAssetId !== null) {
      args.push("--detail-asset-id", String(input.detailAssetId));
    }
    if (input.detailAssetKind) args.push("--detail-asset-kind", String(input.detailAssetKind));
    const result = await invoke("run", args, { timeout: 600000 });
    if (!result.ok) {
      const finishedAt = new Date().toISOString();
      remember(target, {
        lastRunAt: finishedAt,
        lastRun: { ok: false, finishedAt, reason: result.reason },
        lastRunOk: false,
      });
      return result;
    }
    const finishedAt = new Date().toISOString();
    remember(target, {
      lastRunAt: finishedAt,
      lastRun: { ok: true, finishedAt, includeDetails: Boolean(input.withDetails || input.includeDetails) },
      lastRunOk: true,
      includeDetails: Boolean(input.withDetails || input.includeDetails),
    });
    return {
      ...result,
      action: "depreciation_capex_forecast_run",
      namespace: NAMESPACE,
      workbookPath: target,
      security: security({ fileContentsReturned: false }),
    };
  }

  async function readResult(input = {}) {
    const target = workingPath(input);
    const result = await invoke("read", ["--input", target, "--sheet", "summary"]);
    const summary = result.summary || {};
    return {
      ...result,
      tables: summary.tables || result.tables || {},
      inputValid: summary.input_validation?.状态 === "OK"
        || summary.input_validation?.status === "OK"
        || result.inputValid,
      action: "depreciation_capex_forecast_result",
      namespace: NAMESPACE,
      security: security({ fileContentsReturned: true }),
    };
  }

  async function readTable(input = {}, tableKind) {
    const target = workingPath(input);
    const args = [
      "--input", target,
      "--sheet", tableKind,
      "--page", String(input.page || 1),
      "--page-size", String(input.pageSize || 50),
      "--column-page", String(input.columnPage || 1),
      "--column-page-size", String(input.columnPageSize || 40),
    ];
    const directColumnStart = Number.isInteger(input.columnStart)
      ? input.columnStart
      : Number.isInteger(input.columnStartIndex) ? input.columnStartIndex + 1 : null;
    const directColumnCount = Number.isInteger(input.columnCount) ? input.columnCount : null;
    if (directColumnStart !== null) args.push("--column-start", String(Math.max(1, directColumnStart)));
    if (directColumnCount !== null) args.push("--column-count", String(Math.max(1, directColumnCount)));
    if (input.formulas === true) args.push("--formulas");
    const result = await invoke("read", args);
    return {
      ...result,
      action: `depreciation_capex_forecast_${tableKind.replace("-", "_")}_page`,
      namespace: NAMESPACE,
      security: security({ fileContentsReturned: true }),
    };
  }

  async function readDetailProcess(input = {}) {
    if (input.assetId !== undefined && input.assetId !== null && String(input.assetId).trim()) {
      const generated = await run({
        ...input,
        withDetails: true,
        detailAssetId: String(input.assetId).trim(),
        detailAssetKind: input.detailAssetKind || input.assetKind,
      });
      if (!generated.ok) return generated;
    }
    return await readTable(input, "detail-process");
  }

  async function exportReadback(input = {}) {
    const source = workingPath(input);
    let target = String(input.outputPath || "").trim();
    if (!target && input.outputDirectory) {
      target = path.join(
        ensureAbsolutePath(input.outputDirectory, "EXPORT_DIRECTORY_INVALID"),
        `${path.basename(source, path.extname(source))}-预测底稿.xlsx`,
      );
    }
    if (!target) throw new Error("EXPORT_OUTPUT_PATH_REQUIRED");
    target = ensureAbsolutePath(target, "EXPORT_OUTPUT_PATH_INVALID");
    if (!isXlsxPath(target)) throw new Error("EXPORT_OUTPUT_MUST_BE_XLSX");
    const args = ["--input", source, "--output", target];
    if (input.overwrite === true) args.push("--overwrite");
    const result = await invoke("export", args, { timeout: 180000 });
    if (result.ok) {
      const outputExists = fs.existsSync(target);
      const outputSize = outputExists ? fs.statSync(target).size : 0;
      return {
        ...result,
        outputExists,
        outputSize,
        readbackOk: outputExists && outputSize > 0 && result.readback?.preflight?.compatible !== false,
        action: "depreciation_capex_forecast_export_readback",
        namespace: NAMESPACE,
        sourceOverwritten: false,
        security: security({ fileContentsReturned: false }),
      };
    }
    return {
      ...result,
      action: "depreciation_capex_forecast_export_readback",
      namespace: NAMESPACE,
      sourceOverwritten: false,
      security: security({ fileContentsReturned: false }),
    };
  }

  function selfTest() {
    const missing = REQUIRED_FILES.filter((relativePath) => !fs.existsSync(path.join(skillRoot, relativePath)));
    return {
      ok: missing.length === 0,
      namespace: NAMESPACE,
      skillRoot,
      workflowScript,
      requiredFiles: REQUIRED_FILES,
      missingFiles: missing,
      sourceDigest: missing.length ? null : sourceDigest(),
      security: security(),
    };
  }

  function sourceDigest() {
    const hash = createHash("sha256");
    for (const relativePath of REQUIRED_FILES) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(skillRoot, relativePath)));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  async function handle(input = {}) {
    const operation = String(input.operation || input.command || "").trim().toLowerCase();
    const aliases = {
      prepare: prepare,
      reset: (value) => prepare({ ...value, reset: true }),
      status: currentStatus,
      current_status: currentStatus,
      "current-status": currentStatus,
      select: selectXlsx,
      select_xlsx: selectXlsx,
      "select-xlsx": selectXlsx,
      import: importWorkbook,
      import_xlsx: importWorkbook,
      "import-xlsx": importWorkbook,
      write: writeInput,
      write_params: (value) => writeInput({ ...value, section: "params" }),
      write_parameters: (value) => writeInput({ ...value, section: "params" }),
      write_stock: (value) => writeInput({ ...value, section: "stock" }),
      write_added: (value) => writeInput({ ...value, section: "added" }),
      write_new: (value) => writeInput({ ...value, section: "added" }),
      read_input: readExistingInput,
      "read-input": readExistingInput,
      read_existing_input: readExistingInput,
      "read-existing-input": readExistingInput,
      preflight: preflight,
      run: run,
      run_default: (value) => run({ ...value, withDetails: false }),
      run_with_details: (value) => run({ ...value, withDetails: true }),
      read: readResult,
      result: readResult,
      read_result: readResult,
      read_annual: (value) => readTable(value, "annual"),
      read_monthly: (value) => readTable(value, "monthly"),
      read_detail: readDetailProcess,
      read_detail_process: readDetailProcess,
      select_output_directory: selectOutputDirectory,
      select_directory: selectOutputDirectory,
      export: exportReadback,
      export_readback: exportReadback,
      export_bottom_draft: exportReadback,
    };
    const handler = aliases[operation];
    if (!handler) return { ok: false, reason: "DEPRECIATION_OPERATION_NOT_ALLOWED", namespace: NAMESPACE, security: security() };
    try {
      return await handler(input);
    } catch (error) {
      return {
        ok: false,
        reason: error?.reason || safeReason(error),
        errorCode: error?.code || undefined,
        diagnostics: error?.diagnostics,
        namespace: NAMESPACE,
        security: security(),
      };
    }
  }

  return {
    handle,
    selfTest,
    sourceDigest,
    skillRoot,
    workbookDirectory,
    requiredFiles: REQUIRED_FILES,
  };
}

module.exports = {
  ACTION_NAMESPACE,
  NAMESPACE,
  REQUIRED_FILES,
  SKILL_NAME,
  createDepreciationCapexForecastService,
};
