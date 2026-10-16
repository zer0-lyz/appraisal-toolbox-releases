#!/usr/bin/env node

const { execFile, spawn } = require("node:child_process");
const { buildRunnerDiagnostics, redactDiagnosticText, appendStderrTail } = require("./diagnostics.js");
const landPublicityHttp = require("./land-publicity-http.js");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const processLauncher = (() => {
  try {
    return require("./process_launcher.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./process_launcher.js");
    } catch {
      throw cause;
    }
  }
})();
const disabledFeature = async () => ({
  ok: false,
  reason: "APPRAISAL_TOOLBOX_FEATURE_NOT_INCLUDED",
  security: { credentialsReturned: false },
});
const connectorBridge = { start: disabledFeature, health: disabledFeature };
const updateChecker = (() => {
  try {
    return require("./update_checker.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./update_checker.js");
    } catch {
      throw cause;
    }
  }
})();
const updateInstallerFactory = {
  createWorkbenchUpdater: () => ({
    install: disabledFeature,
    test: disabledFeature,
    getStatus: () => ({
      ok: false,
      reason: "APPRAISAL_TOOLBOX_MANUAL_UPDATE_ONLY",
      security: { credentialsReturned: false },
    }),
  }),
};
const fileArchiveFactory = {
  createFileArchiveService: () => ({
    detect: disabledFeature,
    listConversations: disabledFeature,
    getConversationBindings: disabledFeature,
    inspectActiveConversation: disabledFeature,
    selectOutputDirectory: disabledFeature,
    saveConversationBindings: disabledFeature,
    start: disabledFeature,
    stop: disabledFeature,
    pause: disabledFeature,
    scan: disabledFeature,
    status: disabledFeature,
    runDaemon: disabledFeature,
  }),
};
const depreciationCapexForecastFactory = (() => {
  try {
    return require("./depreciation-capex-forecast.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./depreciation-capex-forecast.js");
    } catch {
      throw cause;
    }
  }
})();
const alibabaAuction = (() => {
  try {
    return require("./alibaba-auction.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./alibaba-auction.js");
    } catch {
      throw cause;
    }
  }
})();
const anjukeProperty = (() => {
  try {
    return require("./anjuke-property.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./anjuke-property.js");
    } catch {
      throw cause;
    }
  }
})();
const alibabaLease = (() => {
  try {
    return require("./alibaba-lease.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./alibaba-lease.js");
    } catch {
      throw cause;
    }
  }
})();
const platformAdapter = (() => {
  try {
    return require("./platform/index.js");
  } catch (cause) {
    try {
      return createRequire(path.join(path.dirname(process.execPath), "native_host.js"))("./platform/index.js");
    } catch {
      throw cause;
    }
  }
})().createPlatformAdapter();

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") {
    process.exit(0);
  }
});

const DEFAULT_MCP_URL = "https://mcp.zhrdc.net/valuation-mcp";
const DEFAULT_CONNECTOR_PORT = 40415;
const CONNECTOR_PROTOCOL_VERSION = "connector-agent-binding-v3";
const CONNECTOR_PLATFORM_URL = process.env.TIANYUAN_CONNECTOR_PLATFORM_URL || "http://127.0.0.1:40315";
const CODEX_GLOBAL_STATE_PATH = process.env.TIANYUAN_CODEX_GLOBAL_STATE_PATH
  || path.join(os.homedir(), ".codex", ".codex-global-state.json");
const CONNECTOR_BINDINGS_PATH = process.env.TIANYUAN_CONNECTOR_BINDINGS_PATH
  || path.join(os.homedir(), ".tianyuan-workbench", "native-helper", "connector-bindings.json");
const CONNECTOR_ACTION_TTL_MS = 5 * 60 * 1000;
const CONNECTOR_ACTION_RESULT_TTL_MS = 15 * 60 * 1000;
const CONNECTOR_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const CONNECTOR_ATTACHMENT_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm",
  ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".zip", ".rar",
]);
const CONNECTOR_ALLOWED_EXTENSION_ORIGINS = new Set([
  "chrome-extension://lkflndcnklpeaejohaacoaolnmhgigoc",
  "chrome-extension://fdbllnmaaklkcmoacoapbibiggnndkfpa",
]);
const IS_WINDOWS = platformAdapter.isWindows;
const RUNTIME_CONFIG_PATH = process.env.TIANYUAN_RUNTIME_CONFIG_PATH
  || path.join(processLauncher.runtimeDirectory(), "runtime-config.json");
const CLI_LOGIN_STATUS_PATH = path.join(processLauncher.runtimeDirectory(), "cli-login-status.json");
const CLI_LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;
const CLI_LOGIN_URL_WAIT_MS = 20 * 1000;
const CLI_AUTH_HOST = "mcp.zhrdc.net";

const { loadRuntimeConfig, resolvePythonBin } = require("./runtime_config.js");

const runtimeConfig = loadRuntimeConfig();
const MAP_CONFIG_PATH = process.env.TIANYUAN_MAP_CONFIG_PATH
  || path.join(path.dirname(processLauncher.runtimeDirectory()), "map-config.json");
// Use the installed product settings for every map renderer and Python skill.
process.env.TIANYUAN_MAP_CONFIG_PATH = MAP_CONFIG_PATH;

function readMapConfig() {
  try {
    const payload = JSON.parse(fs.readFileSync(MAP_CONFIG_PATH, "utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function mapSecretMask(value) {
  const secret = String(value || "");
  return secret ? `${"•".repeat(Math.max(4, secret.length - 4))}${secret.slice(-4)}` : "";
}

function mapConfigSummary() {
  const stored = readMapConfig();
  const amap = stored.amap && typeof stored.amap === "object"
    ? stored.amap
    : {};
  return {
    ok: true,
    action: "get_map_config",
    configured: Boolean(amap.enabled && amap.webKey),
    webKeyConfigured: Boolean(amap.webKey),
    enabled: amap.enabled === true,
    webKeyMasked: mapSecretMask(amap.webKey),
    path: MAP_CONFIG_PATH,
    security: { credentialsReturned: false },
  };
}

function saveMapConfig(message = {}) {
  const input = message.config?.amap && typeof message.config.amap === "object"
    ? message.config.amap
    : {};
  const enabled = input.enabled === true;
  const storedPayload = readMapConfig();
  const stored = storedPayload.amap && typeof storedPayload.amap === "object" ? storedPayload.amap : {};
  const preserveExisting = input.preserveExisting === true;
  const webKey = String(input.webKey || (preserveExisting ? stored.webKey : "")).trim().slice(0, 256);
  if (enabled && !webKey) throw new Error("MAP_CONFIG_AMAP_KEY_REQUIRED");
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    amap: { enabled, webKey },
  };
  fs.mkdirSync(path.dirname(MAP_CONFIG_PATH), { recursive: true, mode: 0o700 });
  const temporaryPath = `${MAP_CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, MAP_CONFIG_PATH);
  return { ...mapConfigSummary(), action: "save_map_config" };
}

function clearMapConfig() {
  try { fs.rmSync(MAP_CONFIG_PATH, { force: true }); } catch {}
  return { ...mapConfigSummary(), action: "clear_map_config", configured: false, enabled: false };
}

const workbenchUpdater = updateInstallerFactory.createWorkbenchUpdater({
  updateChecker,
  platformAdapter,
  runtimeDirectory: processLauncher.runtimeDirectory(),
});
const fileArchive = fileArchiveFactory.createFileArchiveService({
  runtimeDirectory: process.env.TIANYUAN_FILE_ARCHIVE_RUNTIME_DIR || processLauncher.runtimeDirectory(),
  platformAdapter,
  selfLaunchSpec: (args) => processLauncher.selfLaunchSpec(args),
});

function firstExistingPath(values, fallback) {
  for (const value of values) {
    if (value && fs.existsSync(value)) return value;
  }
  return fallback;
}

const CLI_BIN = process.env.TYCPV_BIN
  || runtimeConfig.tycpvBin
  || firstExistingPath(platformAdapter.cliCandidates, platformAdapter.cliFallback);

function directCliExportEnginePaths() {
  const candidates = [
    process.env.TYCPV_APP_ROOT,
    runtimeConfig.tycpvAppRoot,
    process.platform === "darwin" ? "/Library/Application Support/tycpv/app" : "",
    CLI_BIN ? path.join(path.dirname(CLI_BIN), "app") : "",
    CLI_BIN ? path.join(path.dirname(CLI_BIN), "..", "app") : "",
  ].filter(Boolean);

  if (CLI_BIN && fs.existsSync(CLI_BIN)) {
    try {
      const launcher = fs.readFileSync(CLI_BIN, "utf8").slice(0, 16 * 1024);
      const installRoot = launcher.match(/INSTALL_ROOT\s*=\s*["']([^"']+)["']/i)?.[1];
      if (installRoot) candidates.unshift(path.join(installRoot, "app"));
    } catch {
      // The standalone executable may not be readable; use the known install paths.
    }
  }

  for (const root of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    const exporterPath = path.join(root, "src", "detail-table-export-engine", "detail-table-exporter.js");
    const detailTemplatePath = path.join(root, "assets", "templates", "detail.xlsx");
    const declareTemplatePath = path.join(root, "assets", "templates", "declare.xlsx");
    if (fs.existsSync(exporterPath) && fs.existsSync(detailTemplatePath) && fs.existsSync(declareTemplatePath)) {
      return { root, exporterPath, detailTemplatePath, declareTemplatePath };
    }
  }
  return null;
}

let directCliExportEnginePromise = null;

async function loadDirectCliExportEngine() {
  const paths = directCliExportEnginePaths();
  if (!paths) {
    const error = new Error("TYCPV_EXPORT_ENGINE_NOT_FOUND");
    error.code = "TYCPV_EXPORT_ENGINE_NOT_FOUND";
    throw error;
  }
  if (!directCliExportEnginePromise) {
    directCliExportEnginePromise = import(pathToFileURL(paths.exporterPath).href)
      .then((module) => ({ ...paths, Exporter: module.default }));
  }
  return await directCliExportEnginePromise;
}

const PYTHON_BIN = resolvePythonBin({ config: runtimeConfig, platform: platformAdapter });
const PRINT_SKILLS_DIR = process.env.TIANYUAN_PRINT_SKILLS_DIR || runtimeConfig.printSkillsDir
  || platformAdapter.defaultPrintSkillsDir;
const COMPANY_HIERARCHY_CODE_KEYS = [
  "displayCode",
  "display_code",
  "treeCode",
  "tree_code",
  "hierarchyCode",
  "hierarchy_code",
  "levelCode",
  "level_code",
  "nodeCode",
  "node_code",
  "relationCode",
  "relation_code",
  "sortCode",
  "sort_code",
  "sortNo",
  "sort_no",
  "serialNo",
  "serial_no",
  "serialNumber",
  "serial_number",
  "sequence",
  "seq",
  "seqNo",
  "seq_no",
  "orderNo",
  "order_no",
  "ordinal",
  "index",
  "idx",
  "rowNo",
  "row_no",
  "num",
  "number",
  "codeNo",
  "code_no",
  "编码",
  "公司编号",
  "层级编码",
  "序号",
];
const mcpUrl = process.env.VALUATION_MCP_URL || DEFAULT_MCP_URL;
const envToken = process.env.VALUATION_MCP_TOKEN || "";

let nextId = 1;
let sessionId = null;
let initialized = false;
let runtimeToken = "";
const connectorSessions = new Map();
const connectorBindings = new Map();
const connectorActions = new Map();
let connectorBindingsLoaded = false;

const CLI_EXPORT_COMMANDS = Object.freeze({
  asset_detail_table: {
    command: "export-asset-detail-table",
    label: "资产基础法明细表",
  },
  asset_declare_table: {
    command: "export-asset-declare-table",
    label: "资产基础法申报表",
  },
});
const PRINT_FORMAT_SCRIPTS = Object.freeze({
  detail: path.join(
    PRINT_SKILLS_DIR,
    "appraisal-detail-print-format",
    "scripts",
    "adjust_appraisal_detail_print.py",
  ),
  declaration: path.join(
    PRINT_SKILLS_DIR,
    "appraisal-declaration-print-format",
    "scripts",
    "adjust_appraisal_declaration_print.py",
  ),
});
const LINK_RESTORE_SCRIPT = path.join(
  PRINT_SKILLS_DIR,
  "asset-link-restore",
  "scripts",
  "restore_links.py",
);
const LAND_PUBLICITY_SCRIPT = path.join(
  PRINT_SKILLS_DIR,
  "zj-land-publicity",
  "land_publicity_runner.py",
);
const ANJUKE_PROPERTY_SCRIPT = path.join(
  PRINT_SKILLS_DIR,
  "anjuke-property-case-fetcher",
  "scripts",
  "fetch_anjuke_property_cases.py",
);
const PRINT_OUTPUT_MODES = new Set(["overwrite", "copy_in_source", "new_directory"]);
const TABLE_FORMAT_SCRIPT = path.join(
  PRINT_SKILLS_DIR,
  "table-format",
  "scripts",
  "format_word_tables.py",
);
const TABLE_FORMAT_OUTPUT_MODES = new Set(["overwrite", "copy_in_source", "new_directory"]);
const DEPRECIATION_CAPEX_ACTIONS = Object.freeze({
  depreciation_capex_forecast_prepare: "prepare",
  depreciation_capex_forecast_status: "status",
  depreciation_capex_forecast_select_xlsx: "select_xlsx",
  depreciation_capex_forecast_select_output_directory: "select_output_directory",
  depreciation_capex_forecast_import: "import",
  depreciation_capex_forecast_write_params: "write_params",
  depreciation_capex_forecast_write_stock: "write_stock",
  depreciation_capex_forecast_write_added: "write_added",
  depreciation_capex_forecast_read_input: "read_input",
  depreciation_capex_forecast_preflight: "preflight",
  depreciation_capex_forecast_run: "run",
  depreciation_capex_forecast_run_with_details: "run_with_details",
  depreciation_capex_forecast_result: "read_result",
  depreciation_capex_forecast_read_annual: "read_annual",
  depreciation_capex_forecast_read_monthly: "read_monthly",
  depreciation_capex_forecast_read_detail_process: "read_detail_process",
  depreciation_capex_forecast_export_readback: "export_readback",
});
const TOOLBOX_NATIVE_ACTIONS = new Set([
  "health",
  "download_and_install_update",
  "check_github_update",
  "get_map_config",
  "save_map_config",
  "clear_map_config",
  "select_table_format_word_files",
  "select_table_format_output_directory",
  "run_table_format",
  "select_print_workbook_files",
  "select_print_workbook_directory",
  "select_print_output_directory",
  "run_print_format",
  "run_link_restore",
  "open_print_workbook_path",
  "list_land_publicity_regions",
  "select_land_publicity_history_directory",
  "list_land_publicity_history",
  "load_land_publicity_history",
  "select_land_publicity_output_directory",
  "open_land_publicity_path",
  "run_land_publicity",
  "select_alibaba_auction_output_directory",
  "select_alibaba_auction_history_directory",
  "list_alibaba_auction_history",
  "load_alibaba_auction_history",
  "open_alibaba_auction",
  "enrich_alibaba_auction_detail",
  "write_alibaba_auction_result",
  "write_alibaba_auction_excel",
  "open_alibaba_auction_path",
  "run_alibaba_auction",
  "select_alibaba_lease_output_directory",
  "write_alibaba_lease_result",
  "write_alibaba_lease_excel",
  "open_alibaba_lease_path",
  "select_anjuke_property_output_directory",
  "open_anjuke_property_source",
  "open_anjuke_property_path",
  "run_anjuke_property",
]);
function toolboxActionAllowed(message = {}) {
  const action = String(message.action || "");
  if (TOOLBOX_NATIVE_ACTIONS.has(action)) return true;
  if (Object.hasOwn(DEPRECIATION_CAPEX_ACTIONS, action)) return true;
  return action === "depreciation_capex_forecast" || action === "depreciation-capex-forecast";
}
function toolboxActionRejected(message = {}) {
  return {
    ok: false,
    action: String(message.action || ""),
    reason: "APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED",
    security: { credentialsReturned: false },
  };
}
const depreciationCapexForecast = depreciationCapexForecastFactory.createDepreciationCapexForecastService({
  platformAdapter,
  pythonBin: PYTHON_BIN,
  runtimeDirectory: processLauncher.runtimeDirectory(),
  skillRoot: runtimeConfig.depreciationSkillDir || process.env.TIANYUAN_DEPRECIATION_SKILL_DIR,
});

function getToken() {
  return runtimeToken || envToken;
}

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function scheduleUpdateHostShutdown(message, payload) {
  if (
    message?.action !== "install_workbench_update"
    || !payload?.ok
    || payload?.shutdownRequired !== true
  ) {
    return;
  }
  // The detached installer waits for this process to exit before replacing
  // native_host.exe and the managed Node runtime on Windows.
  setTimeout(() => process.exit(0), 250);
}

function writeCliLoginStatus(status) {
  const payload = {
    action: "cli_login_status",
    updatedAt: new Date().toISOString(),
    ...status,
    security: { credentialsReturned: false, tokenUsed: false, secretsWritten: false },
  };
  try {
    fs.mkdirSync(path.dirname(CLI_LOGIN_STATUS_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(CLI_LOGIN_STATUS_PATH, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  } catch {
    // The authorization response remains useful even if the optional status file cannot be written.
  }
  return payload;
}

function readCliLoginStatus() {
  try {
    const payload = JSON.parse(fs.readFileSync(CLI_LOGIN_STATUS_PATH, "utf8"));
    if (!payload || typeof payload !== "object") return null;
    const updatedAt = Date.parse(payload.updatedAt || "");
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > CLI_LOGIN_SESSION_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCliAuthState() {
  const authPath = path.join(os.homedir(), ".tycpv", "auth.json");
  const tokenPath = path.join(os.homedir(), ".tycpv", "token.secret.json");
  if (!fs.existsSync(authPath) || !fs.existsSync(tokenPath)) {
    return { authenticated: false, expiresAt: null };
  }
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const expiresAt = auth?.expiresAt || null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return { authenticated: false, expiresAt };
    }
    return { authenticated: true, expiresAt };
  } catch {
    return { authenticated: false, expiresAt: null };
  }
}

function isProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function stripAnsi(value) {
  return String(value || "").replace(/[\u001b\u009b]\[[0-?]*[ -/]*[@-~]/g, "");
}

function extractCliAuthorizationUrl(output) {
  const candidates = stripAnsi(output).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[),.;]+$/, "");
    try {
      const url = new URL(cleaned);
      if (url.hostname !== CLI_AUTH_HOST && !url.hostname.endsWith(`.${CLI_AUTH_HOST}`)) continue;
      if (url.pathname !== "/connect") continue;
      const isStaticPage = url.searchParams.get("source") === "valuation"
        && url.searchParams.get("tab") === "cli"
        && url.searchParams.size === 2;
      if (isStaticPage) continue;
      if (url.searchParams.get("auth") !== "login" && url.searchParams.size < 3) continue;
      return url.toString();
    } catch {
      // Ignore non-URL CLI output.
    }
  }
  return "";
}

function cliLoginFailureReason({ error, exitCode, output = "" } = {}) {
  const text = stripAnsi(output).toLowerCase();
  if (error?.code === "ENOENT") return "TYCPV_NOT_FOUND";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "TYCPV_EXECUTION_BLOCKED";
  if (/eaddrinuse|address already in use|listen/i.test(text)) return "CLI_CALLBACK_PORT_UNAVAILABLE";
  if (/authorization|授权|登录|login|http \d{3}|fetch failed|network/i.test(text)) {
    return "CLI_AUTHORIZATION_REQUEST_FAILED";
  }
  if (exitCode !== undefined && exitCode !== null) return `CLI_LOGIN_EXIT_${exitCode}`;
  return "CLI_LOGIN_START_FAILED";
}

function connectorJson(res, statusCode, payload, origin = "*") {
  const body = JSON.stringify(payload);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  res.writeHead(statusCode, headers);
  res.end(body);
}

function connectorError(res, statusCode, reason, extra = {}, origin = "*") {
  connectorJson(res, statusCode, {
    ok: false,
    reason,
    ...extra,
    security: { credentialsReturned: false },
  }, origin);
}

function connectorOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return "";
  if (CONNECTOR_ALLOWED_EXTENSION_ORIGINS.has(origin)) return origin;
  if (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) return origin;
  return null;
}

function connectorRequestBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("CONNECTOR_REQUEST_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("CONNECTOR_INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function connectorId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function connectorSessionId(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return connectorId("tianyuan");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(candidate)) throw new Error("CONNECTOR_SESSION_ID_INVALID");
  return candidate;
}

function connectorSafeBinding(value) {
  const binding = value && typeof value === "object" ? value : {};
  return {
    projectId: String(binding.projectId || "").slice(0, 80),
    projectName: String(binding.projectName || "").slice(0, 160),
    companyId: String(binding.companyId || "").slice(0, 80),
    subjectCode: String(binding.subjectCode || "").slice(0, 120),
    subjectPath: String(binding.subjectPath || "").slice(0, 500),
    pageType: String(binding.pageType || "").slice(0, 120),
    url: String(binding.url || "").slice(0, 1000),
    tabId: Number.isInteger(binding.tabId) ? binding.tabId : null,
    operationScope: String(binding.operationScope || "context-read").slice(0, 120),
  };
}

function connectorPageKey(binding = {}) {
  const projectId = String(binding.projectId || "").trim();
  const companyId = String(binding.companyId || "").trim();
  const pageType = String(binding.pageType || "").trim();
  const url = String(binding.url || "").trim();
  return [projectId, companyId, pageType, projectId || companyId || pageType ? "" : url].join("|");
}

function connectorSafeCodexBinding(value, previous = null) {
  const binding = value && typeof value === "object" ? value : {};
  const now = new Date().toISOString();
  const threadId = String(binding.threadId ?? previous?.threadId ?? "").trim().slice(0, 200);
  const projectId = String(binding.projectId ?? previous?.projectId ?? "").trim().slice(0, 200);
  const scope = binding.scope === "project" ? "project" : "thread";
  if (scope === "thread" && !threadId) throw new Error("CONNECTOR_THREAD_BINDING_REQUIRED");
  if (!projectId && !threadId) throw new Error("CONNECTOR_PROJECT_OR_THREAD_REQUIRED");
  return {
    bindingId: String(binding.bindingId || previous?.bindingId || randomUUID()).slice(0, 200),
    projectId,
    projectName: String(binding.projectName ?? previous?.projectName ?? "").trim().slice(0, 200),
    projectPath: String(binding.projectPath ?? previous?.projectPath ?? "").trim().slice(0, 1000),
    threadId,
    threadTitle: String(binding.threadTitle ?? previous?.threadTitle ?? "").trim().slice(0, 300),
    scope,
    pageKey: String(binding.pageKey || previous?.pageKey || "").slice(0, 1200),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

async function connectorLoadBindings() {
  if (connectorBindingsLoaded) return;
  connectorBindingsLoaded = true;
  try {
    const raw = await fs.promises.readFile(CONNECTOR_BINDINGS_PATH, "utf8");
    const payload = JSON.parse(raw);
    for (const item of Array.isArray(payload?.bindings) ? payload.bindings : []) {
      if (item?.bindingId) connectorBindings.set(String(item.bindingId), item);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") process.stderr.write(`Connector binding load failed: ${error?.message || error}\n`);
  }
}

async function connectorSaveBindings() {
  await fs.promises.mkdir(path.dirname(CONNECTOR_BINDINGS_PATH), { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    bindings: [...connectorBindings.values()],
  };
  const temporaryPath = `${CONNECTOR_BINDINGS_PATH}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.rename(temporaryPath, CONNECTOR_BINDINGS_PATH);
}

function connectorFindPersistedBinding(pageBinding) {
  const pageKey = connectorPageKey(pageBinding);
  return [...connectorBindings.values()]
    .filter((item) => item.pageKey === pageKey)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function connectorPublicCodexBinding(binding) {
  if (!binding) return null;
  return {
    bindingId: binding.bindingId,
    projectId: binding.projectId || "",
    projectName: binding.projectName || "",
    projectPath: binding.projectPath || "",
    threadId: binding.threadId || "",
    threadTitle: binding.threadTitle || "",
    scope: binding.scope || "thread",
    createdAt: binding.createdAt || null,
    updatedAt: binding.updatedAt || null,
  };
}

async function connectorFetchCodexCatalog() {
  try {
    const response = await fetch(`${CONNECTOR_PLATFORM_URL}/api/catalog`);
    if (!response.ok) throw new Error(`CODEX_CATALOG_HTTP_${response.status}`);
    const payload = await response.json();
    if (!payload?.ok) throw new Error(payload?.reason || "CODEX_CATALOG_UNAVAILABLE");
    return {
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      threads: Array.isArray(payload.threads) ? payload.threads : [],
      updatedAt: payload.updatedAt || null,
      source: "connector-platform",
    };
  } catch {
    return connectorReadLocalCodexCatalog();
  }
}

function connectorReadLocalCodexCatalog() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(CODEX_GLOBAL_STATE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`CODEX_LOCAL_CATALOG_UNAVAILABLE: ${error?.message || error}`);
  }

  const projectsById = new Map();
  const addProject = (input = {}) => {
    const projectId = String(input.projectId || input.id || "").trim();
    if (!projectId) return;
    const projectPath = String(
      input.projectPath || input.path || input.cwd || input.rootPaths?.[0] || "",
    ).trim().replace(/[\\/]+$/, "");
    const projectName = String(input.projectName || input.name || "").trim()
      || path.basename(projectPath)
      || projectId;
    const previous = projectsById.get(projectId);
    projectsById.set(projectId, {
      projectId,
      projectName,
      projectPath,
      path: projectPath,
      updatedAt: Number(input.updatedAt || previous?.updatedAt || 0) || null,
    });
  };

  for (const project of Object.values(state["local-projects"] || {})) addProject(project);

  const assignments = state["thread-project-assignments"] || {};
  for (const assignment of Object.values(assignments)) addProject({
    projectId: assignment?.projectId,
    projectPath: assignment?.cwd || assignment?.path,
    projectName: assignment?.projectName,
  });

  const threads = Object.entries(assignments)
    .map(([threadId, assignment]) => {
      const projectId = String(assignment?.projectId || "").trim();
      if (!threadId || !projectId) return null;
      const project = projectsById.get(projectId);
      const projectPath = String(
        assignment?.cwd || assignment?.path || project?.projectPath || "",
      ).trim().replace(/[\\/]+$/, "");
      return {
        threadId,
        title: String(assignment?.title || assignment?.threadTitle || "").trim()
          || `Codex 对话 ${threadId.slice(0, 8)}`,
        projectId,
        projectName: project?.projectName || path.basename(projectPath) || projectId,
        projectPath,
        cwd: projectPath,
        recencyAt: project?.updatedAt || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.recencyAt || 0) - Number(a.recencyAt || 0));

  return {
    projects: [...projectsById.values()]
      .sort((a, b) => String(a.projectName).localeCompare(String(b.projectName), "zh-CN")),
    threads,
    updatedAt: new Date().toISOString(),
    source: "local-codex-state",
  };
}

function connectorApplyCodexBinding(session, binding) {
  session.codexBinding = binding ? { ...binding } : null;
  return session.codexBinding;
}

function connectorSafeClient(value) {
  const client = value && typeof value === "object" ? value : {};
  return {
    name: String(client.name || "tianyuan-browser-workbench").slice(0, 120),
    version: String(client.version || "").slice(0, 80),
    extensionId: String(client.extensionId || "").slice(0, 120),
  };
}

function connectorPrune() {
  const now = Date.now();
  for (const [id, session] of connectorSessions) {
    if (now - Date.parse(session.lastSeenAt) > 120000) connectorSessions.delete(id);
  }
  for (const [id, action] of connectorActions) {
    const reference = Date.parse(action.completedAt || action.createdAt);
    const ttl = action.completedAt ? CONNECTOR_ACTION_RESULT_TTL_MS : CONNECTOR_ACTION_TTL_MS;
    if (!Number.isFinite(reference) || now - reference > ttl) connectorActions.delete(id);
  }
}

function connectorCapabilities() {
  return {
    codexProjectBinding: { supported: true, level: "routing", label: "绑定 Codex 项目" },
    codexThreadBinding: { supported: true, level: "routing", label: "绑定 Codex 对话" },
    contextRead: { supported: true, level: "read", label: "读取当前页面上下文" },
    projectBinding: { supported: true, level: "read", label: "绑定项目与标签页" },
    companyList: { supported: true, level: "read", label: "读取公司清单" },
    subjectList: { supported: true, level: "read", label: "读取科目清单" },
    subjectTreeMirror: { supported: true, level: "read", label: "镜像页面显示科目树" },
    previewBatchSave: { supported: true, level: "preview", label: "批量保存预演" },
    previewExitEdit: { supported: true, level: "preview", label: "批量退出编辑预演" },
    executeBatchSave: { supported: true, level: "confirm", label: "确认后批量保存" },
    executeExitEdit: { supported: true, level: "confirm", label: "确认后批量退出编辑" },
    previewAuditAttachmentUpload: { supported: true, level: "preview", label: "评估核实附件上传预演" },
    executeAuditAttachmentUpload: { supported: true, level: "confirm", label: "确认后上传评估核实附件并保存" },
    batchAuditAttachmentUpload: { supported: true, level: "confirm", label: "确认后批量上传评估核实附件并保存" },
    inspectAuditCheckRow: { supported: true, level: "read", label: "读取查证核对情况" },
    executeAuditCheckResult: { supported: true, level: "confirm", label: "确认后填写查证核对情况并保存" },
    scanAuditIndexCheckRows: { supported: true, level: "read", label: "批量扫描查证资料索引核查状态" },
    batchAuditCheckResult: { supported: true, level: "confirm", label: "确认后批量填写查证核对情况并保存" },
    cliExport: { supported: true, level: "local", label: "CLI 表格导出" },
    printFormat: { supported: true, level: "local", label: "本地打印格式处理" },
    genericBrowserAutomation: { supported: false, level: "unsupported", label: "任意浏览器自动操作" },
    arbitraryJavaScript: { supported: false, level: "unsupported", label: "任意 JavaScript 执行" },
    agentChat: { supported: false, level: "deferred", label: "浏览器内 Agent 对话" },
  };
}

function connectorRequireActionSession(sessionId, input = {}) {
  const session = connectorSessions.get(sessionId);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (!session.codexBinding) throw new Error("SESSION_NOT_BOUND");
  if (String(input.bindingId || "") !== session.codexBinding.bindingId) throw new Error("BINDING_MISMATCH");
  if (input.projectId && String(input.projectId) !== session.codexBinding.projectId) {
    throw new Error("PROJECT_BINDING_MISMATCH");
  }
  if (session.codexBinding.scope === "thread") {
    if (!input.threadId || String(input.threadId) !== session.codexBinding.threadId) {
      throw new Error("THREAD_BINDING_MISMATCH");
    }
  } else if (input.threadId && session.codexBinding.threadId && String(input.threadId) !== session.codexBinding.threadId) {
    throw new Error("THREAD_BINDING_MISMATCH");
  }
  if (session.status !== "online") throw new Error("SESSION_NOT_ONLINE");
  if (!session.binding?.projectId || !session.binding?.companyId || session.binding?.pageType !== "asset-draft") {
    throw new Error("ASSET_DRAFT_SESSION_REQUIRED");
  }
  return session;
}

function connectorSafeActionResult(value) {
  const text = JSON.stringify(value && typeof value === "object" ? value : {});
  if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("ACTION_RESULT_TOO_LARGE");
  return JSON.parse(text);
}

function connectorPublicAction(action) {
  if (!action) return null;
  return {
    actionId: action.actionId,
    sessionId: action.sessionId,
    bindingId: action.bindingId,
    type: action.type,
    status: action.status,
    target: action.target,
    file: action.file ? {
      name: action.file.name,
      size: action.file.size,
      type: action.file.type,
    } : null,
    createdAt: action.createdAt,
    claimedAt: action.claimedAt || null,
    completedAt: action.completedAt || null,
    result: action.result || null,
  };
}

function connectorAttachmentMime(extension) {
  return {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
  }[extension] || "application/octet-stream";
}

async function connectorBuildAttachmentFile(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || ""))) throw new Error("ATTACHMENT_PATH_MUST_BE_ABSOLUTE");
  const stats = await fs.promises.stat(resolved);
  if (!stats.isFile()) throw new Error("ATTACHMENT_NOT_A_FILE");
  if (stats.size <= 0) throw new Error("ATTACHMENT_FILE_EMPTY");
  if (stats.size > CONNECTOR_MAX_ATTACHMENT_BYTES) throw new Error("ATTACHMENT_FILE_TOO_LARGE");
  const extension = path.extname(resolved).toLowerCase();
  if (!CONNECTOR_ATTACHMENT_EXTENSIONS.has(extension)) throw new Error("ATTACHMENT_FILE_TYPE_NOT_ALLOWED");
  return {
    path: resolved,
    name: path.basename(resolved),
    size: stats.size,
    type: connectorAttachmentMime(extension),
  };
}

