"use strict";

// Windows update orchestration. No registry/context bypass: install.ps1 owns the gate.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { pipeline } = require("node:stream/promises");
const { spawn } = require("node:child_process");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");
const { commandLaunchSpec } = require("./process_launcher.js");
let updating = false;

function assetUrl(value, redirected = false) {
  let u;
  try { u = new URL(String(value || "")); } catch { throw new Error("UPDATE_URL_INVALID"); }
  if (u.protocol !== "https:") throw new Error("UPDATE_URL_NOT_HTTPS");
  if (u.username || u.password || u.port || u.hash) throw new Error("UPDATE_URL_INVALID");
  const official = (u.hostname === "github.com" && /^\/zer0-lyz\/appraisal-toolbox-releases\/releases\/(?:download\/[^/]+\/[^/]+|latest\/download\/[^/]+)$/.test(u.pathname))
    || (u.hostname === "api.github.com" && /^\/repos\/zer0-lyz\/appraisal-toolbox-releases\/releases\/assets\/\d+$/.test(u.pathname))
    || (u.hostname === "gitee.com" && /^\/zer0_y\/appraisal-toolbox-releases\/releases\/download\/[^/]+\/[^/]+$/.test(u.pathname));
  const cdn = redirected && ["objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(u.hostname) && u.pathname !== "/";
  if (!official && !cdn) throw new Error("UPDATE_URL_HOST_NOT_ALLOWED");
  return u;
}

function responseFor(url, signal, hops = 5, redirected = false) {
  return new Promise((resolve, reject) => {
    const u = assetUrl(url, redirected);
    const req = https.get(u, { signal, headers: { "User-Agent": "appraisal-toolbox-updater", Accept: "application/octet-stream" } }, res => {
      res.on("error", reject);
      res.once("aborted", () => res.destroy(new Error("UPDATE_DOWNLOAD_NETWORK_FAILED")));
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (!res.headers.location || hops === 0) return reject(new Error("UPDATE_DOWNLOAD_REDIRECTS_EXHAUSTED"));
        responseFor(new URL(res.headers.location, u).href, signal, hops - 1, true).then(resolve, reject);
      } else if (res.statusCode !== 200) {
        res.resume(); reject(new Error("UPDATE_DOWNLOAD_HTTP_" + res.statusCode));
      } else resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("UPDATE_DOWNLOAD_TIMEOUT")));
  });
}

function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256"), input = fs.createReadStream(file);
    input.on("data", b => hash.update(b)); input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function childPath(root, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..") || path.basename(name) !== name) throw new Error("UPDATE_STAGING_PATH_INVALID");
  return path.join(root, name);
}

function processError(code, properties = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, properties);
  return error;
}

function runProcess(command, args, options, timeoutMs, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let timedOut = false, settled = false, childClosed = false, killFinished = false;
    let killConfirmed = false, childCode = -1, timer, killWatchdog;
    const finishError = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killWatchdog);
      reject(error);
    };
    const finishTimeoutIfReady = () => {
      if (settled || !timedOut) return;
      if (killFinished && killConfirmed && childClosed) {
        finishError(processError("UPDATE_PROCESS_TIMEOUT", { terminationConfirmed: true }));
      }
    };
    let child;
    try { child = spawnProcess(command, args, { ...options, windowsHide: true }); }
    catch { reject(processError("UPDATE_INSTALLER_NOT_STARTED")); return; }
    timer = setTimeout(() => {
      timedOut = true;
      // Do not begin rollback until taskkill confirms the whole installer tree
      // was terminated and Node has observed the root process close.
      if (!child.pid) return finishError(processError("UPDATE_PROCESS_TERMINATION_UNCONFIRMED"));
      let killer;
      try {
        killer = spawnProcess(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        return finishError(processError("UPDATE_PROCESS_TERMINATION_UNCONFIRMED"));
      }
      killer.once("error", () => finishError(processError("UPDATE_PROCESS_TERMINATION_UNCONFIRMED")));
      killer.once("close", code => {
        killFinished = true;
        killConfirmed = code === 0;
        if (!killConfirmed) return finishError(processError("UPDATE_PROCESS_TERMINATION_UNCONFIRMED"));
        killWatchdog = setTimeout(() => {
          if (!childClosed) finishError(processError("UPDATE_PROCESS_TERMINATION_UNCONFIRMED"));
        }, 30000);
        finishTimeoutIfReady();
      });
    }, timeoutMs);
    child.once("error", () => finishError(processError(timedOut ? "UPDATE_PROCESS_TERMINATION_UNCONFIRMED" : "UPDATE_INSTALLER_NOT_STARTED")));
    child.on("close", code => {
      childClosed = true;
      childCode = code ?? -1;
      if (!timedOut) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(childCode);
        return;
      }
      finishTimeoutIfReady();
    });
  });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function capabilities() { return { autoUpdateSupported: process.platform === "win32" && process.arch === "x64" }; }
function ordinaryInstallerEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^APPRAISAL_TOOLBOX_INSTALLER_TEST_|^APPRAISAL_TOOLBOX_INSTALL_ROOT$|^TIANYUAN_|^PYTHON_BIN$/i.test(key)) delete env[key];
  }
  return env;
}

function parseInstallReport(installRoot) {
  const report = fs.readFileSync(path.join(installRoot, "installation-report.txt"), "utf8");
  return Object.fromEntries(report.split(/\r?\n/).filter(line => line.includes("=")).map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

async function candidateInstallationVerified({ installRoot, extensionRoot, nonce, provenance, packageRoot }) {
  try {
    const fields = parseInstallReport(installRoot);
    return fields.status === "success"
      && fields.updateNonce === nonce
      && fields.buildId === provenance.buildId
      && fields.nativeExeSha256 === provenance.nativeExeSha256
      && path.resolve(fields.extensionPath || "") === path.resolve(extensionRoot)
      && await digest(path.join(installRoot, "native-helper", "native_host.exe")) === provenance.nativeExeSha256
      && await digest(path.join(extensionRoot, "version.json")) === await digest(path.join(packageRoot, "extension", "version.json"));
  } catch { return false; }
}

async function previousInstallationVerified({ installRoot, extensionRoot, nativeExeSha256, extensionVersionSha256 }) {
  try {
    return await digest(path.join(installRoot, "native-helper", "native_host.exe")) === nativeExeSha256
      && await digest(path.join(extensionRoot, "version.json")) === extensionVersionSha256;
  } catch { return false; }
}

function findInstallerFailureReport({ installRoot, nonce }) {
  const parent = path.dirname(installRoot);
  const prefix = path.basename(installRoot) + ".installation-failure-";
  const matches = [];
  for (const name of fs.readdirSync(parent)) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const file = path.join(parent, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const report = readJson(file);
      if (report.status === "failed" && report.updateNonce === nonce
        && path.resolve(String(report.installRoot || "")).toLowerCase() === path.resolve(installRoot).toLowerCase()) {
        matches.push({ file, report });
      }
    } catch { /* A malformed or inaccessible report cannot attest rollback. */ }
  }
  return matches.length === 1 ? matches[0] : null;
}

async function recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath, nonce, nativeExeSha256, extensionVersionSha256 }) {
  if (!journalPath || !fs.existsSync(journalPath)) {
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryDetail: "transaction journal is missing; file fingerprints cannot prove registry rollback" });
  }
  const recoveryLog = path.join(path.dirname(journalPath), "recovery-log.txt");
  let logFd;
  try {
    logFd = fs.openSync(recoveryLog, "a");
    const spec = commandLaunchSpec("powershell.exe", []);
    const code = await runProcess(spec.command, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(packageRoot, "install.ps1"),
      "-RecoverUpdateTransaction", "-RecoveryJournalPath", journalPath,
      "-RecoveryNonce", nonce, "-InstallRoot", installRoot,
    ], {
      cwd: packageRoot,
      env: { ...ordinaryInstallerEnv(), ...spec.env, TB_UPDATE_NONCE: nonce, TB_UPDATE_INSTALL_ROOT: installRoot },
      stdio: ["ignore", logFd, logFd],
    }, 2 * 60 * 1000);
    if (code !== 0) throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryLog });
  } catch (error) {
    if (error?.code === "UPDATE_PROCESS_RECOVERY_FAILED") throw error;
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryLog, recoveryDetail: String(error?.code || error?.message || "recovery process failed") });
  } finally {
    if (logFd !== undefined) fs.closeSync(logFd);
  }
  let report;
  try { report = readJson(`${journalPath}.recovery-report.json`); }
  catch { throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryLog, recoveryDetail: "recovery report is missing or invalid" }); }
  if (report.status !== "recovered" || report.nonce !== nonce || path.resolve(report.installRoot || "") !== path.resolve(installRoot)
    || report.registryRestored !== true || report.extensionRestored !== true || report.installRootRestored !== true) {
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryLog, recoveryDetail: "recovery report did not verify the complete rollback" });
  }
  if (!await previousInstallationVerified({ installRoot, extensionRoot, nativeExeSha256, extensionVersionSha256 })) {
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryLog, recoveryDetail: "restored build fingerprints do not match the pre-update version" });
  }
  return { ...report, recoveryLog };
}

