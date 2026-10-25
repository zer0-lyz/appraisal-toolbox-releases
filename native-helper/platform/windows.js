"use strict";

const { execFile, execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const common = require("./common.js");

function createWindowsAdapter(options = {}) {
  const runFile = options.execFile || execFile;
  const runFileSync = options.execFileSync || execFileSync;
  const launchProcess = options.spawn || spawn;
  const monotonicNow = options.monotonicNow || (() => Number(process.hrtime.bigint()) / 1_000_000);
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  const runtimeRoot = path.join(localAppData, "AppraisalToolbox");
  const WINDOWS_SAFE_PATH_LIMIT = 240;

  function redactPowerShellText(value) {
    return String(value || "")
      .replace(/-EncodedCommand\s+\S+/gi, "-EncodedCommand [REDACTED]")
      .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/zhmcp_[A-Za-z0-9._-]+/gi, "[REDACTED]")
      .replace(/(authorization|cookie|password|验证码|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);
  }

  function parsePowerShellMarker(output, marker) {
    const lines = String(output || "").split(/\r?\n/).reverse();
    const line = lines.find((candidate) => candidate.startsWith(marker));
    if (!line) return null;
    try {
      return JSON.parse(line.slice(marker.length));
    } catch {
      return null;
    }
  }

  const PICKER_RESULT_MARKER = "APPRAISAL_PICKER_RESULT:";

  function pickerDiagnostics(stage, errorCode, exitCode = null) {
    const code = String(errorCode || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "UNKNOWN";
    return {
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      stderrTail: [`阶段: ${String(stage || "picker").slice(0, 48)}`, `错误码: ${code}`],
    };
  }

  function pickerFailure(reason, stage, errorCode, exitCode = null) {
    return {
      ok: false,
      cancelled: false,
      paths: [],
      reason,
      diagnostics: pickerDiagnostics(stage, errorCode, exitCode),
      security: common.security(),
    };
  }

  function parseStructuredPickerResponse(output) {
    const records = String(output || "").split(/\r?\n/).filter((line) => line.startsWith(PICKER_RESULT_MARKER));
    if (records.length !== 1) {
      return { error: pickerFailure("FILE_PICKER_PROTOCOL_INVALID", "response_validation", records.length ? "DUPLICATE_RESULT_MARKER" : "MISSING_RESULT_MARKER") };
    }
    let value;
    try {
      value = JSON.parse(records[0].slice(PICKER_RESULT_MARKER.length));
    } catch {
      return { error: pickerFailure("FILE_PICKER_PROTOCOL_INVALID", "response_validation", "MALFORMED_JSON") };
    }
    const allowedKeys = new Set(["ok", "cancelled", "paths", "reason", "stage", "errorCode"]);
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !allowedKeys.has(key))
        || typeof value.ok !== "boolean"
        || typeof value.cancelled !== "boolean"
        || !Array.isArray(value.paths)
        || value.paths.some((item) => typeof item !== "string" || !item || item !== item.trim() || /[\0\r\n]/.test(item))) {
      return { error: pickerFailure("FILE_PICKER_PROTOCOL_INVALID", "response_validation", "INVALID_RESPONSE_SHAPE") };
    }
    if (value.cancelled) {
      if (value.ok || value.paths.length) {
        return { error: pickerFailure("FILE_PICKER_PROTOCOL_INVALID", "response_validation", "INVALID_CANCEL_RESULT") };
      }
      return { result: {
        ok: false,
        cancelled: true,
        reason: "FILE_SELECTION_CANCELLED",
        paths: [],
        security: common.security(),
      } };
    }
    if (value.ok) {
      if (!value.paths.length || value.paths.some((item) => !path.win32.isAbsolute(item))) {
        return { error: pickerFailure("FILE_PICKER_EMPTY_RESULT", "response_validation", "EMPTY_OR_NONABSOLUTE_PATH") };
      }
      return { result: { ok: true, cancelled: false, paths: [...new Set(value.paths)], security: common.security() } };
    }
    if (value.paths.length || value.reason !== "FILE_PICKER_FAILED") {
      return { error: pickerFailure("FILE_PICKER_PROTOCOL_INVALID", "response_validation", "INVALID_FAILURE_RESULT") };
    }
    const stage = typeof value.stage === "string" && /^[a-z_]{1,48}$/.test(value.stage) ? value.stage : "picker_dialog";
    const code = typeof value.errorCode === "string" && /^(?:[A-Z0-9_-]{1,32}|-?\d{1,10}|0x[0-9A-Fa-f]{1,8})$/.test(value.errorCode)
      ? value.errorCode
      : "POWERSHELL_DIALOG_ERROR";
    return { result: { ...pickerFailure("FILE_PICKER_FAILED", stage, code), reason: "FILE_PICKER_FAILED" } };
  }

  function runPowerShell(script, timeout = 120000) {
    return new Promise((resolve) => {
      const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
      const powershellPath = path.join(env.SystemRoot || env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const args = [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ];
      try {
        const startedAt = monotonicNow();
        runFile(powershellPath, args, {
          timeout,
          windowsHide: true,
          encoding: "utf8",
          env,
        }, (error, stdout) => {
        if (error) {
          const elapsedMs = Math.max(0, Number(monotonicNow()) - Number(startedAt));
          const timeoutFailure = error.code === "ETIMEDOUT" || elapsedMs >= timeout;
          const spawnFailure = ["ENOENT", "EACCES", "EPERM"].includes(String(error.code || ""));
          const reason = timeoutFailure
            ? "FILE_PICKER_TIMEOUT"
            : spawnFailure ? "FILE_PICKER_PROCESS_START_FAILED" : "FILE_PICKER_PROCESS_FAILED";
          const stage = timeoutFailure ? "process_timeout" : spawnFailure ? "process_start" : "process_exit";
          resolve(pickerFailure(reason, stage, error.code, Number.isInteger(error.code) ? error.code : null));
          return;
        }
        const parsed = parseStructuredPickerResponse(stdout);
        resolve(parsed.result || parsed.error);
        });
      } catch (error) {
        resolve(pickerFailure(
          "FILE_PICKER_PROCESS_START_FAILED",
          "process_start",
          error?.code || "SYNCHRONOUS_SPAWN_ERROR",
        ));
      }
    });
  }

  function pickerPowerShellScript(kind, prompt) {
    const safePrompt = String(prompt || "").replace(/[\r\n\0]/g, " ").replace(/'/g, "''").slice(0, 240);
    const lines = [
      "$ErrorActionPreference = 'Stop'",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$dialog = $null",
      "$payload = $null",
      "function Show-AppraisalDialog($dialog) {",
      "  $owner = New-Object System.Windows.Forms.Form",
      "  $owner.Text = 'Appraisal Toolbox file picker'",
      "  $owner.ShowInTaskbar = $false; $owner.TopMost = $true; $owner.Opacity = 0",
      "  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
      "  $owner.Size = New-Object System.Drawing.Size(1, 1)",
      "  try { $null = $owner.Show(); $owner.Activate(); return $dialog.ShowDialog($owner) }",
      "  finally { $owner.Dispose() }",
      "}",
      "try {",
      "  Add-Type -AssemblyName System.Windows.Forms",
    ];
    if (kind === "directory") {
      lines.push(
        "  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        `  $dialog.Description = '${safePrompt}'`,
        "  $dialog.ShowNewFolderButton = $true",
      );
    } else {
      lines.push(
        "  $dialog = New-Object System.Windows.Forms.OpenFileDialog",
        `  $dialog.Title = '${safePrompt}'`,
      );
      if (kind === "word") lines.push("  $dialog.Filter = 'Word 文档 (*.docx)|*.docx'", "  $dialog.Multiselect = $true");
      else if (kind === "xlsx") lines.push("  $dialog.Filter = 'Excel 工作簿 (*.xlsx)|*.xlsx'", "  $dialog.Multiselect = $false");
      else if (kind === "workbooks") lines.push("  $dialog.Title = '选择需要调整打印格式的 Excel 文件'", "  $dialog.Filter = 'Excel 工作簿 (*.xlsx;*.xlsm)|*.xlsx;*.xlsm'", "  $dialog.Multiselect = $true");
    }
    lines.push(
      "  $dialogResult = Show-AppraisalDialog $dialog",
      "  if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {",
      "    $payload = @{ ok = $false; cancelled = $true; paths = @() }",
      "  } else {",
      kind === "directory"
        ? "    $paths = @([string]$dialog.SelectedPath)"
        : kind === "xlsx"
          ? "    $paths = @([string]$dialog.FileName)"
          : "    $paths = @($dialog.FileNames | ForEach-Object { [string]$_ })",
      "    $payload = @{ ok = $true; cancelled = $false; paths = @($paths) }",
      "  }",
      "} catch {",
      "  $code = 'POWERSHELL_DIALOG_ERROR'",
      "  try { if ($_.Exception -is [System.ComponentModel.Win32Exception]) { $code = [string]$_.Exception.NativeErrorCode } else { $code = ('0x{0:X8}' -f $_.Exception.HResult) } } catch { }",
      "  $payload = @{ ok = $false; cancelled = $false; paths = @(); reason = 'FILE_PICKER_FAILED'; stage = 'picker_dialog'; errorCode = $code }",
      "} finally {",
      "  if ($dialog) { try { $dialog.Dispose() } catch { } }",
      "}",
      "[Console]::Out.WriteLine('APPRAISAL_PICKER_RESULT:' + ($payload | ConvertTo-Json -Compress -Depth 4))",
    );
    return lines.join("\n");
  }

  async function chooseDirectory(prompt) {
    return await runPowerShell(pickerPowerShellScript("directory", prompt));
  }

  async function openPath(targetPath) {
    return await new Promise((resolve) => {
      // Submit to the Windows file association directly. Explorer can return 1
      // after handing off a request, which is not a reliable document-open result.
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "try {",
        "  Start-Process -FilePath $env:APPRAISAL_OPEN_TARGET -ErrorAction Stop",
        "  [Console]::Out.WriteLine('APPRAISAL_OPEN_RESULT:{\"ok\":true,\"opened\":true,\"launchAccepted\":true}')",
        "} catch {",
        "  $reason = 'NATIVE_PATH_OPEN_FAILED'",
        "  $exception = $_.Exception",
        "  while ($exception) {",
        "    if ($exception -is [System.ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 1155) { $reason = 'FILE_ASSOCIATION_MISSING' }",
        "    $exception = $exception.InnerException",
        "  }",
        "  [Console]::Out.WriteLine('APPRAISAL_OPEN_RESULT:' + (@{ok=$false; reason=$reason} | ConvertTo-Json -Compress))",
        "  exit 1",
        "}",
      ].join("\n");
      runFile(path.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
        { timeout: 12000, windowsHide: true, encoding: "utf8", env: { ...env, APPRAISAL_OPEN_TARGET: String(targetPath) } },
        (error, stdout) => {
          const result = parsePowerShellMarker(stdout, "APPRAISAL_OPEN_RESULT:");
          resolve(!error && result?.ok === true && result.opened === true
            ? { ...result, security: common.security() }
            : { ok: false, reason: result?.reason || "NATIVE_PATH_OPEN_FAILED", security: common.security() });
      });
    });
  }

  async function chooseWorkbookFiles() {
    return await runPowerShell(pickerPowerShellScript("workbooks", "选择需要调整打印格式的 Excel 文件"));
  }

  async function chooseWordFiles() {
    return await runPowerShell(pickerPowerShellScript("word", "选择需要统一表格格式的 Word 文档（.docx）"));
  }

  async function chooseXlsxFile() {
    return await runPowerShell(pickerPowerShellScript("xlsx", "选择折旧摊销预测输入工作簿（.xlsx）"));
  }

  async function listenerPids(port) {
    try {
      const output = await new Promise((resolve, reject) => {
        runFile("netstat.exe", ["-ano", "-p", "tcp"], {
          timeout: 5000,
          encoding: "utf8",
        }, (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      const portPattern = new RegExp(
        `(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|\\[::\\]):${Number(port)}\\s+\\S+\\s+LISTENING\\s+(\\d+)`,
        "i",
      );
      return [...new Set(String(output || "").split(/\r?\n/)
        .map((line) => line.match(portPattern)?.[1])
        .filter(Boolean)
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0))];
    } catch {
      return [];
    }
  }

  async function terminateProcess(pid) {
    return await new Promise((resolve) => {
      runFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        timeout: 5000,
        windowsHide: true,
      }, (error) => resolve(!error));
    });
  }

  async function extractZip(zipPath, destination) {
    fs.mkdirSync(destination, { recursive: true });
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "$ZipPath = [System.IO.Path]::GetFullPath($env:TIANYUAN_UPDATE_ZIP_PATH)",
      "$Destination = [System.IO.Path]::GetFullPath($env:TIANYUAN_UPDATE_DESTINATION)",
      "$SafePathLimit = 240",
      "$Stage = 'validating_zip'",
      "$zip = $null",
      "try {",
      "  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)",
      "  $root = $Destination.TrimEnd([char]92) + [char]92",
      "  $longest = ''",
      "  $longestLength = $Destination.Length",
      "  foreach ($entry in $zip.Entries) {",
      "    $name = [string]$entry.FullName",
      "    if ([string]::IsNullOrWhiteSpace($name)) { continue }",
      "    $normalized = $name.Replace('/', [char]92)",
      "    if ([System.IO.Path]::IsPathRooted($normalized) -or $normalized -match '^[A-Za-z]:') { throw [System.Exception]::new('UPDATE_ZIP_PATH_TRAVERSAL|' + $name) }",
      "    $parts = $normalized.Split([char]92)",
      "    if ($parts -contains '..') { throw [System.Exception]::new('UPDATE_ZIP_PATH_TRAVERSAL|' + $name) }",
      "    $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Destination, $normalized))",
      "    if (-not $candidate.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and $candidate -ne $Destination) { throw [System.Exception]::new('UPDATE_ZIP_PATH_TRAVERSAL|' + $name) }",
      "    if ($candidate.Length -gt $longestLength) { $longest = $name; $longestLength = $candidate.Length }",
      "    if ($candidate.Length -gt $SafePathLimit) { throw [System.Exception]::new('UPDATE_PATH_TOO_LONG|entry=' + $name + '|rootLength=' + $Destination.Length + '|targetLength=' + $candidate.Length) }",
      "  }",
      "  $zip.Dispose(); $zip = $null",
      "  $Stage = 'extracting'",
      "  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force",
      "  $payload = [ordered]@{ ok = $true; stage = 'complete'; destination = $Destination; longestEntry = $longest; longestTargetLength = $longestLength }",
      "  [Console]::Out.WriteLine('TIANYU_UPDATE_RESULT:' + ($payload | ConvertTo-Json -Compress))",
      "} catch {",
      "  if ($zip) { $zip.Dispose() }",
      "  $raw = [string]$_.Exception.Message",
      "  $parts = $raw.Split('|', 2)",
      "  $errorCode = if ($parts[0] -in @('UPDATE_PATH_TOO_LONG','UPDATE_ZIP_PATH_TRAVERSAL')) { $parts[0] } else { 'UPDATE_EXTRACT_FAILED' }",
      "  $reason = if ($parts.Length -gt 1) { $parts[1] } else { $raw }",
      "  $payload = [ordered]@{ ok = $false; errorCode = $errorCode; stage = $Stage; message = '更新包解压失败'; reason = $reason; zipPath = $ZipPath; destination = $Destination }",
      "  [Console]::Error.WriteLine('TIANYUAN_UPDATE_ERROR:' + ($payload | ConvertTo-Json -Compress))",
      "  exit 1",
      "}",
    ].join("\n");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = await new Promise((resolve) => {
      runFile("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ], {
        timeout: 180000,
        windowsHide: true,
        encoding: "utf8",
        env: {
          ...env,
          TIANYUAN_UPDATE_ZIP_PATH: String(zipPath),
          TIANYUAN_UPDATE_DESTINATION: String(destination),
        },
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    const parsed = parsePowerShellMarker(result.stderr, "TIANYUAN_UPDATE_ERROR:")
      || parsePowerShellMarker(result.stdout, "TIANYUAN_UPDATE_ERROR:");
    if (result.error || parsed?.ok === false) {
      const errorCode = parsed?.errorCode || "UPDATE_EXTRACT_FAILED";
      const details = [
        parsed?.message || "更新包解压失败",
        parsed?.reason || "PowerShell 解压命令失败",
        `stage=${parsed?.stage || "extracting"}`,
        `zip=${parsed?.zipPath || zipPath}`,
        `destination=${parsed?.destination || destination}`,
        `stderr=${redactPowerShellText(result.stderr)}`,
        `stdout=${redactPowerShellText(result.stdout)}`,
      ].filter((value) => !value.endsWith("="));
      const failure = new Error(`${errorCode}:${details.join("; ")}`.slice(0, 1800));
      failure.code = errorCode;
      failure.stage = parsed?.stage || "extracting";
      failure.zipPath = parsed?.zipPath || String(zipPath);
      failure.destination = parsed?.destination || String(destination);
      failure.reason = parsed?.reason || redactPowerShellText(result.stderr) || redactPowerShellText(result.error?.message);
      failure.stdout = redactPowerShellText(result.stdout);
      failure.stderr = redactPowerShellText(result.stderr);
      failure.exitCode = result.error?.code || null;
      throw failure;
    }
    const success = parsePowerShellMarker(result.stdout, "TIANYUAN_UPDATE_RESULT:");
    if (!success?.ok) {
      const failure = new Error(`UPDATE_EXTRACT_FAILED:解压过程未返回成功结果; stage=extracting; stderr=${redactPowerShellText(result.stderr)}`);
      failure.code = "UPDATE_EXTRACT_FAILED";
      failure.stage = "extracting";
      throw failure;
    }
    return success;
  }

  function createUpdateStagingRoot({ mode = "update", shortId = "" } = {}) {
    const id = String(shortId || Math.random().toString(16).slice(2, 10))
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 12) || "work";
    const bases = [
      path.join(localAppData, "TianyuanUpdate"),
      env.TEMP || env.TMP || os.tmpdir(),
    ];
    let lastError = null;
    for (const base of bases) {
      const candidate = path.join(base, id);
      try {
        fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
        return candidate;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`UPDATE_STAGING_DIRECTORY_FAILED:${mode}:${lastError?.code || "UNKNOWN"}`);
  }

  function launchWorkbenchInstaller({
    installerPath,
    statusPath,
    logPath,
    parentPid,
    cleanupPath = "",
  }) {
    const runnerPath = path.join(path.dirname(statusPath), "run-update.ps1");
    const quote = (value) => String(value).replace(/'/g, "''");
    fs.writeFileSync(runnerPath, [
      "$ErrorActionPreference = 'Stop'",
      `$ParentPid = ${Number(parentPid)}`,
      "$RunnerPid = $PID",
      `$StatusPath = '${quote(statusPath)}'`,
      `$LogPath = '${quote(logPath)}'`,
      `$CleanupPath = '${quote(cleanupPath)}'`,
      "$InstallerPid = $RunnerPid",
      "$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)",
      "function Protect-UpdateMessage([string]$Message) { return ($Message -replace '(?i)(bearer\\s+)[^\\s]+', '$1[REDACTED]' -replace '(?i)(authorization|cookie|password|验证码|token)\\s*[:=]\\s*[^\\s,;]+', '$1=[REDACTED]') }",
      "function Write-UpdateStatus([string]$Phase, [int]$Percent, [string]$Message, [string]$Reason = '', [int]$ExitCode = 0, [string]$ErrorCode = '') {",
      "  $payload = [ordered]@{ ok = $Phase -ne 'failed'; action = 'workbench_update'; phase = $Phase; percent = $Percent; message = $Message; reason = (Protect-UpdateMessage $Reason); errorCode = $ErrorCode; exitCode = $ExitCode; installerPid = $InstallerPid; updatedAt = [DateTime]::UtcNow.ToString('o'); logPath = $LogPath; security = @{ credentialsReturned = $false; tokenUsed = $false } }",
      "  New-Item -ItemType Directory -Path (Split-Path -Parent $StatusPath) -Force | Out-Null",
      "  $temporary = \"$StatusPath.tmp-$PID\"",
      "  [System.IO.File]::WriteAllText($temporary, (($payload | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $Utf8NoBom)",
      "  Move-Item -LiteralPath $temporary -Destination $StatusPath -Force",
      "}",
      "$LogDirectory = Split-Path -Parent $LogPath",
      "New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null",
      "\"runnerPid=$RunnerPid\" | Set-Content -LiteralPath $LogPath -Encoding UTF8",
      "Write-UpdateStatus 'preparing' 74 '更新程序已启动，正在准备停止工作台服务'",
      "$Deadline = (Get-Date).AddSeconds(15)",
      "while ((Get-Date) -lt $Deadline -and (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 200 }",
      "if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'UPDATE_PARENT_PROCESS_NOT_EXITED' }",
      "Write-UpdateStatus 'stopping_services' 76 '正在停止工作台服务并等待文件释放'",
      "$env:TIANYUAN_UPDATE_MODE = '1'",
      `$env:TIANYUAN_UPDATE_STATUS_PATH = '${quote(statusPath)}'`,
      `$env:TIANYUAN_UPDATE_LOG_PATH = '${quote(logPath)}'`,
      "$env:TIANYUAN_UPDATE_INSTALLER_PID = \"$InstallerPid\"",
      `& '${quote(installerPath)}' *>> '${quote(logPath)}'`,
      "$InstallerExitCode = [int]$LASTEXITCODE",
      "if ($InstallerExitCode -ne 0) { throw \"UPDATE_INSTALLER_EXIT_$InstallerExitCode\" }",
      "if (-not (Test-Path -LiteralPath $StatusPath)) { throw 'UPDATE_COMPLETION_STATUS_MISSING' }",
      "$final = Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json",
      "if ($final.phase -notin @('complete')) { throw 'UPDATE_COMPLETION_STATUS_MISSING' }",
      "if ($CleanupPath -and (Test-Path -LiteralPath $CleanupPath)) { Remove-Item -LiteralPath $CleanupPath -Recurse -Force -ErrorAction SilentlyContinue }",
      "exit 0",
      "",
      "trap {",
      "  $reason = Protect-UpdateMessage $_.Exception.Message",
      "  try { $existing = if (Test-Path -LiteralPath $StatusPath) { Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null } } catch { $existing = $null }",
      "  if ($existing -and $existing.phase -eq 'failed' -and $existing.reason) { $reason = Protect-UpdateMessage ([string]$existing.reason) }",
      "  $failedPercent = 0; if ($existing -and $existing.percent) { $failedPercent = [int]$existing.percent }",
      "  $errorCode = 'UPDATE_RUNNER_FAILED'; if ($existing -and $existing.errorCode) { $errorCode = [string]$existing.errorCode }",
      "  try { Write-UpdateStatus 'failed' $failedPercent '工作台更新失败' $reason ([int]($LASTEXITCODE)) $errorCode } catch {}",
      "  if ($CleanupPath -and (Test-Path -LiteralPath $CleanupPath)) { Remove-Item -LiteralPath $CleanupPath -Recurse -Force -ErrorAction SilentlyContinue }",
      "  exit 1",
      "}",
    ].join("\r\n"), "utf8");
    const child = launchProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      runnerPath,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...env },
    });
    child.once("error", (error) => {
      const reason = String(error?.code === "ENOENT" ? "UPDATE_RUNNER_NOT_FOUND" : error?.message || error)
        .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/(authorization|cookie|password|验证码|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
        .slice(0, 500);
      try {
        const current = fs.existsSync(statusPath)
          ? JSON.parse(fs.readFileSync(statusPath, "utf8"))
          : {};
        const next = {
          ...current,
          ok: false,
          action: "workbench_update",
          phase: "failed",
          reason,
          message: "更新程序启动失败",
          installerPid: child.pid || null,
          logPath,
          updatedAt: new Date().toISOString(),
          security: { credentialsReturned: false, tokenUsed: false },
        };
        const temporary = `${statusPath}.spawn-error-${process.pid}`;
        fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, statusPath);
      } catch {
        // The detached runner will write the durable failure state when possible.
      }
    });
    child.unref();
    return { pid: child.pid, runnerPath };
  }

  function createCredentialReference({ fallbackPath, key, secret }) {
    try {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$plain = [Text.Encoding]::UTF8.GetBytes($env:TIANYUAN_CONNECTOR_SECRET)",
        "$protected = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Convert]::ToBase64String($protected))",
      ].join("\n");
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      const protectedSecret = String(runFileSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ], {
        encoding: "utf8",
        windowsHide: true,
        env: { ...env, TIANYUAN_CONNECTOR_SECRET: secret },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }) || "").trim();
      if (!protectedSecret) throw new Error("DPAPI_EMPTY_RESULT");
      const values = common.readJson(fallbackPath, { protected: {} });
      values.protected = values.protected || {};
      values.protected[key] = protectedSecret;
      common.writeJson(fallbackPath, values);
      return `dpapi:${fallbackPath}#${key}`;
    } catch {
      return common.createFileCredentialReference({ fallbackPath, key, secret });
    }
  }

  function resolveCredentialReference(reference) {
    if (String(reference || "").startsWith("file:")) {
      return common.resolveFileCredentialReference(reference);
    }
    if (!String(reference || "").startsWith("dpapi:")) return "";
    const [filePart, key] = String(reference).slice(6).split("#");
    if (!filePart || !key) return "";
    try {
      const values = common.readJson(filePart, {});
      const protectedSecret = String(values?.protected?.[key] || "");
      if (!protectedSecret) return "";
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$protected = [Convert]::FromBase64String($env:TIANYUAN_CONNECTOR_PROTECTED_SECRET)",
        "$plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
      ].join("\n");
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      return String(runFileSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ], {
        encoding: "utf8",
        windowsHide: true,
        env: { ...env, TIANYUAN_CONNECTOR_PROTECTED_SECRET: protectedSecret },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }) || "").trim();
    } catch {
      return "";
    }
  }

  function diagnostics() {
    return {
      id: "windows",
      platform: "win32",
      supported: true,
      runtimeRoot,
      filePicker: "powershell-winforms",
      credentialStore: "windows-dpapi",
      processControl: "netstat-taskkill",
      dependencies: {
        powershell: common.commandAvailable(runFileSync, "powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$PSVersionTable.PSVersion.ToString()",
        ]),
        netstat: common.commandAvailable(runFileSync, "netstat.exe", ["-ano", "-p", "tcp"]),
        taskkill: common.commandAvailable(runFileSync, "taskkill.exe", ["/?"]),
      },
    };
  }

  return {
    id: "windows",
    platform: "win32",
    isWindows: true,
    isMacOS: false,
    runtimeRoot,
    defaultPythonBin: path.join(runtimeRoot, "runtime", "python-portable", "python.exe"),
    defaultPrintSkillsDir: path.join(runtimeRoot, "skills"),
    cliCandidates: [
      path.join(localAppData, "Programs", "tycpv", "tycpv.exe"),
      path.join(localAppData, "Programs", "tycpv", "bin", "tycpv.exe"),
      path.join(localAppData, "Programs", "tycpv", "tycpv.cmd"),
      path.join(localAppData, "Programs", "tycpv", "bin", "tycpv.cmd"),
      path.join(localAppData, "tycpv", "tycpv.exe"),
      path.join(localAppData, "tycpv", "bin", "tycpv.exe"),
      path.join(localAppData, "tycpv", "tycpv.cmd"),
      path.join(localAppData, "tycpv", "bin", "tycpv.cmd"),
      env.ProgramFiles && path.join(env.ProgramFiles, "tycpv", "tycpv.exe"),
      env.ProgramFiles && path.join(env.ProgramFiles, "tycpv", "bin", "tycpv.exe"),
      env.ProgramFiles && path.join(env.ProgramFiles, "tycpv", "tycpv.cmd"),
      env.ProgramFiles && path.join(env.ProgramFiles, "tycpv", "bin", "tycpv.cmd"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "tycpv", "tycpv.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "tycpv", "bin", "tycpv.exe"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "tycpv", "tycpv.cmd"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "tycpv", "bin", "tycpv.cmd"),
      path.join(homeDir, ".tycpv", "bin", "tycpv.exe"),
      path.join(homeDir, ".tycpv", "bin", "tycpv.cmd"),
    ].filter(Boolean),
    cliFallback: "tycpv.cmd",
    chooseDirectory,
    openPath,
    chooseWorkbookFiles,
    chooseWordFiles,
    chooseXlsxFile,
    async inspectActiveConversation() {
      return {
        ok: false,
        available: false,
        reason: "ACCESSIBILITY_CONVERSATION_UNSUPPORTED_PLATFORM",
        message: "当前测试入口只支持 macOS 辅助功能读取。",
        security: common.security(),
      };
    },
    createCredentialReference,
    diagnostics,
    listenerPids,
    createUpdateStagingRoot,
    extractZip,
    launchWorkbenchInstaller,
    resolveCredentialReference,
    terminateProcess,
  };
}

module.exports = { createWindowsAdapter };