async function connectorCreateAction(sessionId, input) {
  const session = connectorRequireActionSession(sessionId, input);
  const type = String(input.action || "");
  const allowedActionTypes = [
    "preview_batch_save",
    "batch_save_asset_draft",
    "preview_batch_exit_edit",
    "batch_exit_edit",
    "preview_audit_attachment_upload",
    "upload_audit_attachment",
    "batch_upload_audit_attachments",
    "inspect_audit_check_row",
    "set_audit_check_result",
    "scan_audit_index_check_rows",
    "batch_set_audit_check_results",
    "clear_audit_test_rows",
  ];
  if (!allowedActionTypes.includes(type)) {
    throw new Error("ACTION_NOT_ALLOWED");
  }
  const isBatchSubjectAction = ["preview_batch_save", "batch_save_asset_draft", "preview_batch_exit_edit", "batch_exit_edit"].includes(type);
  const rowNumber = Number(input.rowNumber);
  const isBatchAction = ["batch_upload_audit_attachments", "scan_audit_index_check_rows", "batch_set_audit_check_results", "clear_audit_test_rows"].includes(type) || isBatchSubjectAction;
  if (!isBatchAction && (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 100000)) throw new Error("ROW_NUMBER_INVALID");
  const fieldTitle = String(input.fieldTitle || "查证资料索引").trim();
  const expectedFieldTitle = ["inspect_audit_check_row", "set_audit_check_result", "batch_set_audit_check_results"].includes(type)
    ? "查证核对情况"
    : "查证资料索引";
  if (fieldTitle !== expectedFieldTitle) throw new Error("FIELD_TITLE_NOT_ALLOWED");
  const requestedSubjectCode = String(input.subjectCode || session.binding.subjectCode || "").trim();
  const subjectCode = requestedSubjectCode === "current" ? "" : requestedSubjectCode;
  if (subjectCode && !/^C\d+(?:-\d+)*$/.test(subjectCode)) throw new Error("SUBJECT_CODE_INVALID");
  const normalizeBatchSubjectCode = (value) => {
    const candidate = String(value || "").trim().slice(0, 240);
    if (/^C\d+(?:-\d+)*$/.test(candidate) || /^tree:(?!\s*$).+/.test(candidate) || /^treepath:(?!\s*$).+/.test(candidate)) return candidate;
    throw new Error("SUBJECT_CODE_INVALID");
  };
  const subjectCodes = isBatchSubjectAction
    ? (Array.isArray(input.subjectCodes) ? input.subjectCodes.map(normalizeBatchSubjectCode) : [])
    : [];
  if (isBatchSubjectAction && (!subjectCodes.length || subjectCodes.length > 100)) throw new Error(subjectCodes.length > 100 ? "SUBJECT_CODES_TOO_MANY" : "SUBJECT_CODES_REQUIRED");
  const companyScope = String(input.companyScope || "current").trim();
  if (!["current", "partial", "all"].includes(companyScope)) throw new Error("COMPANY_SCOPE_INVALID");
  if (type === "batch_save_asset_draft" && input.confirmText !== "确认批量保存") throw new Error("BATCH_SAVE_CONFIRM_TEXT_REQUIRED");
  if (type === "batch_exit_edit" && input.confirmText !== "确认批量退出编辑") throw new Error("BATCH_EXIT_CONFIRM_TEXT_REQUIRED");
  const moduleIndex = Number.isInteger(input.moduleIndex) ? input.moduleIndex : Number(input.moduleIndex || 0);
  if (!Number.isInteger(moduleIndex) || moduleIndex < 0 || moduleIndex > 20) throw new Error("MODULE_INDEX_INVALID");
  const moduleName = String(input.moduleName || "").trim().slice(0, 80);
  const procedureText = String(input.procedureText || "").trim().slice(0, 80);
  let file = null;
  if (type === "upload_audit_attachment" || type === "batch_upload_audit_attachments") {
    if (input.confirmText !== (type === "batch_upload_audit_attachments" ? "确认批量上传并保存" : "确认上传并保存")) {
      throw new Error(type === "batch_upload_audit_attachments" ? "BATCH_UPLOAD_CONFIRM_TEXT_REQUIRED" : "UPLOAD_CONFIRM_TEXT_REQUIRED");
    }
    file = await connectorBuildAttachmentFile(input.filePath);
  }
  if (type === "batch_upload_audit_attachments") {
    const rowNumbers = Array.isArray(input.rowNumbers) ? input.rowNumbers : [];
    if (!rowNumbers.length) throw new Error("BATCH_UPLOAD_ROWS_REQUIRED");
    if (rowNumbers.length > 50) throw new Error("ROW_NUMBERS_TOO_MANY");
    for (const row of rowNumbers) {
      const n = Number(row);
      if (!Number.isInteger(n) || n < 2 || n > 100000) throw new Error("ROW_NUMBER_INVALID");
    }
  }
  const resultText = String(input.resultText || "").trim().slice(0, 80);
  if (type === "set_audit_check_result") {
    if (input.confirmText !== "确认填写核对情况并保存") throw new Error("AUDIT_CHECK_CONFIRM_TEXT_REQUIRED");
    if (!resultText) throw new Error("AUDIT_CHECK_RESULT_INVALID");
  }
  if (type === "batch_set_audit_check_results") {
    if (input.confirmText !== "确认批量填写核对情况并保存") throw new Error("BATCH_AUDIT_CHECK_CONFIRM_TEXT_REQUIRED");
    if (!resultText) throw new Error("AUDIT_CHECK_RESULT_INVALID");
    const rowNumbers = Array.isArray(input.rowNumbers) ? input.rowNumbers : [];
    if (rowNumbers.length > 1000) throw new Error("ROW_NUMBERS_TOO_MANY");
    for (const row of rowNumbers) {
      const n = Number(row);
      if (!Number.isInteger(n) || n < 2 || n > 100000) throw new Error("ROW_NUMBER_INVALID");
    }
  }
  if (type === "clear_audit_test_rows") {
    if (input.confirmText !== "确认清理测试数据并保存") throw new Error("CLEAR_TEST_DATA_CONFIRM_TEXT_REQUIRED");
    const rowNumbers = Array.isArray(input.rowNumbers) ? input.rowNumbers : [];
    if (!rowNumbers.length || rowNumbers.length > 100) throw new Error("CLEAR_TEST_ROWS_INVALID");
    for (const row of rowNumbers) {
      const n = Number(row);
      if (!Number.isInteger(n) || n < 2 || n > 100000) throw new Error("ROW_NUMBER_INVALID");
    }
  }
  const maxRows = Math.max(2, Math.min(Number(input.maxRows || 500), 5000));
  const actionId = connectorId("action");
  const now = new Date().toISOString();
  const action = {
    actionId,
    sessionId,
    bindingId: session.codexBinding.bindingId,
    type,
    status: "queued",
    target: {
      projectId: session.binding.projectId,
      companyId: session.binding.companyId,
      subjectCode,
      subjectCodes,
      companyScope,
      companyFilters: Array.isArray(input.companyFilters) ? input.companyFilters.map((value) => String(value || "").slice(0, 160)).slice(0, 100) : [],
      selectedCompanies: Array.isArray(input.selectedCompanies) ? input.selectedCompanies.slice(0, 100).map((item) => ({
        value: String(item?.value || "").slice(0, 160),
        id: String(item?.id || "").slice(0, 160),
        code: String(item?.code || "").slice(0, 160),
        shortName: String(item?.shortName || "").slice(0, 200),
        name: String(item?.name || "").slice(0, 200),
        title: String(item?.title || "").slice(0, 240),
      })) : [],
      companyValues: Array.isArray(input.companyValues) ? input.companyValues.map((value) => String(value || "").slice(0, 160)).slice(0, 100) : [],
      mode: ["batch_save_asset_draft", "batch_exit_edit"].includes(type) ? "execute" : "dry_run",
      rowNumber: isBatchAction ? 0 : rowNumber,
      fieldTitle,
      moduleName,
      moduleIndex,
      resultText,
      procedureText,
      rowNumbers: Array.isArray(input.rowNumbers) ? input.rowNumbers.map((row) => Number(row)).filter(Number.isInteger) : [],
      expectedIndexValues: Array.isArray(input.expectedIndexValues) ? input.expectedIndexValues.map((value) => String(value || "").slice(0, 120)) : [],
      maxRows,
    },
    file,
    confirmText: type === "upload_audit_attachment" || type === "batch_upload_audit_attachments"
      ? (type === "batch_upload_audit_attachments" ? "确认批量上传并保存" : "确认上传并保存")
      : (type === "set_audit_check_result"
        ? "确认填写核对情况并保存"
        : (type === "batch_set_audit_check_results"
          ? "确认批量填写核对情况并保存"
          : (type === "clear_audit_test_rows"
            ? "确认清理测试数据并保存"
            : (type === "batch_save_asset_draft"
              ? "确认批量保存"
              : (type === "batch_exit_edit" ? "确认批量退出编辑" : ""))))),
    createdAt: now,
  };
  connectorActions.set(actionId, action);
  return action;
}