async function downloadAndInstallUpdate(message, emit, checkUpdate) {
  let stage, lock, heartbeat, logFd, originalCwd, installRoot, extensionRoot, packageRoot;
  let transactionJournalPath, installerLogPath, provenance, previousNativeExeSha256, previousExtensionVersionSha256;
  let phase = "preflight", percent = 1, installerStarted = false, ownsBusy = false;
  const nonce = crypto.randomUUID();
  const progress = (p, nextPhase, text) => {
    percent = p; phase = nextPhase;
    emit({ ok: true, event: "progress", action: "download_and_install_update", phase, percent, message: text });
  };
  let result;
  try {
    if (!capabilities().autoUpdateSupported) throw new Error("PLATFORM_UPDATE_UNSUPPORTED");
    if (updating) throw new Error("UPDATE_ALREADY_RUNNING");
    updating = true; ownsBusy = true;
    if (!/^[0-9a-f]{64}$/i.test(String(message.sha256 || ""))) throw new Error("UPDATE_SHA256_REQUIRED");
    assetUrl(message.url);
    const nativeRoot = nativeHelperDataDirectory();
    installRoot = path.dirname(nativeRoot);
    let config;
    try { config = readJson(path.join(nativeRoot, "runtime-config.json")); } catch { throw new Error("UPDATE_EXTENSION_PATH_REQUIRED"); }
    if (!config.extensionLoadPath || config.toolboxExtensionId !== "aamfmhcbjgofhmannejoiilkkpchfkgm") throw new Error("UPDATE_EXTENSION_PATH_REQUIRED");
    extensionRoot = path.resolve(config.extensionLoadPath);
    const local = readJson(path.join(extensionRoot, "version.json"));
    const contract = readJson(path.join(extensionRoot, "runtime-compat.json"));
    // Recheck the authoritative manifest; caller cannot select an old package or another platform.
    progress(1, "preflight", "正在核对当前构建与官方更新记录…");
    const latest = await checkUpdate({ repository: "zer0-lyz/appraisal-toolbox-releases", currentVersion: local.productVersion, currentBuildNumber: local.buildNumber, currentRuntimeBuildId: contract.runtimeBuildId, currentRuntimeBuildKind: contract.runtimeBuildKind });
    if (!latest.ok || !latest.releasePublished || !latest.updateAvailable || latest.platform !== "windows-x64") throw new Error("UPDATE_NOT_REQUIRED");
    const sha = String(latest.asset?.sha256 || "").toLowerCase();
    const size = Number(latest.asset?.size || 0);
    if (!/^[0-9a-f]{64}$/.test(sha) || sha !== String(message.sha256).toLowerCase()) throw new Error("UPDATE_TARGET_CHANGED");
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
    previousNativeExeSha256 = await digest(path.join(nativeRoot, "native_host.exe"));
    previousExtensionVersionSha256 = await digest(path.join(extensionRoot, "version.json"));
    const parent = path.dirname(installRoot), stagingRoot = path.join(parent, ".AppraisalToolbox-updates");
    // Reject symlink/reparse redirection before creating or deleting any stage content.
    for (let p = parent; ; p = path.dirname(p)) {
      if (fs.lstatSync(p).isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
      if (path.dirname(p) === p) break;
    }
    lock = path.join(parent, ".AppraisalToolbox-update.lock");
    try { fs.mkdirSync(lock); } catch { lock = null; throw new Error("UPDATE_ALREADY_RUNNING"); }
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, nonce, startedAtUtc: new Date().toISOString() }));
    fs.mkdirSync(stagingRoot, { recursive: true });
    if (fs.lstatSync(stagingRoot).isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
    stage = fs.mkdtempSync(path.join(stagingRoot, "run-"));
    const zip = childPath(stage, "package.zip"), extracted = childPath(stage, "extracted");
    installerLogPath = childPath(stage, "installer-log.txt");
    transactionJournalPath = childPath(stage, "update-transaction.json");
    heartbeat = setInterval(() => progress(percent, phase, "更新正在执行，请保持浏览器开启…"), 10000);
    const candidates = [...new Set([...(latest.downloadCandidates || []).map(c => c.url), latest.asset?.url].filter(Boolean))];
    let downloaded = false, failure;
    for (const url of candidates) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new Error("UPDATE_DOWNLOAD_TIMEOUT")), 10 * 60 * 1000);
      let response;
      try {
        progress(2, "downloading", "正在下载最新版安装包…");
        response = await responseFor(url, controller.signal);
        response.once("aborted", () => response.destroy(new Error("UPDATE_DOWNLOAD_NETWORK_FAILED")));
        const advertised = response.headers["content-length"];
        if (advertised !== undefined && Number(advertised) !== size) throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
        let bytes = 0, last = 0;
        response.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > size) controller.abort(new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH"));
          if (Date.now() - last > 1000) { last = Date.now(); progress(Math.min(60, 2 + bytes / size * 58), "downloading", "正在下载安装包…"); }
        });
        await pipeline(response, fs.createWriteStream(zip, { flags: "wx" }), { signal: controller.signal });
        if (fs.statSync(zip).size !== size) throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
        progress(62, "verifying", "正在校验安装包…");
        if (await digest(zip) !== sha) throw new Error("UPDATE_DOWNLOAD_SHA256_MISMATCH");
        downloaded = true; break;
      } catch (error) {
        failure = controller.signal.reason || error;
        response?.destroy();
        fs.rmSync(zip, { force: true });
      } finally { clearTimeout(deadline); }
    }
    if (!downloaded) throw failure || new Error("UPDATE_DOWNLOAD_CHANNELS_FAILED");
    progress(70, "extracting", "正在解压更新包…");
    const spec = commandLaunchSpec("powershell.exe", []);
    const extractionCode = "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:TB_ZIP); try { foreach($e in $z.Entries) { $p=[IO.Path]::GetFullPath([IO.Path]::Combine($env:TB_DEST,$e.FullName)); if(-not $p.StartsWith($env:TB_DEST+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive path' } } } finally { $z.Dispose() }; Expand-Archive -LiteralPath $env:TB_ZIP -DestinationPath $env:TB_DEST -Force";
    const common = { cwd: stage, env: { ...process.env, ...spec.env, TB_ZIP: zip, TB_DEST: extracted } };
    if (await runProcess(spec.command, [...spec.args, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ErrorActionPreference='Stop'; " + extractionCode], { ...common, stdio: "ignore" }, 10 * 60 * 1000) !== 0) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
    packageRoot = extracted;
    if (!fs.existsSync(path.join(packageRoot, "install.cmd"))) {
      const roots = fs.readdirSync(extracted).filter(n => fs.existsSync(path.join(extracted, n, "install.cmd")));
      if (roots.length !== 1) throw new Error("UPDATE_INSTALLER_NOT_FOUND");
      packageRoot = path.join(extracted, roots[0]);
    }
    provenance = readJson(path.join(packageRoot, "BUILD-PROVENANCE.json"));
    const targetVersion = readJson(path.join(packageRoot, "extension", "version.json"));
    if (targetVersion.productVersion !== latest.latestVersion || Number(targetVersion.buildNumber) !== Number(latest.latestBuildNumber)) throw new Error("UPDATE_TARGET_CHANGED");
    if (!/^[a-f0-9]{64}$/.test(provenance.nativeExeSha256 || "") || await digest(path.join(packageRoot, "native-helper", "native_host.exe")) !== provenance.nativeExeSha256) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
    progress(80, "installing", "正在安装组件并更新原插件目录…");
    logFd = fs.openSync(installerLogPath, "wx");
    // Chrome may start a native host with cwd=native-helper. Release this directory handle too.
    originalCwd = process.cwd();
    process.chdir(stage);
    installerStarted = true;
    // install.cmd retains the normal user's token/ancestry. Its context gate is mandatory.
    const exit = await runProcess("cmd.exe", ["/d", "/s", "/c", "install.cmd"], { cwd: packageRoot, stdio: ["ignore", logFd, logFd], env: { ...ordinaryInstallerEnv(), TB_UPDATE_NONCE: nonce, TB_UPDATE_INSTALL_ROOT: installRoot, TB_UPDATE_EXTENSION_PATH: extensionRoot, TB_UPDATE_JOURNAL_PATH: transactionJournalPath } }, 15 * 60 * 1000);
    fs.closeSync(logFd); logFd = undefined;
    progress(96, "verifying_install", "正在核对本次安装结果…");
    if (exit !== 0) {
      const failure = findInstallerFailureReport({ installRoot, nonce });
      if (failure?.report.rollbackVerified === true
        && await previousInstallationVerified({ installRoot, extensionRoot, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256 })) {
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: true, failureReportPath: failure.file, installerLogPath } };
      } else {
        try {
          const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256 });
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: true, recoveredAfterInstallerFailure: true, installerLogPath, recoveryLog: recovery.recoveryLog || null } };
        } catch (recoveryError) {
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLBACK_FAILED", currentVersionUnchanged: null, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: false, failureReportPath: failure?.file || null, installerLogPath, recoveryLog: recoveryError.recoveryLog || null, detail: String(recoveryError.recoveryDetail || recoveryError.code || recoveryError.message || "rollback could not be verified").replace(/https?:\/\/\S+/g, "[url]").slice(-600) } };
        }
      }
    }
    if (exit !== 0) {
      // A verified failure/rollback is a finished transaction; do not continue
      // into success verification or overwrite its result.
    } else if (!await candidateInstallationVerified({ installRoot, extensionRoot, nonce, provenance, packageRoot })) {
      progress(98, "rollback", "安装结果缺少有效核验记录，正在恢复并核对旧版本…");
      try {
        const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256 });
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: true, recoveredAfterMissingCompletionStatus: true, installerLogPath, recoveryLog: recovery.recoveryLog || null } };
      } catch (recoveryError) {
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLBACK_FAILED", currentVersionUnchanged: null, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: false, installerLogPath, recoveryLog: recoveryError.recoveryLog || null, detail: String(recoveryError.recoveryDetail || recoveryError.code || recoveryError.message || "rollback could not be verified").replace(/https?:\/\/\S+/g, "[url]").slice(-600) } };
      }
    } else {
      result = { ok: true, phase: "complete", percent: 100, message: "更新已完成，请重新加载原插件。", installerLogPath, updateNonce: nonce, buildId: provenance.buildId };
    }
  } catch (error) {
    const raw = String(error?.message || "");
    if (installerStarted && error?.code === "UPDATE_PROCESS_TIMEOUT" && error.terminationConfirmed && installRoot && extensionRoot && provenance) {
      try {
        if (await candidateInstallationVerified({ installRoot, extensionRoot, nonce, provenance, packageRoot })) {
          result = { ok: true, phase: "complete", percent: 100, message: "更新已完成并核验，请重新加载原插件。", installerLogPath, updateNonce: nonce, buildId: provenance.buildId, diagnostics: { installerExitedAfterVerifiedReport: false } };
        } else {
          progress(98, "rollback", "安装进程超时，正在恢复并核验旧版本…");
          const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256 });
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_PROCESS_TIMEOUT_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, rollbackVerified: true, recoveryStatus: recovery.status || "recovered", installerLogPath, recoveryLog: recovery.recoveryLog || null } };
        }
      } catch (recoveryError) {
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_PROCESS_RECOVERY_FAILED", currentVersionUnchanged: null, diagnostics: { installerStarted, rollbackVerified: false, installerLogPath, recoveryLog: recoveryError.recoveryLog || null, detail: String(recoveryError.recoveryDetail || recoveryError.code || recoveryError.message || "recovery failed").replace(/https?:\/\/\S+/g, "[url]").slice(-600) } };
      }
    } else {
      const reason = /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(raw) ? raw : "UPDATE_FAILED";
      result = { ok: false, phase: "failed", percent, reason, diagnostics: { installerStarted, stagePath: stage || null, installerLogPath: installerLogPath || null, detail: raw.replace(/https?:\/\/\S+/g, "[url]").slice(-600) } };
    }
  } finally {
    clearInterval(heartbeat);
    if (originalCwd) { try { process.chdir(originalCwd); } catch { /* retain external cwd if rollback incomplete */ } }
    if (ownsBusy) updating = false;
    if (logFd !== undefined) fs.closeSync(logFd);
    // Keep the lock when process death or rollback cannot be verified. A verified
    // rollback releases it so the user can safely retry; diagnostic files remain.
    const recoveryRequired = result?.reason === "UPDATE_PROCESS_TERMINATION_UNCONFIRMED"
      || result?.reason === "UPDATE_PROCESS_RECOVERY_FAILED"
      || result?.reason === "UPDATE_INSTALLER_ROLLBACK_FAILED"
      || result?.reason === "UPDATE_COMPLETION_STATUS_MISSING"
      || (installerStarted && result?.reason === "UPDATE_PROCESS_TIMEOUT");
    if (lock && !recoveryRequired) {
      try { fs.rmSync(lock, { recursive: true, force: true }); } catch { result = { ok: false, phase: "failed", percent, reason: "UPDATE_LOCK_RELEASE_FAILED", diagnostics: { lockPath: lock } }; }
    }
  }
  const final = { ...result, event: "complete", action: "download_and_install_update", security: { credentialsReturned: false } };
  emit(final); return final;
}

module.exports = { assetUrl, capabilities, downloadAndInstallUpdate, findInstallerFailureReport, isUpdating: () => updating, recoverTimedOutInstaller, runProcess };