function connectorSafeContext(value) {
  const context = value && typeof value === "object" ? value : {};
  const route = context.route && typeof context.route === "object" ? context.route : {};
  const spread = context.spread && typeof context.spread === "object" ? context.spread : {};
  const page = context.page && typeof context.page === "object" ? context.page : {};
  return {
    route: {
      isTianyuanRoute: Boolean(route.isTianyuanRoute),
      isAssetDraftRoute: Boolean(route.isAssetDraftRoute),
      isEquityListRoute: Boolean(route.isEquityListRoute),
      projectId: String(route.projectId || "").slice(0, 80),
      companyId: String(route.companyId || "").slice(0, 80),
      subjectCode: String(route.subjectCode || "").slice(0, 120),
    },
    spread: {
      found: Boolean(spread.found),
      sheetName: String(spread.sheetName || "").slice(0, 160),
      activeRow: Number.isInteger(spread.activeRow) ? spread.activeRow : null,
      activeColumn: Number.isInteger(spread.activeColumn) ? spread.activeColumn : null,
    },
    gates: {
      loginLikely: Boolean(page.loginLikely),
      saveVisible: Boolean(page.saveButton?.visible),
      saveDisabled: Boolean(page.saveButton?.disabled),
      hasLockText: Boolean(String(page.lockText || "").trim()),
      hasPermissionText: Boolean(String(page.permissionText || "").trim()),
    },
  };
}

async function connectorHandle(req, res) {
  const requestOrigin = String(req.headers.origin || "");
  const origin = connectorOrigin(req);
  if (requestOrigin && !origin) {
    connectorError(res, 403, "CONNECTOR_ORIGIN_FORBIDDEN", {}, "");
    return;
  }
  if (req.method === "OPTIONS") {
    connectorJson(res, 204, {}, origin);
    return;
  }
  connectorPrune();
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      connectorJson(res, 200, {
        ok: true,
        service: "tianyuan-connector-bridge",
        protocolVersion: CONNECTOR_PROTOCOL_VERSION,
        adapter: "tianyuan-browser",
        mode: "local",
        sessionCount: connectorSessions.size,
        bindingCount: connectorBindings.size,
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/protocol") {
      connectorJson(res, 200, {
        ok: true,
        protocolVersion: CONNECTOR_PROTOCOL_VERSION,
        adapter: "tianyuan-browser",
        capabilities: connectorCapabilities(),
        safety: {
          genericBrowserAutomation: false,
          arbitraryJavaScript: false,
          editLockRequired: true,
          explicitConfirmationRequired: true,
          bindingIdRequiredForCodexRouting: true,
          defaultBindingScope: "thread",
          credentialsStored: false,
        },
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      connectorJson(res, 200, {
        ok: true,
        sessions: [...connectorSessions.values()],
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const catalog = await connectorFetchCodexCatalog();
      connectorJson(res, 200, {
        ok: true,
        ...catalog,
        source: catalog.source || "connector-platform",
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/project-bindings") {
      await connectorLoadBindings();
      connectorJson(res, 200, {
        ok: true,
        bindings: [...connectorBindings.values()].map(connectorPublicCodexBinding),
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sessions/register") {
      const input = await connectorRequestBody(req);
      const sessionId = connectorSessionId(input.sessionId);
      const now = new Date().toISOString();
      const pageBinding = connectorSafeBinding(input.binding);
      await connectorLoadBindings();
      const persistedBinding = connectorFindPersistedBinding(pageBinding);
      const session = {
        sessionId,
        status: "online",
        registeredAt: connectorSessions.get(sessionId)?.registeredAt || now,
        lastSeenAt: now,
        binding: pageBinding,
        codexBinding: connectorPublicCodexBinding(persistedBinding),
        client: connectorSafeClient(input.client),
        context: connectorSafeContext(input.context),
        capabilities: connectorCapabilities(),
      };
      connectorSessions.set(sessionId, session);
      connectorJson(res, 200, { ok: true, session, security: { credentialsReturned: false } }, origin);
      return;
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "heartbeat"
    ) {
      const input = await connectorRequestBody(req);
      const session = connectorSessions.get(parts[2]);
      if (!session) {
        connectorError(res, 404, "SESSION_NOT_FOUND", {}, origin);
        return;
      }
      session.lastSeenAt = new Date().toISOString();
      if (input.binding) session.binding = connectorSafeBinding(input.binding);
      if (input.context) session.context = connectorSafeContext(input.context);
      connectorJson(res, 200, { ok: true, session, security: { credentialsReturned: false } }, origin);
      return;
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "binding"
    ) {
      const session = connectorSessions.get(parts[2]);
      if (!session) {
        connectorError(res, 404, "SESSION_NOT_FOUND", {}, origin);
        return;
      }
      await connectorLoadBindings();
      const input = await connectorRequestBody(req);
      const previous = session.codexBinding
        ? connectorBindings.get(session.codexBinding.bindingId) || session.codexBinding
        : connectorFindPersistedBinding(session.binding);
      const next = connectorSafeCodexBinding({
        ...input,
        pageKey: connectorPageKey(session.binding),
      }, previous);
      connectorBindings.set(next.bindingId, next);
      connectorApplyCodexBinding(session, next);
      await connectorSaveBindings();
      connectorJson(res, 200, {
        ok: true,
        session,
        binding: connectorPublicCodexBinding(next),
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (
      req.method === "POST" &&
      parts.length === 5 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "binding" &&
      parts[4] === "current-thread"
    ) {
      const session = connectorSessions.get(parts[2]);
      if (!session) {
        connectorError(res, 404, "SESSION_NOT_FOUND", {}, origin);
        return;
      }
      const input = await connectorRequestBody(req);
      const catalog = await connectorFetchCodexCatalog();
      const projectId = String(input.projectId || "").trim();
      const projectPath = String(input.projectPath || "").trim().replace(/[\\/]+$/, "");
      const projectName = String(input.projectName || "").trim();
      const candidates = catalog.threads.filter((thread) => {
        const threadPath = String(thread.projectPath || "").replace(/[\\/]+$/, "");
        return (
          (projectId && thread.projectId === projectId) ||
          (projectPath && threadPath === projectPath) ||
          (projectName && thread.projectName === projectName)
        );
      }).sort((a, b) =>
        Number(b.recencyAt || b.updatedAt || 0) - Number(a.recencyAt || a.updatedAt || 0)
      );
      const thread = candidates[0];
      if (!thread?.threadId) {
        connectorError(res, 404, "CURRENT_THREAD_NOT_FOUND", {}, origin);
        return;
      }
      await connectorLoadBindings();
      const previous = session.codexBinding
        ? connectorBindings.get(session.codexBinding.bindingId) || session.codexBinding
        : connectorFindPersistedBinding(session.binding);
      const next = connectorSafeCodexBinding({
        projectId: projectId || thread.projectId || "",
        projectName: projectName || thread.projectName || "",
        projectPath: projectPath || thread.projectPath || "",
        threadId: thread.threadId,
        threadTitle: thread.title || "",
        scope: "thread",
        pageKey: connectorPageKey(session.binding),
      }, previous);
      connectorBindings.set(next.bindingId, next);
      connectorApplyCodexBinding(session, next);
      await connectorSaveBindings();
      connectorJson(res, 200, {
        ok: true,
        session,
        binding: connectorPublicCodexBinding(next),
        thread,
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (
      req.method === "DELETE" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "binding"
    ) {
      const session = connectorSessions.get(parts[2]);
      if (!session) {
        connectorError(res, 404, "SESSION_NOT_FOUND", {}, origin);
        return;
      }
      await connectorLoadBindings();
      const bindingId = session.codexBinding?.bindingId || "";
      const pageKey = connectorPageKey(session.binding);
      let cleared = false;
      for (const [id, binding] of connectorBindings) {
        if ((bindingId && id === bindingId) || binding.pageKey === pageKey) {
          connectorBindings.delete(id);
          cleared = true;
        }
      }
      connectorApplyCodexBinding(session, null);
      await connectorSaveBindings();
      connectorJson(res, 200, {
        ok: true,
        session,
        cleared,
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (
      req.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "actions"
    ) {
      const input = await connectorRequestBody(req);
      const action = await connectorCreateAction(parts[2], input);
      connectorJson(res, 200, {
        ok: true,
        action: connectorPublicAction(action),
        security: {
          credentialsReturned: false,
          fileContentsReturned: false,
        },
      }, origin);
      return;
    }
    if (
      req.method === "GET" &&
      parts.length === 5 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "actions" &&
      parts[4] === "next"
    ) {
      const auth = {
        bindingId: url.searchParams.get("bindingId") || "",
        projectId: url.searchParams.get("projectId") || "",
        threadId: url.searchParams.get("threadId") || "",
      };
      connectorRequireActionSession(parts[2], auth);
      const action = [...connectorActions.values()]
        .filter((item) => item.sessionId === parts[2] && item.status === "queued")
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
      if (!action) {
        connectorJson(res, 200, { ok: true, action: null, security: { credentialsReturned: false } }, origin);
        return;
      }
      action.status = "claimed";
      action.claimedAt = new Date().toISOString();
      let filePayload = null;
      if (action.file) {
        const data = await fs.promises.readFile(action.file.path);
        filePayload = {
          name: action.file.name,
          size: action.file.size,
          type: action.file.type,
          base64: data.toString("base64"),
        };
      }
      connectorJson(res, 200, {
        ok: true,
        action: {
          ...connectorPublicAction(action),
          payload: {
            action: action.type,
            ...action.target,
            confirmText: action.confirmText,
            file: filePayload,
          },
        },
        security: {
          credentialsReturned: false,
          filePathReturned: false,
          fileContentsEphemeral: Boolean(filePayload),
        },
      }, origin);
      return;
    }
    if (
      req.method === "POST" &&
      parts.length === 6 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "actions" &&
      parts[5] === "result"
    ) {
      const input = await connectorRequestBody(req);
      const session = connectorRequireActionSession(parts[2], input);
      const action = connectorActions.get(parts[4]);
      if (!action || action.sessionId !== session.sessionId) {
        connectorError(res, 404, "ACTION_NOT_FOUND", {}, origin);
        return;
      }
      if (!["claimed", "running"].includes(action.status)) throw new Error("ACTION_NOT_CLAIMED");
      action.result = connectorSafeActionResult(input.result);
      action.status = action.result?.ok ? "completed" : "failed";
      action.completedAt = new Date().toISOString();
      connectorJson(res, 200, {
        ok: true,
        action: connectorPublicAction(action),
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (
      req.method === "GET" &&
      parts.length === 5 &&
      parts[0] === "api" &&
      parts[1] === "sessions" &&
      parts[3] === "actions"
    ) {
      const action = connectorActions.get(parts[4]);
      if (!action || action.sessionId !== parts[2]) {
        connectorError(res, 404, "ACTION_NOT_FOUND", {}, origin);
        return;
      }
      connectorRequireActionSession(parts[2], {
        bindingId: url.searchParams.get("bindingId") || "",
        projectId: url.searchParams.get("projectId") || "",
        threadId: url.searchParams.get("threadId") || "",
      });
      connectorJson(res, 200, {
        ok: true,
        action: connectorPublicAction(action),
        security: { credentialsReturned: false },
      }, origin);
      return;
    }
    if (req.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "sessions") {
      const session = connectorSessions.get(parts[2]);
      if (!session) {
        connectorError(res, 404, "SESSION_NOT_FOUND", {}, origin);
        return;
      }
      connectorJson(res, 200, { ok: true, session, security: { credentialsReturned: false } }, origin);
      return;
    }
    connectorError(res, 404, "NOT_FOUND", {}, origin);
  } catch (error) {
    connectorError(res, 500, error?.message || String(error), {}, origin);
  }
}

function startConnectorBridge() {
  return connectorBridge.start({
    port: Number(process.env.TIANYUAN_CONNECTOR_PORT || DEFAULT_CONNECTOR_PORT),
  });
}

async function connectorBridgeHealth() {
  return connectorBridge.health(Number(process.env.TIANYUAN_CONNECTOR_PORT || DEFAULT_CONNECTOR_PORT));
}

async function connectorBridgeListenerPids() {
  return await platformAdapter.listenerPids(DEFAULT_CONNECTOR_PORT);
}

async function stopConnectorBridgeAction() {
  const existing = await connectorBridgeHealth();
  if (!existing?.ok) {
    return { ok: true, stopped: false, reason: "CONNECTOR_NOT_RUNNING", security: { credentialsReturned: false } };
  }
  if (existing.service !== "tianyuan-connector-bridge") {
    return { ok: false, stopped: false, reason: "CONNECTOR_PORT_OCCUPIED_BY_OTHER_SERVICE", security: { credentialsReturned: false } };
  }
  const pids = [...new Set([
    Number(existing.pid || 0),
    ...(await connectorBridgeListenerPids()),
  ].filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid))];
  if (!pids.length) {
    return { ok: false, stopped: false, reason: "CONNECTOR_PROCESS_NOT_FOUND", security: { credentialsReturned: false } };
  }
  for (const pid of pids) {
    await platformAdapter.terminateProcess(pid);
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const health = await connectorBridgeHealth();
    if (!health?.ok) {
      return { ok: true, stopped: true, pids, security: { credentialsReturned: false } };
    }
  }
  return { ok: false, stopped: false, reason: "CONNECTOR_STOP_TIMEOUT", pids, security: { credentialsReturned: false } };
}

async function startConnectorBridgeAction({ forceRestart = false } = {}) {
  const existing = await connectorBridgeHealth();
  let restart = null;
  if (existing?.ok && !forceRestart) {
    return { ok: true, started: false, connector: existing, security: { credentialsReturned: false } };
  }
  if (existing?.ok && forceRestart) {
    restart = await stopConnectorBridgeAction();
    if (!restart.ok) return restart;
  }
  const launch = processLauncher.selfLaunchSpec(["--connector-bridge"]);
  const child = spawn(launch.command, launch.args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...launch.env,
      TIANYUAN_CONNECTOR_PORT: String(DEFAULT_CONNECTOR_PORT),
      TIANYUAN_RUNTIME_CONFIG_PATH: RUNTIME_CONFIG_PATH,
    },
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const health = await connectorBridgeHealth();
    if (health?.ok) {
      return { ok: true, started: true, restarted: Boolean(restart?.stopped), connector: health, security: { credentialsReturned: false } };
    }
  }
  return { ok: false, reason: "CONNECTOR_START_TIMEOUT", security: { credentialsReturned: false } };
}

function readMessages(onMessage) {
  let buffer = Buffer.alloc(0);
  let inputEnded = false;
  let pendingRequests = 0;
  let exitScheduled = false;

  function maybeExit() {
    if (!inputEnded || pendingRequests > 0 || exitScheduled) return;
    exitScheduled = true;
    setImmediate(() => process.exit(0));
  }

  process.stdin.on("end", () => {
    // Chrome may close stdin immediately after sending a one-shot message.
    // Keep the host alive until the async handler has written its response.
    inputEnded = true;
    maybeExit();
  });
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      const raw = buffer.slice(4, 4 + length).toString("utf8");
      buffer = buffer.slice(4 + length);
      pendingRequests += 1;
      Promise.resolve()
        .then(() => onMessage(JSON.parse(raw)))
        .catch(() => {})
        .finally(() => {
          pendingRequests = Math.max(0, pendingRequests - 1);
          maybeExit();
        });
    }
  });
}


function withTimeout(promise, ms, timeoutReason) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutReason)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function readCliPackageVersion(candidate) {
  if (!candidate) return "";
  const candidateDirectory = path.dirname(candidate);
  const packageCandidates = [
    path.join(candidateDirectory, "app", "package.json"),
    path.join(candidateDirectory, "package.json"),
    path.join(path.dirname(candidateDirectory), "package.json"),
  ];
  for (const packagePath of packageCandidates) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (packageJson?.version) return String(packageJson.version);
    } catch {
      // Try the next known package location without exposing local file contents.
    }
  }
  return "";
}

function checkCli() {
  return new Promise((resolve) => {
    const auth = readCliAuthState();
    // Windows tycpv 0.1.0 may keep a Node process alive during --version.
    // --help is a read-only probe; package.json supplies the version when available.
    const probeArgs = IS_WINDOWS ? ["--help"] : ["--version"];
    const launch = processLauncher.commandLaunchSpec(CLI_BIN, probeArgs);
    execFile(launch.command, launch.args, {
      timeout: 5000,
      env: launch.env,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          reason: error.code === "ENOENT" ? "TYCPV_NOT_FOUND" : "TYCPV_VERSION_FAILED",
          authenticated: auth.authenticated,
          authExpiresAt: auth.expiresAt,
        });
        return;
      }
      resolve({
        ok: true,
        version: IS_WINDOWS
          ? (readCliPackageVersion(CLI_BIN) || "可用（--help 探测通过）")
          : String(stdout || stderr || "").trim().split(/\r?\n/)[0] || "可用",
        authenticated: auth.authenticated,
        authExpiresAt: auth.expiresAt,
      });
    });
  });
}

async function getCliLoginStatus(sessionId = "") {
  const status = readCliLoginStatus();
  if (sessionId && status?.sessionId && status.sessionId !== sessionId) {
    return { ok: false, reason: "CLI_LOGIN_SESSION_NOT_FOUND" };
  }
  const auth = readCliAuthState();
  if (auth.authenticated) {
    const next = writeCliLoginStatus({
      ...(status || {}),
      state: "authenticated",
      authenticated: true,
      authExpiresAt: auth.expiresAt,
    });
    return { ok: true, ...next };
  }
  if (!status) {
    return { ok: false, state: "idle", reason: "CLI_LOGIN_NOT_STARTED" };
  }
  if (["authorization_required", "starting"].includes(status.state) && !isProcessAlive(status.pid)) {
    const next = writeCliLoginStatus({
      ...status,
      state: "failed",
      reason: "CLI_LOGIN_PROCESS_EXITED",
      authenticated: false,
    });
    return { ok: false, ...next };
  }
  return { ok: status.state !== "failed", ...status, authenticated: false };
}

function startCliLogin() {
  const auth = readCliAuthState();
  if (auth.authenticated) {
    return Promise.resolve({
      ok: true,
      action: "cli_login",
      state: "authenticated",
      authenticated: true,
      authExpiresAt: auth.expiresAt,
      security: { credentialsReturned: false },
    });
  }

  const previous = readCliLoginStatus();
  if (
    previous
    && ["starting", "authorization_required"].includes(previous.state)
    && isProcessAlive(previous.pid)
    && previous.authorizationUrl
  ) {
    return Promise.resolve({
      ok: true,
      action: "cli_login",
      state: previous.state,
      sessionId: previous.sessionId,
      pid: previous.pid,
      authorizationUrl: previous.authorizationUrl,
      reused: true,
      security: { credentialsReturned: false },
    });
  }

  if (!CLI_BIN || (!fs.existsSync(CLI_BIN) && /[\\/]/.test(CLI_BIN))) {
    return Promise.resolve({
      ok: false,
      action: "cli_login",
      reason: "TYCPV_NOT_FOUND",
      manualCommand: "tycpv login",
      security: { credentialsReturned: false },
    });
  }

  const sessionId = randomUUID();
  const launch = processLauncher.commandLaunchSpec(CLI_BIN, ["login"]);
  let spawnCommand = launch.command;
  let spawnArgs = launch.args;
  let spawnOptions = { detached: true, stdio: ["ignore", "pipe", "pipe"], env: launch.env, windowsHide: true };
  if (process.platform === "win32") {
    // The CLI needs a REAL console to run its login flow: with piped or
    // ignored stdio it exits 0 silently before printing the authorization
    // URL. `start` opens a dedicated visible console where the CLI prints
    // the URL, opens the default browser itself, and waits for the local
    // callback; /wait keeps this wrapper process alive so the session stays
    // trackable while the user completes authorization.
    spawnCommand = process.env.ComSpec || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", "start", "天源 CLI 授权", "/wait", launch.command].concat(launch.args);
    spawnOptions = { detached: true, stdio: "ignore", env: launch.env, windowsHide: false };
  }
  let child;
  try {
    child = spawn(spawnCommand, spawnArgs, spawnOptions);
  } catch (error) {
    return Promise.resolve({
      ok: false,
      action: "cli_login",
      reason: cliLoginFailureReason({ error }),
      manualCommand: "tycpv login",
      security: { credentialsReturned: false },
    });
  }

  const started = writeCliLoginStatus({
    sessionId,
    pid: child.pid,
    state: "starting",
    authenticated: false,
  });
  let output = "";
  let settled = false;
  let timer = null;
  const appendOutput = (chunk) => {
    output = `${output}${stripAnsi(chunk)}`.slice(-32 * 1024);
  };
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    callback(value);
  };

  if (process.platform === "win32") {
    const status = writeCliLoginStatus({ ...started, state: "authorization_required", authenticated: false });
    return Promise.resolve({ ok: true, action: "cli_login", state: "authorization_required", sessionId, pid: child.pid, authorizationUrl: "", security: { credentialsReturned: false }, statusUpdatedAt: status.updatedAt });
  }

  return new Promise((resolve) => {
    const onOutput = (chunk) => {
      appendOutput(chunk);
      const authorizationUrl = extractCliAuthorizationUrl(output);
      if (!authorizationUrl) return;
      const status = writeCliLoginStatus({
        ...started,
        sessionId,
        pid: child.pid,
        state: "authorization_required",
        authorizationUrl,
        authenticated: false,
      });
      finish(resolve, {
        ok: true,
        action: "cli_login",
        state: "authorization_required",
        sessionId,
        pid: child.pid,
        authorizationUrl,
        security: { credentialsReturned: false },
        statusUpdatedAt: status.updatedAt,
      });
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", (error) => {
      const reason = cliLoginFailureReason({ error, output });
      writeCliLoginStatus({ ...started, state: "failed", reason, authenticated: false });
      finish(resolve, {
        ok: false,
        action: "cli_login",
        reason,
        manualCommand: "tycpv login",
        security: { credentialsReturned: false },
      });
    });
    child.once("close", (exitCode) => {
      const authAfterExit = readCliAuthState();
      if (authAfterExit.authenticated) {
        writeCliLoginStatus({
          ...started,
          state: "authenticated",
          authenticated: true,
          authExpiresAt: authAfterExit.expiresAt,
        });
        finish(resolve, {
          ok: true,
          action: "cli_login",
          state: "authenticated",
          sessionId,
          authenticated: true,
          security: { credentialsReturned: false },
        });
        return;
      }
      const reason = cliLoginFailureReason({ exitCode, output });
      writeCliLoginStatus({ ...started, state: "failed", reason, authenticated: false });
      finish(resolve, {
        ok: false,
        action: "cli_login",
        reason,
        manualCommand: "tycpv login",
        security: { credentialsReturned: false },
      });
    });
    timer = setTimeout(() => {
      const reason = "CLI_AUTHORIZATION_URL_TIMEOUT";
      void platformAdapter.terminateProcess(child.pid);
      writeCliLoginStatus({ ...started, state: "failed", reason, authenticated: false });
      finish(resolve, {
        ok: false,
        action: "cli_login",
        reason,
        manualCommand: "tycpv login",
        security: { credentialsReturned: false },
      });
    }, CLI_LOGIN_URL_WAIT_MS);
    child.unref();
    child.stdout?._handle?.unref?.();
    child.stderr?._handle?.unref?.();
  });
}

async function chooseDirectory(prompt) {
  return await platformAdapter.chooseDirectory(prompt);
}

function selectedDirectoryPath(result) {
  return String(result?.outputDirectory || result?.path || result?.paths?.[0] || "").trim();
}

async function chooseManagedOutputDirectory(prompt, directoryName, action, failureReason) {
  const result = await chooseDirectory(prompt);
  const rawParentPath = selectedDirectoryPath(result);
  if (!result?.ok || !rawParentPath) {
    return {
      ...result,
      action,
      path: "",
      paths: [],
      security: { credentialsReturned: false },
    };
  }
  try {
    const parentPath = validateExportDirectory(rawParentPath);
    const folderName = String(directoryName || "").trim();
    if (!folderName || folderName === "." || folderName === ".." || path.basename(folderName) !== folderName) {
      throw new Error("EXPORT_DIRECTORY_NAME_INVALID");
    }
    const outputPath = path.basename(parentPath) === folderName ? parentPath : path.join(parentPath, folderName);
    const alreadyExists = fs.existsSync(outputPath);
    fs.mkdirSync(outputPath, { recursive: true, mode: 0o700 });
    const selectedPath = fs.realpathSync(outputPath);
    return {
      ...result,
      ok: true,
      action,
      path: selectedPath,
      paths: [selectedPath],
      outputDirectory: selectedPath,
      parentPath,
      directoryName: folderName,
      createdDirectory: !alreadyExists,
      security: { credentialsReturned: false },
    };
  } catch {
    return {
      ok: false,
      action,
      path: "",
      paths: [],
      reason: failureReason,
      security: { credentialsReturned: false },
    };
  }
}

async function chooseExportDirectory(message = {}) {
  return await chooseManagedOutputDirectory(
    "选择天源表格导出上级目录",
    message.directoryName || "天源表格导出",
    "export_directory_selected",
    "EXPORT_DIRECTORY_CREATE_FAILED",
  );
}

async function chooseWorkbookFiles() {
  const result = await platformAdapter.chooseWorkbookFiles();
  return {
    ...result,
    action: "print_workbook_files_selected",
  };
}

async function chooseTableFormatWordFiles() {
  const result = await platformAdapter.chooseWordFiles();
  return {
    ...result,
    action: "table_format_word_files_selected",
  };
}

async function chooseWorkbookDirectory() {
  const result = await chooseDirectory("选择包含待处理 Excel 文件的文件夹");
  return {
    ...result,
    action: "print_workbook_directory_selected",
  };
}

async function chooseBatchUploadDirectory() {
  const result = await chooseDirectory("选择批量上传文件夹");
  const selectedPath = result.paths?.[0] || "";
  return {
    ...result,
    action: "batch_upload_directory_selected",
    path: selectedPath ? selectedPath.replace(/[\\/]+$/, "") || path.parse(selectedPath).root : "",
  };
}

function collectBatchUploadFiles(rootPath, results, relativeRoot = "") {
  if (results.length >= 200) return;
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= 200) return;
    const fullPath = path.join(rootPath, entry.name);
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      collectBatchUploadFiles(fullPath, results, relativePath);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!CONNECTOR_ATTACHMENT_EXTENSIONS.has(extension)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.size <= 0 || stat.size > CONNECTOR_MAX_ATTACHMENT_BYTES) continue;
    results.push({
      name: entry.name,
      relativePath,
      filePath: fs.realpathSync(fullPath),
      size: stat.size,
      extension,
      type: connectorAttachmentMime(extension),
    });
  }
}

function listBatchUploadDirectory(input = {}) {
  const rawPath = String(input.path || "").trim();
  if (!rawPath || !path.isAbsolute(rawPath)) throw new Error("BATCH_UPLOAD_DIRECTORY_MUST_BE_ABSOLUTE");
  const rootPath = fs.realpathSync(rawPath);
  if (!fs.statSync(rootPath).isDirectory()) throw new Error("BATCH_UPLOAD_DIRECTORY_NOT_FOUND");
  const files = [];
  collectBatchUploadFiles(rootPath, files);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  return {
    ok: true,
    action: "batch_upload_directory_listed",
    path: rootPath,
    files,
    truncated: files.length >= 200,
    security: { credentialsReturned: false, fileContentsReturned: false },
  };
}

async function choosePrintOutputDirectory(message = {}) {
  return await chooseManagedOutputDirectory(
    "选择处理后文件的上级目录",
    message.directoryName || "表格处理结果",
    "print_output_directory_selected",
    "PRINT_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

async function chooseTableFormatOutputDirectory() {
  return await chooseManagedOutputDirectory(
    "选择表格设置处理后文件的上级目录",
    "表格格式设置",
    "table_format_output_directory_selected",
    "TABLE_FORMAT_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

async function chooseLandPublicityOutputDirectory() {
  return await chooseManagedOutputDirectory(
    "选择浙江土地成交公示上级目录",
    "浙江土地成交公示",
    "land_publicity_output_directory_selected",
    "LAND_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

function landHistoryDirectoryReadback(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("LAND_HISTORY_DIRECTORY_INVALID");
  const resolved = fs.realpathSync(raw);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("LAND_HISTORY_DIRECTORY_NOT_FOUND");
  return resolved;
}

function landHistoryPathReadback(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("LAND_HISTORY_PATH_INVALID");
  const resolved = fs.realpathSync(raw);
  if (![".json", ".xlsx"].includes(path.extname(resolved).toLowerCase())) throw new Error("LAND_HISTORY_PATH_TYPE_NOT_ALLOWED");
  if (!fs.statSync(resolved).isFile()) throw new Error("LAND_HISTORY_PATH_NOT_FOUND");
  return resolved;
}

function landHistoryOutputPath(filePath, name) {
  const candidate = path.join(path.dirname(filePath), String(name || ""));
  if (!fs.existsSync(candidate)) return "";
  const resolved = fs.realpathSync(candidate);
  if (path.dirname(resolved) !== path.dirname(filePath)) return "";
  return fs.statSync(resolved).isFile() ? resolved : "";
}

function listLandPublicityHistory(message = {}) {
  const root = landHistoryDirectoryReadback(message.directory);
  const files = fs.readdirSync(root, { withFileTypes: true });
  const manifestNames = new Set(files.filter((entry) => entry.isFile() && entry.name.endsWith("_history.json")).map((entry) => entry.name.replace(/_history\.json$/, "")));
  const items = [];
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.name.endsWith("_history.json")) {
      try {
        const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (payload?.type !== "zj-land-publicity-history") continue;
        const outputs = payload.outputs || {};
        items.push({
          path: fs.realpathSync(fullPath),
          name: entry.name,
          label: `${payload.request?.district || "全省"} · ${payload.generatedAt || "历史抓取"} · ${payload.summary?.written ?? payload.items?.length ?? 0} 条`,
          generatedAt: payload.generatedAt || "",
          recordCount: Number(payload.summary?.written ?? payload.items?.length ?? 0),
          fetchedCount: Number(payload.summary?.fetched ?? payload.items?.length ?? 0),
          filteredCount: Number(payload.summary?.filtered ?? payload.items?.length ?? 0),
          writtenCount: Number(payload.summary?.written ?? payload.items?.length ?? 0),
          canRefresh: Array.isArray(payload.items) && payload.items.some((item) => item?.record?.sourceId),
          htmlPath: landHistoryOutputPath(fullPath, outputs.html || entry.name.replace(/_history\.json$/, ".html")),
          excelPath: landHistoryOutputPath(fullPath, outputs.excel || entry.name.replace(/_history\.json$/, ".xlsx")),
          mapPath: landHistoryOutputPath(fullPath, outputs.map || entry.name.replace(/_history\.json$/, "_map.html")),
        });
      } catch {
        // Ignore unrelated or incomplete JSON files.
      }
      continue;
    }
    if (entry.name.endsWith(".xlsx") && entry.name.startsWith("浙江土地成交公示_") && !manifestNames.has(entry.name.replace(/\.xlsx$/, ""))) {
      const base = entry.name.replace(/\.xlsx$/, "");
      items.push({
        path: fs.realpathSync(fullPath),
        name: entry.name,
        label: `${base} · 旧 Excel 结果（可加载）`,
        generatedAt: "",
        recordCount: 0,
        fetchedCount: 0,
        filteredCount: 0,
        writtenCount: 0,
        canRefresh: true,
        htmlPath: landHistoryOutputPath(fullPath, `${base}.html`),
        excelPath: fs.realpathSync(fullPath),
        mapPath: landHistoryOutputPath(fullPath, `${base}_map.html`),
      });
    }
  }
  items.sort((left, right) => String(right.generatedAt || right.name).localeCompare(String(left.generatedAt || left.name), "zh-CN"));
  return { ok: true, action: "list_land_publicity_history", directory: root, items: items.slice(0, 200), security: { credentialsReturned: false } };
}

function loadLandPublicityHistory(message = {}) {
  const historyPath = landHistoryPathReadback(message.path);
  const directory = path.dirname(historyPath);
  let payload = {};
  if (path.extname(historyPath).toLowerCase() === ".json") {
    try { payload = JSON.parse(fs.readFileSync(historyPath, "utf8")); } catch { throw new Error("LAND_HISTORY_READ_FAILED"); }
    if (payload?.type !== "zj-land-publicity-history") throw new Error("LAND_HISTORY_FORMAT_INVALID");
  }
  const base = path.basename(historyPath).replace(/_history\.json$/, "").replace(/\.xlsx$/, "");
  const outputs = payload.outputs || {};
  const excelPath = landHistoryOutputPath(historyPath, outputs.excel || `${base}.xlsx`);
  const htmlPath = landHistoryOutputPath(historyPath, outputs.html || `${base}.html`);
  const mapPath = landHistoryOutputPath(historyPath, outputs.map || `${base}_map.html`);
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    ok: true,
    action: "load_land_publicity_history",
    path: historyPath,
    outputDirectory: directory,
    request: payload.request || {},
    recordCount: Number(payload.summary?.written ?? items.length ?? 0),
    fetchedCount: Number(payload.summary?.fetched ?? items.length ?? 0),
    filteredCount: Number(payload.summary?.filtered ?? items.length ?? 0),
    writtenCount: Number(payload.summary?.written ?? items.length ?? 0),
    canRefresh: path.extname(historyPath).toLowerCase() === ".xlsx" || Boolean(items.some((item) => item?.record?.sourceId)),
    excelPath,
    htmlPath,
    mapPath,
    security: { credentialsReturned: false },
  };
}

async function chooseAlibabaAuctionOutputDirectory() {
  return await chooseManagedOutputDirectory(
    "选择阿里司法拍卖上级目录",
    "阿里司法拍卖",
    "alibaba_auction_output_directory_selected",
    "ALIBABA_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

async function chooseAnjukePropertyOutputDirectory() {
  return await chooseManagedOutputDirectory(
    "选择安居客物业案例上级目录",
    "安居客物业案例",
    "anjuke_property_output_directory_selected",
    "ANJUKE_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

async function chooseAlibabaLeaseOutputDirectory() {
  return await chooseManagedOutputDirectory(
    "选择阿里资产租赁上级目录",
    "阿里资产租赁",
    "alibaba_lease_output_directory_selected",
    "ALIBABA_LEASE_OUTPUT_DIRECTORY_CREATE_FAILED",
  );
}

function isWorkbookPath(value) {
  const extension = path.extname(String(value || "")).toLowerCase();
  return extension === ".xlsx" || extension === ".xlsm";
}

function shouldSkipWorkbook(filePath) {
  const name = path.basename(filePath);
  return name.startsWith("~$")
    || name.includes(".打印格式调整前备份-")
    || name.includes(".申报表转换前备份-")
    || /-打印版(?:\s*\(\d+\))?\.(xlsx|xlsm)$/i.test(name);
}

function walkWorkbookFiles(rootPath, results) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= 500) throw new Error("PRINT_INPUT_LIMIT_EXCEEDED");
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkWorkbookFiles(fullPath, results);
    } else if (entry.isFile() && isWorkbookPath(fullPath) && !shouldSkipWorkbook(fullPath)) {
      results.push(fs.realpathSync(fullPath));
    }
  }
}

function collectWorkbookFiles(inputPaths) {
  const results = [];
  const seen = new Set();
  for (const value of Array.isArray(inputPaths) ? inputPaths : []) {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("PRINT_INPUT_INVALID");
    const resolved = fs.realpathSync(raw);
    const stat = fs.statSync(resolved);
    const candidates = [];
    if (stat.isDirectory()) {
      walkWorkbookFiles(resolved, candidates);
    } else if (stat.isFile() && isWorkbookPath(resolved) && !path.basename(resolved).startsWith("~$")) {
      candidates.push(resolved);
    }
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      results.push(candidate);
    }
  }
  if (!results.length) throw new Error("NO_PRINT_WORKBOOKS_FOUND");
  return results;
}

function isWordDocumentPath(value) {
  return path.extname(String(value || "")).toLowerCase() === ".docx";
}

function collectWordDocumentFiles(inputPaths) {
  const results = [];
  const seen = new Set();
  for (const value of Array.isArray(inputPaths) ? inputPaths : []) {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("TABLE_FORMAT_INPUT_INVALID");
    const resolved = fs.realpathSync(raw);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("TABLE_FORMAT_INPUT_MUST_BE_FILE");
    if (!isWordDocumentPath(resolved)) throw new Error("TABLE_FORMAT_DOCX_ONLY");
    if (path.basename(resolved).startsWith("~$")) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    results.push(resolved);
  }
  if (!results.length) throw new Error("NO_TABLE_FORMAT_DOCUMENTS_FOUND");
  return results;
}

function uniquePrintTarget(directory, sourcePath) {
  const extension = path.extname(sourcePath);
  const stem = path.basename(sourcePath, extension);
  let target = path.join(directory, `${stem}-打印版${extension}`);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem}-打印版 (${index})${extension}`);
    index += 1;
  }
  return target;
}

function uniqueLinkRestoreTarget(directory, sourcePath) {
  const extension = path.extname(sourcePath);
  const stem = path.basename(sourcePath, extension);
  let target = path.join(directory, `${stem}-链接恢复${extension}`);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem}-链接恢复 (${index})${extension}`);
    index += 1;
  }
  return target;
}

function uniqueTableFormatTarget(directory, sourcePath) {
  const extension = path.extname(sourcePath);
  const stem = path.basename(sourcePath, extension);
  let target = path.join(directory, `${stem}-表格设置${extension}`);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem}-表格设置 (${index})${extension}`);
    index += 1;
  }
  return target;
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function diagnosticsFromLogLines(logLines, exitCode) {
  return buildRunnerDiagnostics(
    exitCode,
    (logLines || []).filter((item) => item?.stream === "stderr").map((item) => item.text).join("\n"),
  );
}

function firstRunnerDiagnostics(results) {
  return (results || []).find((item) => item?.diagnostics)?.diagnostics || undefined;
}

function appendBoundedRunnerLog(logLines, stream, text) {
  const safeText = redactDiagnosticText(text).slice(0, 1000);
  logLines.push({ stream, text: safeText });
  while (logLines.filter((item) => item.stream === "stderr").length > 20) {
    logLines.splice(logLines.findIndex((item) => item.stream === "stderr"), 1);
  }
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
  return safeText;
}

async function verifyWorkbookArchive(filePath) {
  const verificationCode = [
    "import sys, zipfile",
    "path = sys.argv[1]",
    "with zipfile.ZipFile(path, 'r') as workbook:",
    "    bad = workbook.testzip()",
    "if bad:",
    "    raise SystemExit('CORRUPT_ZIP_MEMBER:' + bad)",
  ].join("\n");
  await execFilePromise(PYTHON_BIN, ["-X", "utf8", "-c", verificationCode, filePath], { timeout: 120000 });
}

function replaceProcessedFile(temporaryPath, finalPath) {
  if (!fs.existsSync(finalPath)) {
    fs.renameSync(temporaryPath, finalPath);
    return;
  }

  const backupPath = path.join(
    path.dirname(finalPath),
    `.${path.basename(finalPath)}.tianyuan-replace-${randomUUID()}`,
  );
  fs.renameSync(finalPath, backupPath);
  try {
    fs.renameSync(temporaryPath, finalPath);
    fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    if (fs.existsSync(backupPath)) fs.renameSync(backupPath, finalPath);
    throw error;
  }
}

function runPythonPrintScript({ scriptPath, workbookPath, onLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-X", "utf8", "-u", scriptPath, workbookPath, "--no-backup"], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        TIANYUAN_DETAIL_PRINT_SCRIPT: PRINT_FORMAT_SCRIPTS.detail,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logLines = [];
    const consume = (line, stream) => {
      const text = String(line || "").trim();
      if (!text) return;
      const safeText = appendBoundedRunnerLog(logLines, stream, text);
      onLine?.(safeText, stream);
    };
    readline.createInterface({ input: child.stdout }).on("line", (line) => consume(line, "stdout"));
    readline.createInterface({ input: child.stderr }).on("line", (line) => consume(line, "stderr"));
    child.on("error", (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      error.diagnostics = buildRunnerDiagnostics(null, error.message);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal: signal || null, logLines });
      } else {
        const error = new Error("PRINT_SCRIPT_FAILED");
        error.exitCode = code;
        error.signal = signal || null;
        error.logLines = logLines;
        error.diagnostics = diagnosticsFromLogLines(logLines, code);
        reject(error);
      }
    });
  });
}

function runPythonTableFormatScript(documentPath, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-X", "utf8", "-u", TABLE_FORMAT_SCRIPT, documentPath], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logLines = [];
    const consume = (line, stream) => {
      const text = String(line || "").trim();
      if (!text) return;
      const safeText = appendBoundedRunnerLog(logLines, stream, text);
      onLine?.(safeText, stream);
    };
    readline.createInterface({ input: child.stdout }).on("line", (line) => consume(line, "stdout"));
    readline.createInterface({ input: child.stderr }).on("line", (line) => consume(line, "stderr"));
    child.on("error", (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      error.diagnostics = buildRunnerDiagnostics(null, error.message);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal: signal || null, logLines });
        return;
      }
      const diagnostic = [...logLines].reverse().find((item) => item.stream === "stderr")?.text || "";
      const error = new Error(`TABLE_FORMAT_SCRIPT_FAILED:${classifyTableFormatFailure(diagnostic)}`);
      error.exitCode = code;
      error.signal = signal || null;
      error.logLines = logLines;
      error.diagnostics = diagnosticsFromLogLines(logLines, code);
      reject(error);
    });
  });
}

function classifyTableFormatFailure(text) {
  const diagnostic = String(text || "").trim();
  if (/No module named ['\"](?:docx|lxml|openpyxl|et_xmlfile)['\"]/.test(diagnostic)) {
    return "TABLE_FORMAT_PYTHON_DEPENDENCY_MISSING";
  }
  return diagnostic || "TABLE_FORMAT_SCRIPT_FAILED";
}

function readTableFormatSummary(logLines = []) {
  for (const item of [...logLines].reverse()) {
    try {
      const parsed = JSON.parse(item.text);
      if (parsed?.event === "saved") return parsed;
    } catch {}
  }
  return {};
}

async function runTableFormat(message, emit) {
  const outputMode = String(message?.outputMode || "");
  const results = [];
  try {
    if (!fs.existsSync(TABLE_FORMAT_SCRIPT)) throw new Error("TABLE_FORMAT_SCRIPT_NOT_FOUND");
    if (!TABLE_FORMAT_OUTPUT_MODES.has(outputMode)) throw new Error("TABLE_FORMAT_OUTPUT_MODE_INVALID");
    const sourceFiles = collectWordDocumentFiles(message.inputPaths);
    const outputDir = outputMode === "new_directory"
      ? validateExportDirectory(message.outputDir)
      : "";
    emit({
      ok: true,
      event: "progress",
      phase: "ready",
      percent: 3,
      current: 0,
      total: sourceFiles.length,
      message: `已发现 ${sourceFiles.length} 个 Word 文档`,
    });

    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourcePath = sourceFiles[index];
      const destinationDirectory = outputMode === "new_directory"
        ? outputDir
        : path.dirname(sourcePath);
      const finalPath = outputMode === "overwrite"
        ? sourcePath
        : uniqueTableFormatTarget(destinationDirectory, sourcePath);
      const temporaryPath = path.join(
        path.dirname(finalPath),
        `.${path.basename(finalPath, path.extname(finalPath))}.tianyuan-${randomUUID()}${path.extname(finalPath)}`,
      );
      const startPercent = 5 + Math.round(index / sourceFiles.length * 90);
      emit({
        ok: true,
        event: "progress",
        phase: "processing",
        percent: startPercent,
        current: index + 1,
        total: sourceFiles.length,
        sourcePath,
        outputPath: finalPath,
        message: `正在设置 ${path.basename(sourcePath)}`,
      });

      fs.copyFileSync(sourcePath, temporaryPath);
      try {
        const scriptResult = await runPythonTableFormatScript(temporaryPath, (text, stream) => {
          let messageText = text;
          try {
            const parsed = JSON.parse(text);
            if (parsed?.event === "repaired") messageText = `已修复 ${parsed.repairedRelationships || 0} 个无效内部关系`;
            if (parsed?.event === "formatted") messageText = `已识别并设置 ${parsed.tableCount || 0} 个表格，清除 ${parsed.clearedShadingCells || 0} 个底纹单元格`;
            if (parsed?.event === "saved") messageText = `已保存 ${parsed.fileName || path.basename(sourcePath)}`;
          } catch {}
          emit({
            ok: true,
            event: "progress",
            phase: "processing",
            percent: Math.min(94, startPercent + 2),
            current: index + 1,
            total: sourceFiles.length,
            sourcePath,
            outputPath: finalPath,
            message: messageText,
            stream,
          });
        });
        await verifyWorkbookArchive(temporaryPath);
        const summary = readTableFormatSummary(scriptResult.logLines);
        replaceProcessedFile(temporaryPath, finalPath);
        results.push({
          ok: true,
          sourcePath,
          outputPath: finalPath,
          tableCount: Number(summary.tableCount || 0),
          repairedRelationships: Number(summary.repairedRelationships || 0),
          cleanedRemarkValues: Number(summary.cleanedRemarkValues || 0),
          clearedShadingCells: Number(summary.clearedShadingCells || 0),
          overwritten: outputMode === "overwrite",
          archiveVerified: true,
        });
        emit({
          ok: true,
          event: "progress",
          phase: "verified",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `已完成并校验 ${path.basename(finalPath)}`,
        });
      } catch (error) {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        results.push({
          ok: false,
          sourcePath,
          outputPath: finalPath,
          reason: error?.message || String(error),
          exitCode: error?.exitCode ?? null,
          diagnostics: error?.diagnostics,
        });
        emit({
          ok: false,
          event: "progress",
          phase: "file_failed",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `${path.basename(sourcePath)} 处理失败`,
        });
      }
    }

    const successCount = results.filter((item) => item.ok).length;
    const finalOk = successCount === results.length;
    emit({
      ok: finalOk,
      event: "complete",
      phase: finalOk ? "completed" : "completed_with_errors",
      percent: 100,
      outputMode,
      outputDir: outputDir || null,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      diagnostics: firstRunnerDiagnostics(results),
      message: finalOk
        ? `全部完成：${successCount} 个 Word 文档已处理并校验`
        : `处理完成：成功 ${successCount} 个，失败 ${results.length - successCount} 个`,
      reason: finalOk ? null : "TABLE_FORMAT_BATCH_PARTIAL_FAILURE",
      security: { credentialsReturned: false },
    });
  } catch (error) {
    emit({
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      outputMode,
      reason: error?.message || String(error),
      results,
      diagnostics: error?.diagnostics || firstRunnerDiagnostics(results),
      security: { credentialsReturned: false },
    });
  }
}

async function runPrintFormat(message, emit) {
  const formatType = String(message?.formatType || "");
  const scriptPath = PRINT_FORMAT_SCRIPTS[formatType];
  const outputMode = String(message?.outputMode || "");
  const results = [];
  try {
    if (!scriptPath || !fs.existsSync(scriptPath)) throw new Error("PRINT_SCRIPT_NOT_FOUND");
    if (!PRINT_OUTPUT_MODES.has(outputMode)) throw new Error("PRINT_OUTPUT_MODE_INVALID");
    const sourceFiles = collectWorkbookFiles(message.inputPaths);
    const outputDir = outputMode === "new_directory"
      ? validateExportDirectory(message.outputDir)
      : "";
    emit({
      ok: true,
      event: "progress",
      phase: "ready",
      percent: 3,
      current: 0,
      total: sourceFiles.length,
      message: `已发现 ${sourceFiles.length} 个工作簿`,
    });

    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourcePath = sourceFiles[index];
      const destinationDirectory = outputMode === "new_directory"
        ? outputDir
        : path.dirname(sourcePath);
      const finalPath = outputMode === "overwrite"
        ? sourcePath
        : uniquePrintTarget(destinationDirectory, sourcePath);
      const temporaryPath = path.join(
        path.dirname(finalPath),
        `.${path.basename(finalPath, path.extname(finalPath))}.tianyuan-${randomUUID()}${path.extname(finalPath)}`,
      );
      const startPercent = 5 + Math.round(index / sourceFiles.length * 90);
      emit({
        ok: true,
        event: "progress",
        phase: "processing",
        percent: startPercent,
        current: index + 1,
        total: sourceFiles.length,
        sourcePath,
        outputPath: finalPath,
        message: `正在处理 ${path.basename(sourcePath)}`,
      });

      fs.copyFileSync(sourcePath, temporaryPath);
      try {
        const scriptResult = await runPythonPrintScript({
          scriptPath,
          workbookPath: temporaryPath,
          onLine: (text, stream) => emit({
            ok: true,
            event: "progress",
            phase: "processing",
            percent: Math.min(94, startPercent + 2),
            current: index + 1,
            total: sourceFiles.length,
            sourcePath,
            outputPath: finalPath,
            message: text,
            stream,
          }),
        });
        await verifyWorkbookArchive(temporaryPath);
        replaceProcessedFile(temporaryPath, finalPath);
        results.push({
          ok: true,
          sourcePath,
          outputPath: finalPath,
          overwritten: outputMode === "overwrite",
          logLines: scriptResult.logLines,
          archiveVerified: true,
        });
        emit({
          ok: true,
          event: "progress",
          phase: "verified",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `已完成并校验 ${path.basename(finalPath)}`,
        });
      } catch (error) {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        results.push({
          ok: false,
          sourcePath,
          outputPath: finalPath,
          reason: error?.message || String(error),
          exitCode: error?.exitCode ?? null,
          logLines: error?.logLines || [],
          diagnostics: error?.diagnostics,
        });
        emit({
          ok: false,
          event: "progress",
          phase: "file_failed",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `${path.basename(sourcePath)} 处理失败`,
        });
      }
    }

    const successCount = results.filter((item) => item.ok).length;
    const finalOk = successCount === results.length;
    emit({
      ok: finalOk,
      event: "complete",
      phase: finalOk ? "completed" : "completed_with_errors",
      percent: 100,
      formatType,
      outputMode,
      outputDir: outputDir || null,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      diagnostics: firstRunnerDiagnostics(results),
      reason: finalOk ? null : "PRINT_BATCH_PARTIAL_FAILURE",
      security: { credentialsReturned: false },
    });
  } catch (error) {
    emit({
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      formatType,
      outputMode,
      reason: error?.message || String(error),
      results,
      diagnostics: error?.diagnostics || firstRunnerDiagnostics(results),
      security: { credentialsReturned: false },
    });
  }
}

function runPythonLinkRestoreScript(workbookPath, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-X", "utf8", "-u", LINK_RESTORE_SCRIPT, workbookPath], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logLines = [];
    const consume = (line, stream) => {
      const text = String(line || "").trim();
      if (!text) return;
      const safeText = appendBoundedRunnerLog(logLines, stream, text);
      onLine?.(safeText, stream);
    };
    readline.createInterface({ input: child.stdout }).on("line", (line) => consume(line, "stdout"));
    readline.createInterface({ input: child.stderr }).on("line", (line) => consume(line, "stderr"));
    child.on("error", (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      error.diagnostics = buildRunnerDiagnostics(null, error.message);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal: signal || null, logLines });
      } else {
        const error = new Error("LINK_RESTORE_SCRIPT_FAILED");
        error.exitCode = code;
        error.signal = signal || null;
        error.logLines = logLines;
        error.diagnostics = diagnosticsFromLogLines(logLines, code);
        reject(error);
      }
    });
  });
}

async function runLinkRestore(message, emit) {
  const outputMode = String(message?.outputMode || "");
  const results = [];
  try {
    if (!fs.existsSync(LINK_RESTORE_SCRIPT)) throw new Error("LINK_RESTORE_SCRIPT_NOT_FOUND");
    if (!PRINT_OUTPUT_MODES.has(outputMode)) throw new Error("LINK_RESTORE_OUTPUT_MODE_INVALID");
    const sourceFiles = collectWorkbookFiles(message.inputPaths);
    const outputDir = outputMode === "new_directory"
      ? validateExportDirectory(message.outputDir)
      : "";
    emit({
      ok: true,
      event: "progress",
      phase: "ready",
      percent: 3,
      current: 0,
      total: sourceFiles.length,
      message: `已发现 ${sourceFiles.length} 个工作簿`,
    });

    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourcePath = sourceFiles[index];
      const destinationDirectory = outputMode === "new_directory"
        ? outputDir
        : path.dirname(sourcePath);
      const finalPath = outputMode === "overwrite"
        ? sourcePath
        : uniqueLinkRestoreTarget(destinationDirectory, sourcePath);
      const tempInput = path.join(
        path.dirname(sourcePath),
        `.${path.basename(sourcePath, path.extname(sourcePath))}.tianyuan-link-${randomUUID()}${path.extname(sourcePath)}`,
      );
      const startPercent = 5 + Math.round(index / sourceFiles.length * 90);
      emit({
        ok: true,
        event: "progress",
        phase: "processing",
        percent: startPercent,
        current: index + 1,
        total: sourceFiles.length,
        sourcePath,
        outputPath: finalPath,
        message: `正在恢复 ${path.basename(sourcePath)}`,
      });

      fs.copyFileSync(sourcePath, tempInput);
      try {
        const scriptResult = await runPythonLinkRestoreScript(tempInput, (text, stream) => emit({
          ok: true,
          event: "progress",
          phase: "processing",
          percent: Math.min(94, startPercent + 2),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: text,
          stream,
        }));
        const generatedPath = path.join(
          path.dirname(tempInput),
          `${path.basename(tempInput, path.extname(tempInput))}_链接恢复${path.extname(tempInput)}`,
        );
        if (!fs.existsSync(generatedPath)) throw new Error("LINK_RESTORE_OUTPUT_NOT_FOUND");
        const reportTempPath = path.join(
          path.dirname(tempInput),
          `${path.basename(tempInput, path.extname(tempInput))}_链接恢复对比报告.xlsx`,
        );
        let reportFinalPath = path.join(
          destinationDirectory,
          `${path.basename(sourcePath, path.extname(sourcePath))}_链接恢复对比报告.xlsx`,
        );
        const reportStem = path.basename(reportFinalPath, ".xlsx");
        let reportIndex = 2;
        while (fs.existsSync(reportFinalPath)) {
          reportFinalPath = path.join(destinationDirectory, `${reportStem} (${reportIndex++}).xlsx`);
        }
        fs.renameSync(generatedPath, tempInput);
        await verifyWorkbookArchive(tempInput);
        if (fs.existsSync(reportTempPath)) {
          fs.renameSync(reportTempPath, reportFinalPath);
        }
        replaceProcessedFile(tempInput, finalPath);
        results.push({
          ok: true,
          sourcePath,
          outputPath: finalPath,
          reportPath: fs.existsSync(reportFinalPath) ? reportFinalPath : null,
          overwritten: outputMode === "overwrite",
          logLines: scriptResult.logLines,
          archiveVerified: true,
        });
        emit({
          ok: true,
          event: "progress",
          phase: "verified",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `已完成并校验 ${path.basename(finalPath)}`,
        });
      } catch (error) {
        for (const candidate of [
          tempInput,
          path.join(path.dirname(tempInput), `${path.basename(tempInput, path.extname(tempInput))}_链接恢复.xlsx`),
          path.join(path.dirname(tempInput), `${path.basename(tempInput, path.extname(tempInput))}_链接恢复对比报告.xlsx`),
        ]) {
          if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
        }
        results.push({
          ok: false,
          sourcePath,
          outputPath: finalPath,
          reason: error?.message || String(error),
          exitCode: error?.exitCode ?? null,
          logLines: error?.logLines || [],
          diagnostics: error?.diagnostics,
        });
        emit({
          ok: false,
          event: "progress",
          phase: "file_failed",
          percent: 5 + Math.round((index + 1) / sourceFiles.length * 90),
          current: index + 1,
          total: sourceFiles.length,
          sourcePath,
          outputPath: finalPath,
          message: `${path.basename(sourcePath)} 恢复失败`,
        });
      }
    }

    const successCount = results.filter((item) => item.ok).length;
    const finalOk = successCount === results.length;
    emit({
      ok: finalOk,
      event: "complete",
      phase: finalOk ? "completed" : "completed_with_errors",
      percent: 100,
      action: "batch_link_restore",
      outputMode,
      outputDir: outputDir || null,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      diagnostics: firstRunnerDiagnostics(results),
      reason: finalOk ? null : "LINK_RESTORE_BATCH_PARTIAL_FAILURE",
      security: { credentialsReturned: false },
    });
  } catch (error) {
    emit({
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      action: "batch_link_restore",
      outputMode,
      reason: error?.message || String(error),
      results,
      diagnostics: error?.diagnostics || firstRunnerDiagnostics(results),
      security: { credentialsReturned: false },
    });
  }
}

function fetchLandPublicityJson(url) {
  // 兼容旧调用点：严格校验后只返回 payload；错误带 .errorCode/.diagnostics。
  return landPublicityHttp.fetchLandPublicityJson(url, { stage: "REGION" })
    .then((result) => result.payload);
}

function normalizeLandPublicityRegionNode(node, depth = 0) {
  if (!node || typeof node !== "object") return null;
  const code = String(node.districtCode || "").trim();
  const name = String(node.districtName || "").trim();
  if (!code || !name || depth > 3) return null;
  const children = Array.isArray(node.children)
    ? node.children.map((child) => normalizeLandPublicityRegionNode(child, depth + 1)).filter(Boolean)
    : [];
  return { code, name, children };
}

async function listLandPublicityRegions() {
  const urls = [
    "https://www.zjzrzyjy.com/trade/uniportal/index/districtList",
    "https://www.zjzrzyjy.com/trade/uniread/index/districtList",
    "https://www.zjzrzyjy.com/trade/view/preApply/preAnnouncement/districtList",
  ];
  let lastReason = "LAND_REGION_CATALOG_UNAVAILABLE";
  let lastDiagnostics = null;
  for (const url of urls) {
    try {
      const { payload, diagnostics } = await landPublicityHttp.fetchLandPublicityJson(url, { stage: "REGION" });
      landPublicityHttp.validateLandRegionCatalog(payload);
      const regions = payload.data.map((node) => normalizeLandPublicityRegionNode(node)).filter(Boolean);
      if (regions.length) {
        return {
          ok: true,
          action: "list_land_publicity_regions",
          regions,
          source: url,
          diagnostics,
          security: { credentialsReturned: false },
        };
      }
      lastReason = "LAND_REGION_CATALOG_EMPTY";
      lastDiagnostics = diagnostics;
    } catch (error) {
      lastReason = error?.errorCode || error?.message || String(error);
      lastDiagnostics = error?.diagnostics || lastDiagnostics;
    }
  }
  return {
    ok: false,
    action: "list_land_publicity_regions",
    reason: lastReason,
    diagnostics: lastDiagnostics,
    regions: [],
    security: { credentialsReturned: false },
  };
}

function normalizeLandPublicityRequest(input) {
  const request = input && typeof input === "object" ? input : {};
  let outputDirectory;
  try {
    outputDirectory = validateExportDirectory(request.outputDirectory);
  } catch {
    throw new Error("LAND_OUTPUT_DIRECTORY_INVALID");
  }
  const arrays = ["tradeMethods", "tradeStages", "landUses"];
  const normalized = {
    tradeForm: String(request.tradeForm || "").trim().slice(0, 40),
    district: String(request.district || "").trim().slice(0, 100),
    county: String(request.county || "").trim().slice(0, 100),
    location: String(request.location || "").trim().slice(0, 160),
    startDate: String(request.startDate || "").trim().slice(0, 20),
    endDate: String(request.endDate || "").trim().slice(0, 20),
    startYear: String(request.startYear || "").trim().slice(0, 4),
    quotePreset: String(request.quotePreset || "all").trim().slice(0, 30),
    quoteStartDate: String(request.quoteStartDate || "").trim().slice(0, 20),
    quoteEndDate: String(request.quoteEndDate || "").trim().slice(0, 20),
    areaUnit: String(request.areaUnit || "sqm").trim().slice(0, 8),
    districtExact: request.districtExact === true,
    provinceWide: request.provinceWide === true,
    generateMap: request.generateMap === true,
    historyPath: String(request.historyPath || "").trim(),
    historyRefresh: request.historyRefresh !== false,
    outputDirectory,
  };
  if (normalized.historyPath) normalized.historyPath = landHistoryPathReadback(normalized.historyPath);
  for (const field of arrays) {
    if (request[field] !== undefined && !Array.isArray(request[field])) throw new Error(`LAND_${field.toUpperCase()}_MUST_BE_ARRAY`);
    normalized[field] = Array.isArray(request[field])
      ? request[field].map((value) => String(value || "").trim().slice(0, 40)).filter(Boolean).slice(0, 20)
      : [];
  }
  for (const field of ["startPriceMin", "startPriceMax", "areaMin", "areaMax"]) {
    const value = request[field];
    if (value === "" || value === null || value === undefined) normalized[field] = "";
    else {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1e12) throw new Error(`LAND_${field.toUpperCase()}_INVALID`);
      normalized[field] = number;
    }
  }
  const maxPages = Number(request.maxPages || 200);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error("LAND_MAX_PAGES_INVALID");
  normalized.maxPages = maxPages;
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > 128 * 1024) throw new Error("LAND_REQUEST_TOO_LARGE");
  return normalized;
}

function landOutputPathReadback(value, outputDirectory) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("LAND_OUTPUT_PATH_INVALID");
  const resolved = fs.realpathSync(raw);
  const root = path.resolve(outputDirectory);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("LAND_OUTPUT_OUTSIDE_DIRECTORY");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("LAND_OUTPUT_READBACK_FAILED");
  return resolved;
}

function landOpenPathReadback(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("LAND_OPEN_PATH_INVALID");
  const resolved = fs.realpathSync(raw);
  const extension = path.extname(resolved).toLowerCase();
  if (![".html", ".xlsx", ".json", ".js"].includes(extension)) throw new Error("LAND_OPEN_PATH_TYPE_NOT_ALLOWED");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("LAND_OPEN_PATH_NOT_READABLE");
  return resolved;
}

function htmlResultForCurrentBrowser(resolved, action, message) {
  if (!/\.html?$/i.test(resolved)) return null;
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("RESULT_HTML_NOT_READABLE");
  if (message.openInCurrentBrowserTab !== true) {
    return {
      ok: false, opened: false, action, errorCode: "RESULT_FRONTEND_UPDATE_REQUIRED",
      reason: "结果页需要新版扩展打开。请在扩展管理中加载安装目录下的 extension 文件夹；已加载该目录时请点击重新加载。",
      security: { credentialsReturned: false },
    };
  }
  return {
    ok: true,
    opened: false,
    action,
    path: resolved,
    fileUrl: pathToFileURL(resolved).href,
    browserTab: true,
    security: { credentialsReturned: false },
  };
}

function runLandPublicity(message, emit) {
  return new Promise((resolve) => {
    let request;
    try {
      if (!fs.existsSync(LAND_PUBLICITY_SCRIPT)) throw new Error("LAND_PUBLICITY_SCRIPT_NOT_FOUND");
      request = normalizeLandPublicityRequest(message?.request);
    } catch (error) {
      const payload = {
        ok: false,
        event: "complete",
        phase: "failed",
        percent: 0,
        action: "run_land_publicity",
        reason: error?.message || String(error),
        security: { credentialsReturned: false },
      };
      emit(payload);
      resolve(payload);
      return;
    }
    let finalPayload = null;
    const stderrLines = [];
    let settled = false;
    const complete = (payload) => {
      if (settled) return;
      try {
        const outputPaths = [payload.excelPath, payload.htmlPath, payload.coordsPath, payload.pointsJsPath, payload.mapPath, payload.historyPath]
          .filter(Boolean)
          .map((value) => landOutputPathReadback(value, request.outputDirectory));
        const result = {
          ...payload,
          event: "complete",
          action: "run_land_publicity",
          phase: payload.ok ? "completed" : "failed",
          percent: payload.ok ? 100 : Number(payload.percent || 0),
          ...(payload.ok ? {} : {
            diagnostics: payload.diagnostics || buildRunnerDiagnostics(payload.exitCode, stderrLines.join("\n")),
          }),
          outputPaths,
          security: { credentialsReturned: false },
        };
        settled = true;
        emit(result);
        resolve(result);
      } catch (error) {
        settled = true;
        const result = {
          ok: false,
          event: "complete",
          action: "run_land_publicity",
          phase: "failed",
          percent: 0,
          reason: error?.message || String(error),
          security: { credentialsReturned: false },
        };
        emit(result);
        resolve(result);
      }
    };
    const args = [LAND_PUBLICITY_SCRIPT, "--request-json", JSON.stringify(request)];
    const launch = processLauncher.commandLaunchSpec(PYTHON_BIN, ["-X", "utf8", "-u", ...args]);
    const child = spawn(launch.command, launch.args, {
      cwd: path.dirname(LAND_PUBLICITY_SCRIPT),
      env: { ...process.env, ...launch.env, PYTHONUNBUFFERED: "1", TIANYUAN_MAP_CONFIG_PATH: MAP_CONFIG_PATH },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const consume = (line) => {
      const text = String(line || "").trim();
      if (text.startsWith("TY_LAND_PROGRESS:")) {
        try {
          emit({ ok: true, event: "progress", action: "run_land_publicity", ...JSON.parse(text.slice("TY_LAND_PROGRESS:".length)), security: { credentialsReturned: false } });
        } catch {
          // Ignore malformed progress lines; final result remains authoritative.
        }
      } else if (text.startsWith("TY_LAND_RESULT:")) {
        try {
          finalPayload = JSON.parse(text.slice("TY_LAND_RESULT:".length));
        } catch {
          finalPayload = { ok: false, reason: "LAND_RESULT_INVALID" };
        }
      }
    };
    readline.createInterface({ input: child.stdout }).on("line", consume);
    readline.createInterface({ input: child.stderr }).on("line", (line) => appendStderrTail(stderrLines, line));
    child.on("error", (error) => complete({
      ok: false,
      reason: error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : error?.message || String(error),
      diagnostics: buildRunnerDiagnostics(null, error?.message || String(error)),
    }));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (!finalPayload) {
        complete({ ok: false, reason: code === 0 ? "LAND_RESULT_MISSING" : "LAND_RUNNER_FAILED", exitCode: code, signal: signal || null });
        return;
      }
      if (code !== 0 && finalPayload.ok) {
        complete({ ok: false, reason: "LAND_RUNNER_FAILED", exitCode: code, signal: signal || null });
        return;
      }
      if (!finalPayload.ok) {
        complete({ ...finalPayload, exitCode: code, signal: signal || null });
        return;
      }
      try {
        complete({ ...finalPayload, exitCode: code, signal: signal || null });
      } catch (error) {
        complete({ ok: false, reason: error?.message || String(error), exitCode: code, signal: signal || null });
      }
    });
  });
}

function runAlibabaAuction(message, emit) {
  return alibabaAuction.scrape(message?.request || {}, (payload) => {
    emit({
      ok: true,
      event: "progress",
      action: "run_alibaba_auction",
      ...payload,
      security: { credentialsReturned: false },
    });
  }).then((result) => {
    const payload = {
      ...result,
      event: "complete",
      action: "run_alibaba_auction",
      phase: result.ok ? "completed" : "failed",
      percent: result.ok ? 100 : Number(result.percent || 0),
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  }).catch((error) => {
    const payload = {
      ok: false,
      event: "complete",
      action: "run_alibaba_auction",
      phase: "failed",
      errorCode: error?.message || "ALIBABA_AUCTION_FAILED",
      reason: error?.message || String(error),
      results: [],
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  });
}

function runAnjukeProperty(message, emit) {
  return new Promise((resolve) => {
    let request;
    try {
      if (!fs.existsSync(ANJUKE_PROPERTY_SCRIPT)) throw new Error("ANJUKE_SCRIPT_NOT_FOUND");
      request = anjukeProperty.normalizeRequest(message?.request);
    } catch (error) {
      const payload = {
        ok: false,
        event: "complete",
        action: "run_anjuke_property",
        phase: "failed",
        percent: 0,
        reason: anjukeProperty.safeError(error),
        security: anjukeProperty.security(),
      };
      emit(payload);
      resolve(payload);
      return;
    }
    let finalPayload = null;
    const stderrLines = [];
    let settled = false;
    const complete = (payload, exitCode = null, signal = null) => {
      if (settled) return;
      try {
        const processFailed = exitCode !== null && exitCode !== 0;
        const outputPaths = payload.ok && !processFailed
          ? [payload.csvPath, payload.jsonPath, payload.excelPath, payload.resultHtmlPath, payload.mapPath]
            .filter(Boolean)
            .map((value) => anjukeProperty.validateOutputPath(value, request.outputDirectory))
          : [];
        const result = {
          ...payload,
          ok: Boolean(payload.ok) && !processFailed,
          event: "complete",
          action: "run_anjuke_property",
          phase: payload.ok && !processFailed ? "completed" : "failed",
          percent: payload.ok && !processFailed ? 100 : Number(payload.percent || 0),
          reason: processFailed && payload.ok ? "ANJUKE_RUNNER_FAILED" : payload.reason,
          exitCode,
          signal,
          ...(!payload.ok || processFailed
            ? { diagnostics: payload.diagnostics || buildRunnerDiagnostics(exitCode, stderrLines.join("\n")) }
            : {}),
          outputPaths,
          security: anjukeProperty.security(),
        };
        settled = true;
        emit(result);
        resolve(result);
      } catch (error) {
        settled = true;
        const result = {
          ok: false,
          event: "complete",
          action: "run_anjuke_property",
          phase: "failed",
          percent: 0,
          reason: anjukeProperty.safeError(error),
          security: anjukeProperty.security(),
        };
        emit(result);
        resolve(result);
      }
    };
    let mapAssetsDirectory = "";
    try {
      mapAssetsDirectory = typeof anjukeProperty.mapAssetsDir === "function" ? anjukeProperty.mapAssetsDir() : "";
    } catch (error) {
      // 本机目录里的 native_host.js 与 anjuke-property.js 版本可能错位（热补丁部署）；
      // 地图资产缺失只会让地图降级，绝不能让整个抓取无响应。
      mapAssetsDirectory = "";
    }
    const runnerRequest = mapAssetsDirectory ? { ...request, mapAssetsDir: mapAssetsDirectory } : { ...request };
    // 请求里带整页 HTML（多候选可达数 MB），超出 macOS 约 1MB 的 execve 参数上限（E2BIG），
    // 必须经临时文件传给 Python，不能拼进 argv。
    const requestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anjuke-request-"));
    const requestFile = path.join(requestDirectory, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(runnerRequest));
    const args = [ANJUKE_PROPERTY_SCRIPT, "--request-file", requestFile];
    const launch = processLauncher.commandLaunchSpec(PYTHON_BIN, ["-X", "utf8", "-u", ...args]);
    const child = spawn(launch.command, launch.args, {
      cwd: path.dirname(ANJUKE_PROPERTY_SCRIPT),
      env: { ...process.env, ...launch.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const consume = (line) => {
      const text = String(line || "").trim();
      if (text.startsWith("TY_ANJUKE_PROGRESS:")) {
        try {
          emit({ ok: true, event: "progress", action: "run_anjuke_property", ...JSON.parse(text.slice("TY_ANJUKE_PROGRESS:".length)), security: anjukeProperty.security() });
        } catch {
          // Ignore malformed progress; the final result remains authoritative.
        }
      } else if (text.startsWith("TY_ANJUKE_RESULT:")) {
        try {
          finalPayload = JSON.parse(text.slice("TY_ANJUKE_RESULT:".length));
        } catch {
          finalPayload = { ok: false, reason: "ANJUKE_RESULT_INVALID" };
        }
      }
    };
    readline.createInterface({ input: child.stdout }).on("line", consume);
    readline.createInterface({ input: child.stderr }).on("line", (line) => appendStderrTail(stderrLines, line));
    child.on("error", (error) => complete({
      ok: false,
      reason: error?.code === "ENOENT" ? "PYTHON_NOT_FOUND" : anjukeProperty.safeError(error),
      diagnostics: buildRunnerDiagnostics(null, error?.message || String(error)),
    }));
    child.on("close", (code, signal) => {
      fs.rmSync(requestDirectory, { recursive: true, force: true });
      if (settled) return;
      if (!finalPayload) {
        complete({ ok: false, reason: code === 0 ? "ANJUKE_RESULT_MISSING" : "ANJUKE_RUNNER_FAILED" }, code, signal || null);
        return;
      }
      complete(finalPayload, code, signal || null);
    });
  });
}

function openAnjukePropertySource(message) {
  let request;
  try {
    request = anjukeProperty.normalizeRequest({
      listUrls: [message?.url],
      outputDirectory: processLauncher.runtimeDirectory(),
    });
  } catch (error) {
    return Promise.reject(error);
  }
  const launch = processLauncher.commandLaunchSpec(PYTHON_BIN, [
    "-X", "utf8", "-u",
    ANJUKE_PROPERTY_SCRIPT,
    "--open-only",
    "--url",
    request.listUrls[0],
    "--user-data-dir",
    request.userDataDir,
  ]);
  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, {
      cwd: path.dirname(ANJUKE_PROPERTY_SCRIPT),
      env: { ...process.env, ...launch.env, PYTHONUNBUFFERED: "1" },
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    child.once("error", (error) => resolve({ ok: false, action: "open_anjuke_property_source", reason: anjukeProperty.safeError(error), security: anjukeProperty.security() }));
    child.unref();
    resolve({ ok: true, action: "open_anjuke_property_source", url: request.listUrls[0], message: "已在安居客受控浏览器中打开页面；关闭该窗口后再开始抓取。", security: anjukeProperty.security() });
  });
}

function validateExportDirectory(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) {
    throw new Error("EXPORT_DIRECTORY_INVALID");
  }
  const resolved = fs.realpathSync(raw);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("EXPORT_DIRECTORY_NOT_DIRECTORY");
  return resolved;
}

function parseCompanyIds(values) {
  const ids = Array.isArray(values) ? values : [];
  return [...new Set(ids.map((value) => String(value || "").trim()).filter(Boolean))].map((value) => {
    if (!/^\d+$/.test(value)) throw new Error("companyIds_INVALID");
    return value;
  });
}

function exportProgressFromLine(line, state) {
  const text = String(line || "").trim();
  if (!text) return state.percent;
  if (text.includes("[mcp] connecting")) return Math.max(state.percent, 8);
  if (text.includes("loading project contexts")) return Math.max(state.percent, 14);
  if (text.includes("project loaded")) return Math.max(state.percent, 20);
  if (text.includes("loading company tree")) return Math.max(state.percent, 24);
  const companiesMatch = text.match(/\[export\] companies=(\d+)/);
  if (companiesMatch) {
    state.totalCompanies = Number(companiesMatch[1]) || state.totalCompanies;
    return Math.max(state.percent, 30);
  }
  if (/^\[\d+\].+(?:detail|declare) exporting\.\.\.$/.test(text)) {
    state.currentCompany += 1;
    const total = Math.max(state.totalCompanies, state.currentCompany, 1);
    return Math.max(state.percent, 30 + Math.round((state.currentCompany - 1) / total * 55));
  }
  if (text.includes("] writing ")) {
    const total = Math.max(state.totalCompanies, state.currentCompany, 1);
    return Math.max(state.percent, 30 + Math.round(state.currentCompany / total * 45));
  }
  if (text.includes("] wrote ")) {
    const total = Math.max(state.totalCompanies, state.currentCompany, 1);
    return Math.max(state.percent, 30 + Math.round(state.currentCompany / total * 60));
  }
  if (text.includes("导出完成")) return 98;
  return state.percent;
}

function cliExportFailure(logLines, { cliMode = false } = {}) {
  const text = logLines.map((item) => String(item?.text || "")).join("\n");
  if (/本地登录凭证已过期|请先运行\s*tycpv login|(?:登录|授权).*(?:过期|失效)/i.test(text)) {
    return {
      reason: "TYCPV_AUTH_REQUIRED",
      userMessage: "CLI 授权已过期或缺失。请进入“连接配置”，点击“授权 CLI”，完成登录后点击“启动/检查”，再重新导出。",
    };
  }
  if (/unauthorized|invalid token|MCP token|VALUATION_MCP_TOKEN|MCP_HTTP_401|HTTP\s+401/i.test(text)) {
    return {
      reason: cliMode ? "TYCPV_AUTH_REQUIRED" : "MCP_TOKEN_REQUIRED",
      userMessage: cliMode
        ? "天源 CLI 授权凭证已失效。请在“连接配置”中重新授权 CLI，再重新导出。"
        : "MCP token 未配置或已失效。请在“连接配置”中由使用者本人重新配置 MCP token，再重新导出。",
    };
  }
  if (/forbidden|权限不足|无权访问/i.test(text)) {
    return {
      reason: "TYCPV_PERMISSION_DENIED",
      userMessage: "当前 CLI 账号没有导出权限。请确认登录账号拥有该项目的导出权限后再试。",
    };
  }
  return {
    reason: "TYCPV_EXPORT_FAILED",
    userMessage: "",
  };
}

class NativeDetailTableExportApi {
  constructor(onRequest) {
    this.onRequest = onRequest;
  }

  async request(method, requestPath, options = {}) {
    this.onRequest?.(method, requestPath);
    const result = await callTool("request_detail_table_export_api", {
      method,
      path: requestPath,
      ...(options.params ? { params: options.params } : {}),
      ...(options.body ? { body: options.body } : {}),
    });
    if (result?.success !== true) {
      throw new Error(`MCP_EXPORT_API_FAILED:${result?.error || "unknown error"}`);
    }
    return result.data;
  }

  async get(requestPath, params) {
    return await this.request("GET", requestPath, { params });
  }

  async post(requestPath, body) {
    return await this.request("POST", requestPath, { body });
  }
}

async function runDirectCliExport(message, emit) {
  const exportConfig = CLI_EXPORT_COMMANDS[String(message?.exportType || "")];
  if (!exportConfig) throw new Error("EXPORT_TYPE_NOT_ALLOWED");
  const projectId = String(parseNumericId(message.projectId, "projectId"));
  const companyIds = parseCompanyIds(message.companyIds);
  if (!companyIds.length) throw new Error("companyIds_REQUIRED");
  const outDir = validateExportDirectory(message.outDir);
  const type = message.exportType === "asset_declare_table" ? "declare" : "detail";
  let requestCount = 0;

  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };
  const captureEngineLog = (stream, args) => {
    const text = args.map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }).join(" ").trim();
    if (!text) return;
    emit({
      ok: true,
      event: "progress",
      phase: "running",
      percent: Math.min(94, 10 + requestCount * 3),
      message: `导出引擎：${text}`,
      stream,
      outDir,
    });
  };
  console.log = (...args) => captureEngineLog("stdout", args);
  console.error = (...args) => captureEngineLog("stderr", args);
  console.warn = (...args) => captureEngineLog("stderr", args);
  console.info = (...args) => captureEngineLog("stdout", args);
  console.debug = (...args) => captureEngineLog("stdout", args);

  try {
    const engine = await loadDirectCliExportEngine();

    emit({
      ok: true,
      event: "progress",
      phase: "starting",
      percent: 5,
      message: `准备导出${exportConfig.label}`,
      outDir,
    });
    await ensureInitialized();
    emit({
      ok: true,
      event: "progress",
      phase: "running",
      percent: 10,
      message: "已连接 MCP，正在读取导出数据",
      outDir,
    });

    const api = new NativeDetailTableExportApi((method, requestPath) => {
      requestCount += 1;
      const percent = Math.min(94, 10 + requestCount * 3);
      emit({
        ok: true,
        event: "progress",
        phase: "running",
        percent,
        message: `正在读取导出数据：${method} ${requestPath}`,
        outDir,
      });
    });
    const exporter = new engine.Exporter(api, {
      projectId: Number(projectId),
      companyIds: companyIds.map(Number),
      types: [type],
      outDir,
      limit: 5000,
      templatePaths: {
        detail: engine.detailTemplatePath,
        declare: engine.declareTemplatePath,
      },
      workspaceRoot: engine.root,
    });
    const outputFiles = await exporter.run();
    emit({
      ok: true,
      event: "progress",
      phase: "completed",
      percent: 100,
      message: `导出完成，共生成 ${outputFiles.length} 个文件`,
      outDir,
    });
    return {
      ok: true,
      event: "complete",
      phase: "completed",
      percent: 100,
      exportType: message.exportType,
      label: exportConfig.label,
      projectId,
      companyIds,
      outDir,
      outputFiles,
      security: { credentialsReturned: false, tokenUsed: true },
    };
  } finally {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  }
}

function runCliExport(message, emit) {
  const preferCli = message?.preferCli === true;
  if (!preferCli && getToken() && directCliExportEnginePaths()) {
    return runDirectCliExport(message, emit).catch((error) => ({
      ...(() => {
        const failure = cliExportFailure([{ text: error?.message || String(error) }]);
        return { reason: failure.reason, userMessage: failure.userMessage };
      })(),
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      exportType: message?.exportType || null,
      security: { credentialsReturned: false, tokenUsed: true },
    })).then((payload) => {
      emit(payload);
      return payload;
    });
  }

  return new Promise((resolve) => {
  let exportConfig;
  try {
    exportConfig = CLI_EXPORT_COMMANDS[String(message?.exportType || "")];
    if (!exportConfig) throw new Error("EXPORT_TYPE_NOT_ALLOWED");
    const projectId = String(parseNumericId(message.projectId, "projectId"));
    const companyIds = parseCompanyIds(message.companyIds);
    if (!companyIds.length) throw new Error("companyIds_REQUIRED");
    const outDir = validateExportDirectory(message.outDir);
    const args = [
      exportConfig.command,
      "--project-id",
      projectId,
      "--company-ids",
      companyIds.join(","),
      "--out-dir",
      outDir,
    ];
    const progressState = {
      percent: 3,
      currentCompany: 0,
      totalCompanies: companyIds.length,
    };
    const outputFiles = new Set();
    const logLines = [];
    let completed = false;

    function complete(payload) {
      if (completed) return;
      completed = true;
      emit(payload);
      resolve(payload);
    }

    emit({
      ok: true,
      event: "progress",
      phase: "starting",
      percent: progressState.percent,
      message: `准备导出${exportConfig.label}`,
      outDir,
    });

    const launch = processLauncher.commandLaunchSpec(CLI_BIN, args);
    const child = spawn(launch.command, launch.args, {
      cwd: outDir,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function consumeLine(line, stream) {
      const text = String(line || "").trim();
      if (!text) return;
      logLines.push({ stream, text });
      const wroteMatch = text.match(/\] wrote (.+\.(?:xlsx|xlsm))$/i);
      if (wroteMatch) outputFiles.add(wroteMatch[1]);
      if (/^\s*(?:\/|[A-Za-z]:[\\/]).+\.(?:xlsx|xlsm)$/i.test(line)) outputFiles.add(text);
      progressState.percent = exportProgressFromLine(text, progressState);
      emit({
        ok: true,
        event: "progress",
        phase: "running",
        percent: progressState.percent,
        currentCompany: progressState.currentCompany,
        totalCompanies: progressState.totalCompanies,
        message: text,
        stream,
      });
    }

    readline.createInterface({ input: child.stdout }).on("line", (line) => consumeLine(line, "stdout"));
    readline.createInterface({ input: child.stderr }).on("line", (line) => consumeLine(line, "stderr"));

    child.on("error", (error) => {
      complete({
        ok: false,
        event: "complete",
        phase: "failed",
        percent: progressState.percent,
        reason: error.code === "ENOENT" ? "TYCPV_NOT_FOUND" : (error?.message || String(error)),
        outputFiles: [...outputFiles],
        outDir,
        security: { credentialsReturned: false },
      });
    });

    child.on("close", (code, signal) => {
      if (completed) return;
      const ok = code === 0;
      const failure = ok ? null : cliExportFailure(logLines, { cliMode: true });
      complete({
        ok,
        event: "complete",
        phase: ok ? "completed" : "failed",
        percent: ok ? 100 : progressState.percent,
        exitCode: code,
        signal: signal || null,
        exportType: message.exportType,
        label: exportConfig.label,
        projectId,
        companyIds,
        outDir,
        outputFiles: [...outputFiles],
        logLines,
        reason: failure?.reason || null,
        userMessage: failure?.userMessage || "",
        security: { credentialsReturned: false },
      });
    });
  } catch (error) {
    const payload = {
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      reason: error?.message || String(error),
      security: { credentialsReturned: false },
    };
    emit(payload);
    resolve(payload);
  }
  });
}

function uniqueWorkflowTarget(directory, sourcePath) {
  const extension = path.extname(sourcePath);
  const stem = path.basename(sourcePath, extension);
  let target = path.join(directory, `${stem}-整理后${extension}`);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(directory, `${stem}-整理后 (${index})${extension}`);
    index += 1;
  }
  return target;
}

function normalizeWorkflowExportFiles(values, outputDirectory) {
  const files = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const candidate = path.isAbsolute(raw) ? raw : path.join(outputDirectory, raw);
    const resolved = fs.realpathSync(candidate);
    if (!isWorkbookPath(resolved) || !fs.statSync(resolved).isFile()) continue;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      files.push(resolved);
    }
  }
  return files;
}

async function processDetailWorkflowFile({ sourcePath, finalPath, restoreFormulas, applyFormat, emit }) {
  const extension = path.extname(sourcePath);
  const stagePath = path.join(
    path.dirname(finalPath),
    `.${path.basename(sourcePath, extension)}.tianyuan-workflow-${randomUUID()}${extension}`,
  );
  const stageResults = [];
  let reportTempPath = null;
  const forward = (stage, message, extra = {}) => emit({
    ok: true,
    event: "progress",
    phase: "workflow_processing",
    sourcePath,
    outputPath: finalPath,
    stage,
    message,
    ...extra,
  });

  fs.copyFileSync(sourcePath, stagePath);
  try {
    if (restoreFormulas) {
      forward("restore_formulas", `正在恢复 ${path.basename(sourcePath)} 的公式`);
      const scriptResult = await runPythonLinkRestoreScript(stagePath, (text, stream) => forward(
        "restore_formulas",
        text,
        { stream },
      ));
      const generatedPath = path.join(
        path.dirname(stagePath),
        `${path.basename(stagePath, extension)}_链接恢复${extension}`,
      );
      if (!fs.existsSync(generatedPath)) throw new Error("LINK_RESTORE_OUTPUT_NOT_FOUND");
      reportTempPath = path.join(
        path.dirname(stagePath),
        `${path.basename(stagePath, extension)}_链接恢复对比报告.xlsx`,
      );
      fs.renameSync(generatedPath, stagePath);
      await verifyWorkbookArchive(stagePath);
      stageResults.push({ stage: "restore_formulas", ok: true, logLines: scriptResult.logLines });
    }

    if (applyFormat) {
      forward("apply_format", `正在设置 ${path.basename(sourcePath)} 的格式`);
      const scriptResult = await runPythonPrintScript({
        scriptPath: PRINT_FORMAT_SCRIPTS.detail,
        workbookPath: stagePath,
        onLine: (text, stream) => forward("apply_format", text, { stream }),
      });
      await verifyWorkbookArchive(stagePath);
      stageResults.push({ stage: "apply_format", ok: true, logLines: scriptResult.logLines });
    }

    await verifyWorkbookArchive(stagePath);
    replaceProcessedFile(stagePath, finalPath);
    let reportPath = null;
    if (reportTempPath && fs.existsSync(reportTempPath)) {
      reportPath = path.join(
        path.dirname(finalPath),
        `${path.basename(finalPath, extension)}_链接恢复对比报告.xlsx`,
      );
      replaceProcessedFile(reportTempPath, reportPath);
    }
    return {
      ok: true,
      sourcePath,
      outputPath: finalPath,
      reportPath,
      stages: stageResults,
      archiveVerified: true,
    };
  } catch (error) {
    for (const candidate of [stagePath, reportTempPath]) {
      if (candidate && fs.existsSync(candidate)) fs.unlinkSync(candidate);
    }
    return {
      ok: false,
      sourcePath,
      outputPath: finalPath,
      stages: stageResults,
      reason: error?.message || String(error),
      exitCode: error?.exitCode ?? null,
      logLines: error?.logLines || [],
    };
  }
}

async function runDetailTableWorkflow(message, emit) {
  const mode = String(message?.mode || "");
  const restoreFormulas = message?.restoreFormulas === true;
  const applyFormat = message?.applyFormat === true;
  const results = [];
  let outputMode = String(message?.outputMode || "overwrite");
  let outputDir = "";
  try {
    if (!["after_export", "manual_files"].includes(mode)) throw new Error("DETAIL_WORKFLOW_MODE_INVALID");
    if (!restoreFormulas && !applyFormat) throw new Error("DETAIL_WORKFLOW_NO_STEPS");
    if (!PRINT_OUTPUT_MODES.has(outputMode)) throw new Error("DETAIL_WORKFLOW_OUTPUT_MODE_INVALID");
    let sourceFiles = [];
    if (mode === "after_export") {
      const exportDirectory = validateExportDirectory(message.outDir);
      const exportPayload = await runCliExport({
        action: "run_cli_export",
        exportType: "asset_detail_table",
        preferCli: message?.preferCli !== false,
        projectId: message.projectId,
        companyIds: message.companyIds,
        outDir: exportDirectory,
      }, (payload) => {
        if (payload?.event === "complete") return;
        emit({ ...payload, stage: "export" });
      });
      if (!exportPayload?.ok) {
        const failed = {
          ok: false,
          event: "complete",
          phase: "failed",
          action: "run_detail_table_workflow",
          stage: "export",
          reason: exportPayload?.reason || "TYCPV_EXPORT_FAILED",
          userMessage: exportPayload?.userMessage || "",
          export: exportPayload,
          results,
          security: { credentialsReturned: false },
        };
        emit(failed);
        return failed;
      }
      sourceFiles = normalizeWorkflowExportFiles(exportPayload.outputFiles, exportDirectory);
      outputMode = "overwrite";
      if (!sourceFiles.length) throw new Error("EXPORT_OUTPUT_FILES_NOT_FOUND");
    } else {
      sourceFiles = collectWorkbookFiles(message.inputPaths);
      outputDir = outputMode === "new_directory" ? validateExportDirectory(message.outputDir) : "";
    }

    emit({
      ok: true,
      event: "progress",
      phase: "workflow_ready",
      stage: mode === "after_export" ? "export_verified" : "input_verified",
      percent: mode === "after_export" ? 35 : 5,
      total: sourceFiles.length,
      message: `已确认 ${sourceFiles.length} 个工作簿，开始整理`,
    });

    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourcePath = sourceFiles[index];
      const destinationDirectory = outputMode === "new_directory" ? outputDir : path.dirname(sourcePath);
      const finalPath = outputMode === "overwrite" ? sourcePath : uniqueWorkflowTarget(destinationDirectory, sourcePath);
      const result = await processDetailWorkflowFile({
        sourcePath,
        finalPath,
        restoreFormulas,
        applyFormat,
        emit: (payload) => emit({
          ...payload,
          current: index + 1,
          total: sourceFiles.length,
          percent: Math.min(99, 35 + Math.round((index + 1) / sourceFiles.length * 64)),
        }),
      });
      results.push(result);
      emit({
        ok: result.ok,
        event: "progress",
        phase: result.ok ? "file_verified" : "file_failed",
        current: index + 1,
        total: sourceFiles.length,
        percent: Math.min(99, 35 + Math.round((index + 1) / sourceFiles.length * 64)),
        sourcePath,
        outputPath: finalPath,
        results,
        message: result.ok ? `已完成并校验 ${path.basename(finalPath)}` : `${path.basename(sourcePath)} 处理失败：${result.reason}`,
      });
    }

    const successCount = results.filter((item) => item.ok).length;
    const payload = {
      ok: successCount === results.length && results.length > 0,
      event: "complete",
      phase: successCount === results.length && results.length > 0 ? "completed" : "completed_with_errors",
      percent: 100,
      action: "run_detail_table_workflow",
      mode,
      outputMode,
      outputDir: outputDir || null,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      reason: successCount === results.length && results.length > 0 ? null : "DETAIL_WORKFLOW_PARTIAL_FAILURE",
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  } catch (error) {
    const payload = {
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      action: "run_detail_table_workflow",
      mode,
      outputMode,
      outputDir: outputDir || null,
      reason: error?.message || String(error),
      results,
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  }
}

async function runDeclarationTableWorkflow(message, emit) {
  const mode = String(message?.mode || "");
  let outputMode = String(message?.outputMode || "overwrite");
  let outputDir = "";
  let sourceFiles = [];
  let exportPayload = null;
  try {
    if (!["after_export", "manual_files"].includes(mode)) throw new Error("DECLARATION_WORKFLOW_MODE_INVALID");
    if (!PRINT_OUTPUT_MODES.has(outputMode)) throw new Error("DECLARATION_WORKFLOW_OUTPUT_MODE_INVALID");

    if (mode === "after_export") {
      const exportDirectory = validateExportDirectory(message.outDir);
      exportPayload = await runCliExport({
        action: "run_cli_export",
        exportType: "asset_declare_table",
        preferCli: message?.preferCli !== false,
        projectId: message.projectId,
        companyIds: message.companyIds,
        outDir: exportDirectory,
      }, (payload) => {
        if (payload?.event === "complete") return;
        emit({ ...payload, action: "run_declaration_table_workflow", stage: "export" });
      });
      if (!exportPayload?.ok) {
        const failed = {
          ok: false,
          event: "complete",
          phase: "failed",
          action: "run_declaration_table_workflow",
          mode,
          stage: "export",
          reason: exportPayload?.reason || "TYCPV_EXPORT_FAILED",
          userMessage: exportPayload?.userMessage || "",
          export: exportPayload,
          security: { credentialsReturned: false },
        };
        emit(failed);
        return failed;
      }
      sourceFiles = normalizeWorkflowExportFiles(exportPayload.outputFiles, exportDirectory);
      outputMode = "overwrite";
      if (!sourceFiles.length) throw new Error("DECLARATION_EXPORT_OUTPUT_FILES_NOT_FOUND");
    } else {
      sourceFiles = collectWorkbookFiles(message.inputPaths);
      outputDir = outputMode === "new_directory" ? validateExportDirectory(message.outputDir) : "";
    }

    emit({
      ok: true,
      event: "progress",
      phase: "workflow_ready",
      action: "run_declaration_table_workflow",
      stage: mode === "after_export" ? "export_verified" : "input_verified",
      percent: mode === "after_export" ? 35 : 5,
      total: sourceFiles.length,
      message: `已确认 ${sourceFiles.length} 个申报表，开始设置打印格式`,
    });

    let formatPayload = null;
    await runPrintFormat({
      action: "run_print_format",
      formatType: "declaration",
      inputPaths: sourceFiles,
      outputMode,
      outputDir,
    }, (payload) => {
      if (payload?.event === "complete") {
        formatPayload = payload;
        return;
      }
      const rawPercent = Math.max(0, Math.min(100, Number(payload?.percent) || 0));
      const base = mode === "after_export" ? 35 : 5;
      const span = mode === "after_export" ? 64 : 94;
      emit({
        ...payload,
        action: "run_declaration_table_workflow",
        stage: "apply_format",
        percent: Math.min(99, base + Math.round(rawPercent / 100 * span)),
      });
    });

    if (!formatPayload) throw new Error("DECLARATION_FORMAT_RESULT_MISSING");
    const results = Array.isArray(formatPayload.results) ? formatPayload.results : [];
    const successCount = results.filter((item) => item.ok).length;
    const ok = formatPayload.ok === true && results.length > 0 && successCount === results.length;
    const payload = {
      ok,
      event: "complete",
      phase: ok ? "completed" : "completed_with_errors",
      percent: 100,
      action: "run_declaration_table_workflow",
      mode,
      outputMode,
      outputDir: outputDir || null,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
      export: exportPayload,
      reason: ok ? null : "DECLARATION_WORKFLOW_PARTIAL_FAILURE",
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  } catch (error) {
    const payload = {
      ok: false,
      event: "complete",
      phase: "failed",
      percent: 0,
      action: "run_declaration_table_workflow",
      mode,
      outputMode,
      outputDir: outputDir || null,
      reason: error?.message || String(error),
      security: { credentialsReturned: false },
    };
    emit(payload);
    return payload;
  }
}

function parseSseOrJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (!dataLines.length) throw new Error("MCP_EMPTY_OR_UNSUPPORTED_RESPONSE");
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function rpc(method, params, { notification = false } = {}) {
  const token = getToken();
  if (!token) throw new Error("VALUATION_MCP_TOKEN_NOT_SET");

  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const payload = notification
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id: nextId++, method, params };

  const response = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const responseSession = response.headers.get("mcp-session-id");
  if (responseSession) sessionId = responseSession;

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 400 && /no valid session/i.test(text)) {
      throw new Error("MCP_SESSION_EXPIRED");
    }
    throw new Error(`MCP_HTTP_${response.status}`);
  }
  if (notification) return null;

  const parsed = parseSseOrJson(text);
  if (parsed?.error) throw new Error(parsed.error.message || parsed.error.code || "MCP_RPC_ERROR");
  return parsed?.result ?? parsed;
}

async function ensureInitialized() {
  if (initialized && sessionId) return;
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: {
      name: "tianyuan-browser-workbench-native-host",
      version: "0.1.0",
    },
  });
  await rpc("notifications/initialized", {}, { notification: true });
  initialized = true;
}

function parseToolResult(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const textItem = content.find((item) => item.type === "text" && item.text);
  if (!textItem) return result;
  const raw = String(textItem.text).trim();
  if (!raw) return result;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function callTool(name, args) {
  try {
    await ensureInitialized();
    const result = await rpc("tools/call", { name, arguments: args || {} });
    return parseToolResult(result);
  } catch (error) {
    if (error?.message !== "MCP_SESSION_EXPIRED") throw error;
    sessionId = null;
    initialized = false;
    await ensureInitialized();
    const result = await rpc("tools/call", { name, arguments: args || {} });
    return parseToolResult(result);
  }
}

function parseNumericId(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${fieldName}_INVALID`);
  return Number(text);
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "list", "records", "rows", "companies", "subjects", "items", "result", "children", "tree"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.values(value).find(Array.isArray) || [];
}

function flattenItems(value, depth = 0) {
  if (depth > 8) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenItems(item, depth + 1));
  }
  if (!value || typeof value !== "object") return [value];

  const nested = [];
  for (const key of ["data", "list", "records", "rows", "companies", "subjects", "items", "result", "children", "tree"]) {
    if (Array.isArray(value[key])) nested.push(...flattenItems(value[key], depth + 1));
  }

  const hasOwnLabel = ["id", "companyId", "companyName", "name", "label", "subjectCode", "subjectName", "code", "text", "title"]
    .some((key) => value[key] !== null && value[key] !== undefined);
  return hasOwnLabel ? [value, ...nested] : nested;
}

function pickString(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function pickSubjectName(object, code) {
  const direct = pickString(object, [
    "subjectName",
    "subject_name",
    "name",
    "label",
    "title",
    "text",
    "sheetName",
    "sheet_name",
    "accountName",
    "account_name",
    "assetSubjectName",
    "asset_subject_name",
  ]);
  if (direct && direct !== code) return direct;

  for (const [key, value] of Object.entries(object || {})) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text || text === code || text.length > 60) continue;
    if (/(Name|name|名称|科目|account|subject)/.test(key) && /[\u4e00-\u9fa5]/.test(text)) {
      return text;
    }
  }
  return direct || "";
}

function isSubjectCode(value) {
  return /^C\d+(?:-\d+)*$/.test(String(value || "").trim());
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isDisplayedSubject(object) {
  const hiddenValue = firstDefined([
    object.hidden,
    object.isHidden,
    object.is_hidden,
    object.hide,
    object.isHide,
    object.is_hide,
    object.hiddenFlag,
    object.hidden_flag,
  ]);
  if (hiddenValue === true || hiddenValue === 1 || hiddenValue === "1" || String(hiddenValue).toLowerCase() === "true") {
    return false;
  }

  const displayValue = firstDefined([
    object.visible ??
    object.isShow ??
    object.is_show ??
    object.show ??
    object.isDisplay ??
    object.is_display ??
    object.display ??
    object.displayed ??
    object.displayFlag ??
    object.display_flag ??
    object.displayStatus ??
    object.display_status ??
    object.showFlag ??
    object.show_flag ??
    object.visibleFlag ??
    object.visible_flag ??
    object.checked ??
    object.isChecked ??
    object.is_checked ??
    object.selected ??
    object.isSelected ??
    object.is_selected,
  ]);

  if (displayValue === undefined || displayValue === null || displayValue === "") return true;
  if (displayValue === false || displayValue === 0 || displayValue === "0") return false;
  const text = String(displayValue).trim().toLowerCase();
  return !["false", "hidden", "hide", "隐藏", "不显示", "未显示", "否", "no", "n", "disabled"].includes(text);
}

function normalizeCompanies(raw) {
  const seen = new Set();
  return flattenItems(raw).map((item, index) => {
    const object = item && typeof item === "object" ? item : { name: item };
    const id = pickString(object, ["companyId", "company_id", "id", "value", "enterpriseId", "enterprise_id", "company_id_str", "subjectId"]);
    const name = pickString(object, ["companyName", "company_name", "name", "label", "title", "text", "enterpriseName", "enterprise_name", "subjectName"]);
    const code = pickString(object, [
      ...COMPANY_HIERARCHY_CODE_KEYS,
      "companyCode",
      "company_code",
      "code",
      "enterpriseCode",
      "enterprise_code",
      "companyNo",
      "company_no",
      "no",
    ]);
    const shortName = pickString(object, ["shortName", "short_name", "companyShortName", "company_short_name", "abbrName", "abbr_name", "abbreviation", "companyAbbr", "company_abbr"]);
    return {
      id: id || name || String(index + 1),
      name: name || id || String(index + 1),
      code,
      shortName,
      raw: object,
    };
  }).filter((item) => {
    const key = `${item.id}|${item.name}`;
    if (!item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSubjects(raw) {
  const seen = new Set();
  return flattenItems(raw).map((item, index) => {
    const object = item && typeof item === "object" ? item : { name: item };
    const code = pickString(object, [
      "subjectCode",
      "subject_code",
      "code",
      "accountCode",
      "account_code",
      "assetSubjectCode",
      "asset_subject_code",
      "value",
    ]);
    if (!isSubjectCode(code)) return null;
    const name = pickSubjectName(object, code);
    const parentCode = pickString(object, ["parentSubjectCode", "parent_subject_code", "parentCode", "parent_code", "pSubjectCode", "pidCode"]);
    const parentName = pickString(object, ["parentSubjectName", "parent_subject_name", "parentName", "parent_name", "pSubjectName"]);
    const path = pickString(object, ["fullPath", "full_path", "path", "subjectPath", "subject_path", "namePath", "name_path"]);
    const visible = isDisplayedSubject(object);
    return {
      code,
      name: name || code || String(index + 1),
      parentCode: isSubjectCode(parentCode) ? parentCode : "",
      parentName,
      path,
      visible,
      raw: object,
    };
  }).filter((item) => {
    if (!item) return false;
    const key = `${item.code}|${item.name}`;
    if ((!item.code && !item.name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function health({ probe = false } = {}) {
  return {
    ok: true,
    service: "appraisal-toolbox-native-host",
    transport: "native_messaging",
    standalone: true,
    probeRequested: probe === true,
    nativeHostName: runtimeConfig.nativeHostName || "com.appraisal.toolbox.helper",
    extensionId: runtimeConfig.toolboxExtensionId || "",
    security: {
      credentialsReturned: false,
    },
  };
}

function applyRuntimeToken(message) {
  if (typeof message?.mcpToken !== "string" || !message.mcpToken.trim()) return;
  const nextToken = message.mcpToken.trim();
  if (nextToken !== runtimeToken) {
    runtimeToken = nextToken;
    sessionId = null;
    initialized = false;
  }
}

async function handle(message) {
  if (!toolboxActionAllowed(message)) return toolboxActionRejected(message);

  const depreciationAction = String(message?.action || "");
  const depreciationNamespace = message?.namespace === "depreciation-capex-forecast"
    || message?.namespace === "depreciation_capex_forecast";
  const depreciationOperation = DEPRECIATION_CAPEX_ACTIONS[depreciationAction]
    || (depreciationAction === "depreciation_capex_forecast" || depreciationAction === "depreciation-capex-forecast"
      ? String(message?.operation || "")
      : "");
  if (depreciationNamespace || depreciationOperation) {
    return await depreciationCapexForecast.handle({
      ...message,
      operation: depreciationOperation || message.operation,
    });
  }

  if (message?.action === "health") {
    return await health({ probe: message.probe === true });
  }
  if (message?.action === "start_connector_bridge") {
    return await startConnectorBridgeAction({ forceRestart: message.forceRestart === true });
  }
  if (message?.action === "check_github_update") {
    return await updateChecker.checkGithubUpdate({
      currentVersion: message.currentVersion,
      currentBuildNumber: message.currentBuildNumber,
      currentRuntimeBuildId: message.currentRuntimeBuildId,
      currentRuntimeBuildKind: message.currentRuntimeBuildKind,
      // 工具箱等独立扩展按请求覆盖更新源与仓库；不传时保持工作台默认行为。
      updateManifestUrls: Array.isArray(message.updateManifestUrls)
        ? message.updateManifestUrls.map((item) => String(item || "").trim()).filter(Boolean)
        : undefined,
      repository: typeof message.repository === "string" && message.repository.trim()
        ? message.repository.trim()
        : undefined,
      platform: process.platform,
      architecture: process.arch,
    });
  }
  if (message?.action === "install_workbench_update") {
    return await workbenchUpdater.install({
      currentVersion: message.currentVersion,
      currentBuildNumber: message.currentBuildNumber,
      currentRuntimeBuildId: message.currentRuntimeBuildId,
      currentRuntimeBuildKind: message.currentRuntimeBuildKind,
    });
  }
  if (message?.action === "test_workbench_update") {
    return await workbenchUpdater.test({
      currentVersion: message.currentVersion,
      currentBuildNumber: message.currentBuildNumber,
      currentRuntimeBuildId: message.currentRuntimeBuildId,
      currentRuntimeBuildKind: message.currentRuntimeBuildKind,
    });
  }
  if (message?.action === "get_workbench_update_status") {
    return workbenchUpdater.getStatus();
  }
  if (message?.action === "cli_login") {
    return await startCliLogin();
  }
  if (message?.action === "cli_login_status") {
    return await getCliLoginStatus(String(message.sessionId || ""));
  }
  if (message?.action === "get_map_config") {
    return mapConfigSummary();
  }
  if (message?.action === "save_map_config") {
    return saveMapConfig(message);
  }
  if (message?.action === "clear_map_config") {
    return clearMapConfig();
  }
  if (message?.action === "select_export_directory") {
    return await chooseExportDirectory(message);
  }
  if (message?.action === "select_print_workbook_files") {
    return await chooseWorkbookFiles();
  }
  if (message?.action === "select_table_format_word_files") {
    return await chooseTableFormatWordFiles();
  }
  if (message?.action === "select_print_workbook_directory") {
    return await chooseWorkbookDirectory();
  }
  if (message?.action === "select_batch_upload_directory") {
    return await chooseBatchUploadDirectory();
  }
  if (message?.action === "list_batch_upload_directory") {
    return listBatchUploadDirectory(message);
  }
  if (message?.action === "select_print_output_directory") {
    return await choosePrintOutputDirectory(message);
  }
  if (message?.action === "open_print_workbook_path") {
    const rawPath = String(message.path || "");
    if (!path.isAbsolute(rawPath) || rawPath.includes("\0")) throw new Error("PRINT_INPUT_INVALID");
    const resolved = fs.realpathSync(rawPath);
    if (!isWorkbookPath(resolved) || !fs.statSync(resolved).isFile()) throw new Error("PRINT_INPUT_INVALID");
    const opened = await platformAdapter.openPath(resolved);
    return { ...opened, action: "open_print_workbook_path", path: resolved, security: { credentialsReturned: false } };
  }
  if (message?.action === "list_land_publicity_regions") {
    return await listLandPublicityRegions();
  }
  if (message?.action === "select_land_publicity_history_directory") {
    return await chooseDirectory("选择浙江土地成交公示历史数据目录");
  }
  if (message?.action === "list_land_publicity_history") {
    return listLandPublicityHistory(message);
  }
  if (message?.action === "load_land_publicity_history") {
    return loadLandPublicityHistory(message);
  }
  if (message?.action === "select_table_format_output_directory") {
    return await chooseTableFormatOutputDirectory();
  }
  if (message?.action === "select_land_publicity_output_directory") {
    return await chooseLandPublicityOutputDirectory();
  }
  if (message?.action === "select_alibaba_auction_output_directory") {
    return await chooseAlibabaAuctionOutputDirectory();
  }
  if (message?.action === "select_alibaba_auction_history_directory") {
    const result = await chooseDirectory("选择阿里司法拍卖历史数据目录");
    return {
      ...result,
      action: "alibaba_auction_history_directory_selected",
      path: selectedDirectoryPath(result),
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "list_alibaba_auction_history") {
    return alibabaAuction.listHistory(message.directory);
  }
  if (message?.action === "load_alibaba_auction_history") {
    return alibabaAuction.loadHistory(message.path);
  }
  if (message?.action === "select_anjuke_property_output_directory") {
    return await chooseAnjukePropertyOutputDirectory();
  }
  if (message?.action === "open_anjuke_property_path") {
    const raw = String(message.path || "").trim();
    if (!raw || !path.isAbsolute(raw) || raw.includes("\0")) throw new Error("ANJUKE_OPEN_PATH_INVALID");
    const resolved = fs.realpathSync(raw);
    const root = path.resolve(String(message.outputDirectory || ""));
    const relative = path.relative(root, resolved);
    if (!root || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("ANJUKE_OPEN_PATH_OUTSIDE_DIRECTORY");
    const stat = fs.statSync(resolved);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("ANJUKE_OPEN_PATH_NOT_READABLE");
    const browserResult = htmlResultForCurrentBrowser(resolved, "open_anjuke_property_path", message);
    if (browserResult) return browserResult;
    if (message.openInCurrentBrowserTab === true) throw new Error("RESULT_HTML_REQUIRED");
    const opened = await platformAdapter.openPath(resolved);
    return { ...opened, action: "open_anjuke_property_path", path: resolved, security: anjukeProperty.security() };
  }
  if (message?.action === "open_alibaba_auction") {
    return await alibabaAuction.openPage(message?.request || {});
  }
  if (message?.action === "open_anjuke_property_source") {
    return await openAnjukePropertySource(message);
  }
  if (message?.action === "enrich_alibaba_auction_detail") {
    const detail = message?.detail && typeof message.detail === "object" ? message.detail : {};
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const enriched = await alibabaAuction.enrichDetailFromAttachmentBuffers(detail, attachments);
    return {
      ok: true,
      action: "enrich_alibaba_auction_detail",
      detail: enriched,
      attachmentCount: Number(enriched?.attachmentCount || 0),
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "write_alibaba_auction_result") {
    const request = alibabaAuction.normalizeRequest(message?.request || {});
    const results = Array.isArray(message?.results) ? message.results : [];
    const candidates = Number.isFinite(Number(message?.candidates)) ? Number(message.candidates) : results.length;
    const skipped = Number.isFinite(Number(message?.skipped)) ? Number(message.skipped) : 0;
    const artifacts = results.length
      ? await alibabaAuction.writeResultArtifacts(results, request, { candidates, skipped })
      : {
        htmlPath: "",
        historyPath: "",
        mapPath: "",
        coordsPath: "",
        pointsJsPath: "",
        locatedCount: 0,
        unlocatedCount: 0,
        geocodeRequested: 0,
        geocodeCacheHits: 0,
        geocodeResolved: 0,
        geocodeFailed: 0,
        geocodeTimedOut: 0,
        geocodeDurationMs: 0,
      };
    return {
      ok: results.length > 0,
      action: "write_alibaba_auction_result",
      ...artifacts,
      candidates,
      skipped,
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "write_alibaba_auction_excel") {
    const request = alibabaAuction.normalizeRequest(message?.request || {});
    const results = Array.isArray(message?.results) ? message.results : [];
    const candidates = Number.isFinite(Number(message?.candidates)) ? Number(message.candidates) : results.length;
    const skipped = Number.isFinite(Number(message?.skipped)) ? Number(message.skipped) : 0;
    try {
      return await alibabaAuction.writeResultExcel(results, request, { candidates, skipped });
    } catch (error) {
      return {
        ok: false,
        action: "write_alibaba_auction_excel",
        errorCode: error?.code || "ALIBABA_EXCEL_EXPORT_FAILED",
        reason: error?.message || "Excel 生成失败，请检查本机助手",
        diagnostics: error?.diagnostics,
        security: { credentialsReturned: false },
      };
    }
  }
  if (message?.action === "open_alibaba_auction_path") {
    const resolved = alibabaAuction.validateResultPath(message.path, message.outputDirectory || alibabaAuction.RESULT_ROOT);
    const browserResult = htmlResultForCurrentBrowser(resolved, "open_alibaba_auction_path", message);
    if (browserResult) return browserResult;
    if (message.openInCurrentBrowserTab === true) throw new Error("RESULT_HTML_REQUIRED");
    const opened = await platformAdapter.openPath(resolved);
    return {
      ...opened,
      action: "open_alibaba_auction_path",
      path: resolved,
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "select_alibaba_lease_output_directory") {
    return await chooseAlibabaLeaseOutputDirectory();
  }
  if (message?.action === "write_alibaba_lease_result") {
    const request = alibabaLease.normalizeRequest(message?.request || {});
    const results = Array.isArray(message?.results) ? message.results : [];
    const candidates = Number.isFinite(Number(message?.candidates)) ? Number(message.candidates) : results.length;
    const skipped = Number.isFinite(Number(message?.skipped)) ? Number(message.skipped) : 0;
    const artifacts = results.length
      ? await alibabaLease.writeResultArtifacts(results, request, { candidates, skipped })
      : {
        htmlPath: "",
        jsonPath: "",
        historyPath: "",
        mapPath: "",
        coordsPath: "",
        pointsJsPath: "",
        locatedCount: 0,
        unlocatedCount: 0,
        mapGeneration: "no_results",
      };
    return {
      ok: results.length > 0,
      action: "write_alibaba_lease_result",
      ...artifacts,
      candidates,
      skipped,
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "write_alibaba_lease_excel") {
    const request = alibabaLease.normalizeRequest(message?.request || {});
    const results = Array.isArray(message?.results) ? message.results : [];
    const candidates = Number.isFinite(Number(message?.candidates)) ? Number(message.candidates) : results.length;
    const skipped = Number.isFinite(Number(message?.skipped)) ? Number(message.skipped) : 0;
    try {
      return await alibabaLease.writeResultExcel(results, request, { candidates, skipped });
    } catch (error) {
      return {
        ok: false,
        action: "write_alibaba_lease_excel",
        errorCode: error?.code || "ALIBABA_LEASE_EXCEL_EXPORT_FAILED",
        reason: error?.message || "Excel 生成失败，请检查本机助手",
        diagnostics: error?.diagnostics,
        security: { credentialsReturned: false },
      };
    }
  }
  if (message?.action === "open_alibaba_lease_path") {
    const resolved = alibabaLease.openResultPath(message.path, message.outputDirectory || alibabaLease.RESULT_ROOT);
    const browserResult = htmlResultForCurrentBrowser(resolved, "open_alibaba_lease_path", message);
    if (browserResult) return browserResult;
    if (message.openInCurrentBrowserTab === true) throw new Error("RESULT_HTML_REQUIRED");
    const opened = await platformAdapter.openPath(resolved);
    return {
      ...opened,
      action: "open_alibaba_lease_path",
      path: resolved,
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "open_land_publicity_path") {
    const resolved = landOpenPathReadback(message.path);
    const browserResult = htmlResultForCurrentBrowser(resolved, "open_land_publicity_path", message);
    if (browserResult) return browserResult;
    if (message.openInCurrentBrowserTab === true) throw new Error("RESULT_HTML_REQUIRED");
    const opened = await platformAdapter.openPath(resolved);
    return { ...opened, action: "open_land_publicity_path", path: resolved, security: { credentialsReturned: false } };
  }
  if (message?.action === "detect_file_archive_apps") {
    return await fileArchive.detect();
  }
  if (message?.action === "list_file_archive_conversations") {
    return fileArchive.listConversations(message.appType === "wecom" ? "wecom" : "wechat");
  }
  if (message?.action === "get_file_archive_conversation_bindings") {
    return fileArchive.getConversationBindings(message.appType === "wecom" ? "wecom" : "wechat");
  }
  if (message?.action === "inspect_file_archive_active_conversation") {
    return await fileArchive.inspectActiveConversation();
  }
  if (message?.action === "select_file_archive_conversation_directory") {
    const appType = message.appType === "wecom" ? "wecom" : "wechat";
    const selected = await chooseManagedOutputDirectory(
      "选择所选会话导出目录的上级目录",
      "微信文件归档",
      "file_archive_conversation_directory_selected",
      "FILE_ARCHIVE_CONVERSATION_OUTPUT_DIRECTORY_CREATE_FAILED",
    );
    const outputDirectory = selected.outputDirectory || selected.path || "";
    if (!selected.ok || !outputDirectory) return selected;
    const conversationIds = Array.isArray(message.conversationIds)
      ? message.conversationIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const saved = fileArchive.saveConversationBindings({
      appType,
      bindings: conversationIds.map((conversationId) => ({ conversationId, outputDirectory })),
    });
    return { ...saved, action: selected.action, path: outputDirectory, outputDirectory, directoryName: selected.directoryName, createdDirectory: selected.createdDirectory, security: { credentialsReturned: false } };
  }
  if (message?.action === "save_file_archive_conversation_bindings") {
    return fileArchive.saveConversationBindings({
      appType: message.appType === "wecom" ? "wecom" : "wechat",
      bindings: Array.isArray(message.bindings) ? message.bindings : [],
    });
  }
  if (message?.action === "select_file_archive_output_directory") {
    return await fileArchive.selectOutputDirectory();
  }
  if (message?.action === "start_file_archive") {
    return await fileArchive.start(message.config || {});
  }
  if (message?.action === "stop_file_archive") {
    return await fileArchive.stop();
  }
  if (message?.action === "pause_file_archive") {
    return await fileArchive.pause(message.paused !== false);
  }
  if (message?.action === "scan_file_archive") {
    return await fileArchive.scan();
  }
  if (message?.action === "get_file_archive_status") {
    return fileArchive.status();
  }
  if (message?.action === "get_project_companies") {
    const projectId = parseNumericId(message.projectId, "projectId");
    const raw = await callTool("get_project_companies", { projectId });
    return {
      ok: true,
      projectId,
      companies: normalizeCompanies(raw),
      rawShape: Array.isArray(raw) ? "array" : typeof raw,
      security: { credentialsReturned: false },
    };
  }
  if (message?.action === "get_asset_subjects") {
    const projectId = parseNumericId(message.projectId, "projectId");
    const companyId = parseNumericId(message.companyId, "companyId");
    const raw = await callTool("get_company_asset_based_approach_subjects", { projectId, companyId });
    return {
      ok: true,
      projectId,
      companyId,
      subjects: normalizeSubjects(raw),
      rawShape: Array.isArray(raw) ? "array" : typeof raw,
      security: { credentialsReturned: false },
    };
  }
  return {
    ok: false,
    reason: "UNKNOWN_ACTION",
    security: { credentialsReturned: false },
  };
}

async function runSelfTest() {
  const platform = platformAdapter.diagnostics();
  const depreciation = depreciationCapexForecast.selfTest();
  const imports = await runPythonSkillImportSmokeTest();
  return {
    ok: fs.existsSync(PYTHON_BIN)
      && fs.existsSync(TABLE_FORMAT_SCRIPT)
      && fs.existsSync(LAND_PUBLICITY_SCRIPT)
      && fs.existsSync(ANJUKE_PROPERTY_SCRIPT)
      && platform.supported
      && depreciation.ok
      && imports.ok,
    service: "appraisal-toolbox-native-host",
    standalone: true,
    platform: process.platform,
    architecture: process.arch,
    platformAdapter: platform,
    pythonAvailable: fs.existsSync(PYTHON_BIN),
    toolboxScriptsAvailable: {
      tableFormat: fs.existsSync(TABLE_FORMAT_SCRIPT),
      landPublicity: fs.existsSync(LAND_PUBLICITY_SCRIPT),
      anjukeProperty: fs.existsSync(ANJUKE_PROPERTY_SCRIPT),
      detailPrint: fs.existsSync(PRINT_FORMAT_SCRIPTS.detail),
      declarationPrint: fs.existsSync(PRINT_FORMAT_SCRIPTS.declaration),
      formulaRestore: fs.existsSync(LINK_RESTORE_SCRIPT),
    },
    pythonSkillImportSmoke: imports,
    depreciationCapexForecast: depreciation,
    security: { credentialsReturned: false },
  };
}

async function runPythonSkillImportSmokeTest() {
  const checks = [
    ["landPublicity", LAND_PUBLICITY_SCRIPT],
    ["anjukeProperty", ANJUKE_PROPERTY_SCRIPT],
    ["tableFormat", TABLE_FORMAT_SCRIPT],
    ["detailPrint", PRINT_FORMAT_SCRIPTS.detail],
    ["declarationPrint", PRINT_FORMAT_SCRIPTS.declaration],
    ["formulaRestore", LINK_RESTORE_SCRIPT],
    ["depreciation", path.join(depreciationCapexForecast.selfTest().skillRoot, "scripts", "workflow.py")],
  ];
  const importCode = String.raw`import importlib.util
import pathlib
import sys

name = sys.argv[1]
script = pathlib.Path(sys.argv[2]).resolve()
script_dir = str(script.parent)
sys.path[:] = [entry for entry in sys.path if str(pathlib.Path(entry or ".").resolve()) != script_dir]
spec = importlib.util.spec_from_file_location("appraisal_smoke_" + name, script)
if spec is None or spec.loader is None:
    raise ImportError("Cannot load " + name + " import target")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
print(name)`;
  const results = [];
  for (const [name, scriptPath] of checks) {
    try {
      const result = await execFilePromise(PYTHON_BIN, ["-X", "utf8", "-c", importCode, name, scriptPath], {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      results.push({
        name,
        ok: String(result.stdout || "").trim() === name,
        exitCode: 0,
        ...(String(result.stderr || "").trim()
          ? { diagnostics: buildRunnerDiagnostics(0, result.stderr) }
          : {}),
      });
    } catch (error) {
      results.push({
        name,
        ok: false,
        exitCode: Number.isInteger(error?.code) ? error.code : null,
        diagnostics: buildRunnerDiagnostics(
          Number.isInteger(error?.code) ? error.code : null,
          error?.stderr || error?.message || String(error),
        ),
      });
    }
  }
  return {
    ok: results.length === checks.length && results.every((entry) => entry.ok),
    imports: results.filter((entry) => entry.ok).map((entry) => entry.name),
    entries: results,
  };
}

if (process.argv.includes("--self-test")) {
  runSelfTest()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        reason: error?.message || String(error),
        security: { credentialsReturned: false },
      })}\n`);
      process.exitCode = 1;
    });
} else {
  readMessages((message) => {
    if (updateChecker.isUpdateInProgress() && message?.action !== "download_and_install_update") {
      writeMessage({ ok: false, action: message?.action, reason: "UPDATE_ALREADY_RUNNING" });
      return;
    }
    if (!toolboxActionAllowed(message)) {
      writeMessage(toolboxActionRejected(message));
      return;
    }
    if (message?.action === "run_cli_export") {
      return runCliExport(message, writeMessage);
    }
    if (message?.action === "run_detail_table_workflow") {
      return runDetailTableWorkflow(message, writeMessage);
    }
    if (message?.action === "run_declaration_table_workflow") {
      return runDeclarationTableWorkflow(message, writeMessage);
    }
    if (message?.action === "run_print_format") {
      return runPrintFormat(message, writeMessage);
    }
    if (message?.action === "run_table_format") {
      return runTableFormat(message, writeMessage);
    }
    if (message?.action === "run_link_restore") {
      return runLinkRestore(message, writeMessage);
    }
    if (message?.action === "download_and_install_update") {
      return updateChecker.downloadAndInstallUpdate(message, writeMessage);
    }
    if (message?.action === "run_land_publicity") {
      return runLandPublicity(message, writeMessage);
    }
    if (message?.action === "run_alibaba_auction") {
      return runAlibabaAuction(message, writeMessage);
    }
    if (message?.action === "run_anjuke_property") {
      return runAnjukeProperty(message, writeMessage);
    }
    return handle(message)
      .then((payload) => {
        writeMessage(payload);
        scheduleUpdateHostShutdown(message, payload);
      })
      .catch((error) => {
        writeMessage({
          ok: false,
          reason: error?.message || String(error),
          security: { credentialsReturned: false },
        });
      });
  });
}
