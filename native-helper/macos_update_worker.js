"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const {
  MacUpdateTransactionStore,
  atomicWriteJson,
  canonicalInstallRoot,
  resolveLockPython,
  unresolvedInstallerReason,
} = require("./macos_update_transaction.js");
const updater = require("./update_engine_macos.js");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(["complete", "rolled_back", "failed_safe"]);
const ACTIVE = new Set(["starting", "busy", "installing", "recovering"]);
const HEARTBEAT_MS = 10000;
const MAX_DOWNLOAD_CANDIDATES = 2;
const TOTAL_DOWNLOAD_BUDGET_MS = 15 * 60 * 1000;
const WORKER_BUDGET_MS = 65 * 60 * 1000;

function expectedManifestPaths(homeDir) {
  return [
    { name: "chrome", path: path.join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.appraisal.toolbox.helper.json") },
    { name: "edge", path: path.join(homeDir, "Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.appraisal.toolbox.helper.json") },
  ];
}

function validateRequest(value, { homeDir = os.homedir(), requestPath = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1
    || !UUID_PATTERN.test(String(value.nonce || ""))) throw new Error("UPDATE_REQUEST_INVALID");
  const updatesRoot = path.resolve(String(value.updatesRoot || ""));
  const expectedUpdatesRoot = path.join(fs.realpathSync(path.resolve(homeDir)), ".appraisal-toolbox-updates");
  if (updatesRoot !== expectedUpdatesRoot) throw new Error("UPDATE_REQUEST_INVALID");
  if (requestPath) {
    const requestDirectory = path.join(updatesRoot, "requests");
    const resolvedRequest = path.resolve(requestPath);
    if (path.dirname(resolvedRequest) !== requestDirectory
      || path.basename(resolvedRequest) !== `${value.nonce}.request.json`) throw new Error("UPDATE_REQUEST_INVALID");
    const stat = fs.lstatSync(resolvedRequest);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      throw new Error("UPDATE_REQUEST_INVALID");
    }
  }
  const installRoot = canonicalInstallRoot(value.installRoot);
  if (installRoot !== value.installRoot) throw new Error("UPDATE_REQUEST_INVALID");
  const update = value.update;
  if (!update || typeof update !== "object" || Array.isArray(update)
    || !/^[a-f0-9]{64}$/i.test(String(update.sha256 || ""))) throw new Error("UPDATE_REQUEST_INVALID");
  const url = updater.allowedAssetUrl(update.url).href;
  const assetName = String(update.assetName || "appraisal-toolbox-update.zip");
  if (assetName.includes("/") || assetName.includes("\\") || assetName === "." || assetName === "..") {
    throw new Error("UPDATE_REQUEST_INVALID");
  }
  const sizeBytes = Number(update.sizeBytes || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error("UPDATE_REQUEST_INVALID");
  return {
    schemaVersion: 1,
    nonce: value.nonce,
    installRoot,
    canonicalInstallRoot: installRoot,
    updatesRoot,
    update: { url, sha256: String(update.sha256).toLowerCase(), assetName, sizeBytes },
  };
}

function publicStatus(value) {
  const out = { ok: value?.ok === true, action: "get_update_status" };
  for (const key of [
    "state", "phase", "percent", "message", "reason", "transactionId", "verified", "recoveryBlocked",
    "currentVersionUnchanged", "platform", "latestVersion", "latestBuildNumber",
  ]) {
    if (value?.[key] !== undefined) out[key] = value[key];
  }
  if (value?.diagnostics && typeof value.diagnostics === "object") {
    out.diagnostics = {
      installerStarted: value.diagnostics.installerStarted === true,
      failureStage: String(value.diagnostics.failureStage || "").slice(0, 40),
    };
  }
  return out;
}

function readInstallerTransaction(options, journalPath, nonce, canonicalRoot) {
  const helper = options.installerTransaction || require("./macos_installer_transaction.js");
  if (typeof helper.readInstallerJournal !== "function") throw new Error("UPDATE_INSTALLER_JOURNAL_UNAVAILABLE");
  const journal = helper.readInstallerJournal(journalPath, { nonce, canonicalRoot });
  if (!journal || journal.nonce !== nonce || journal.canonicalRoot !== canonicalRoot) {
    throw new Error("UPDATE_INSTALLER_JOURNAL_INVALID");
  }
  const expected = Object.fromEntries(expectedManifestPaths(options.homeDir || os.homedir()).map(({ name, path: file }) => [name, file]));
  if (JSON.stringify(journal.manifestPaths) !== JSON.stringify(expected)) throw new Error("UPDATE_INSTALLER_JOURNAL_INVALID");
  return { helper, journal };
}

function checkBaseline({ installRoot, homeDir, baseline, pythonBootstrap, runFileSync, verificationEnvironment = {} }) {
  try {
    const current = updater.readJson(path.join(installRoot, "extension", "version.json"));
    const config = updater.readJson(path.join(installRoot, "native-helper", "runtime-config.json"));
    if (current.productVersion !== baseline.productVersion || Number(current.buildNumber) !== Number(baseline.buildNumber)
      || config.toolboxExtensionId !== updater.EXTENSION_ID || config.nativeHostName !== updater.NATIVE_HOST) return false;
    const nodePath = path.join(installRoot, "runtime/node/bin/node");
    const hostPath = path.join(installRoot, "native-helper/native_host.js");
    const env = updater.installerEnvironment(process.env, { homeDir, installRoot, pythonBootstrap });
    Object.assign(env, verificationEnvironment);
    const raw = runFileSync(nodePath, [hostPath, "--self-test"], {
      cwd: path.dirname(hostPath), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env,
    });
    const report = JSON.parse(String(raw || ""));
    return report.ok === true && report.pythonSkillImportSmoke?.ok === true;
  } catch {
    return false;
  }
}

async function runMacOSUpdateTransaction(rawRequest, options = {}) {
  const homeDir = fs.realpathSync(path.resolve(options.homeDir || os.homedir()));
  const installRoot = canonicalInstallRoot(rawRequest?.installRoot);
  const updatesRoot = path.resolve(options.updatesRoot || rawRequest?.updatesRoot || path.join(homeDir, ".appraisal-toolbox-updates"));
  const request = validateRequest({ ...rawRequest, installRoot, updatesRoot }, { homeDir, requestPath: options.requestPath });
  const runFileSync = options.execFileSync || execFileSync;
  const spawnProcess = options.spawn || spawn;
  const bootstrap = path.join(installRoot, "python", "bin", "python3");
  const frameworkRoot = options.frameworkRoot || process.env.APPRAISAL_TEST_FRAMEWORK_PATH;
  const lockPython = options.pythonBin || resolveLockPython(installRoot, bootstrap, runFileSync, frameworkRoot);
  if (options.pythonBin && options.requirePinnedPython !== false) {
    const resolved = resolveLockPython(installRoot, bootstrap, runFileSync, frameworkRoot);
    if (path.resolve(options.pythonBin) !== resolved) throw new Error("UPDATE_LOCK_RUNTIME_UNAVAILABLE");
  }
  const store = options.store || new MacUpdateTransactionStore({
    homeDir, installRoot, updatesRoot, pythonBin: lockPython, spawnProcess,
    lockEnvironment: options.lockEnvironment || {},
  });
  const nonce = request.nonce;
  const updateDirectory = path.join(updatesRoot, nonce);
  const zipPath = path.join(updateDirectory, "update.zip");
  const extractRoot = path.join(updateDirectory, "extracted");
  const installerJournalPath = path.join(updateDirectory, "installer-transaction.json");
  const logPath = path.join(updateDirectory, "installer.log");
  const manifestPaths = expectedManifestPaths(homeDir);
  const onAccepted = typeof options.onAccepted === "function" ? options.onAccepted : () => {};
  let lock = null;
  let transactionCreated = false;
  let installerStarted = false;
  let heartbeat = null;
  let baseline = null;
  let pythonBootstrap = bootstrap;
  let patch = null;
  let result = null;
  let finalState = null;
  let journalFailure = null;
  let installerChild = null;
  let heartbeatStopTimer = null;
  let phase = "preflight";
  let percent = 1;
  let message = "正在核对更新事务与本机环境…";
  const stopInstaller = () => {
    if (!installerChild || installerChild.exitCode !== null && installerChild.exitCode !== undefined) return;
    const pid = Number(installerChild.pid);
    if (!Number.isSafeInteger(pid) || pid < 2) return;
    try { process.kill(-pid, "SIGTERM"); } catch {
      try { installerChild.kill("SIGTERM"); } catch { /* installer may have exited */ }
    }
    if (heartbeatStopTimer) return;
    heartbeatStopTimer = setTimeout(() => {
      try { process.kill(-pid, "SIGKILL"); } catch {
        try { installerChild.kill("SIGKILL"); } catch { /* installer may have exited */ }
      }
    }, Math.max(250, Number(options.heartbeatStopGraceMs) || 1000));
    if (typeof heartbeatStopTimer.unref === "function") heartbeatStopTimer.unref();
  };
  const failJournal = (error) => {
    if (!journalFailure) journalFailure = new Error("UPDATE_LOCK_STATE_WRITE_FAILED", { cause: error });
    stopInstaller();
  };
  const assertJournalHealthy = () => {
    if (journalFailure) throw journalFailure;
    if (lock) {
      try { lock.assertHeld(); }
      catch (error) { failJournal(error); throw journalFailure; }
    }
  };
  const writeStatus = (value) => {
    if (!transactionCreated) return;
    assertJournalHealthy();
    try { store.write(nonce, value); }
    catch (error) { failJournal(error); throw journalFailure; }
  };
  const reportProgress = (nextPercent, nextPhase, nextMessage, state = "busy") => {
    percent = Math.max(0, Math.min(99, Number(nextPercent) || 0));
    phase = String(nextPhase || phase);
    message = String(nextMessage || message).slice(0, 200);
    writeStatus({ state, phase, percent, message });
  };
  const answer = (accepted, state, reason = "") => onAccepted({
    ok: accepted,
    accepted,
    action: "download_and_install_update",
    event: "complete",
    state,
    phase: accepted ? "starting" : state,
    percent: accepted ? 1 : 0,
    message: accepted ? "更新任务已交由后台处理，页面可关闭并稍后查看状态。" : "更新任务未能启动。",
    reason: reason || undefined,
    transactionId: nonce,
    verified: false,
    recoveryBlocked: state === "unknown",
    platform: "macos-arm64",
    security: { credentialsReturned: false },
  });
  try {
    const before = await store.getStatus({ ignoreRequestNonce: request.nonce });
    if (before.state === "unknown" || before.recoveryBlocked) {
      answer(false, "unknown", before.reason || "UPDATE_RECOVERY_REQUIRED");
      return publicStatus({ ...before, action: "download_and_install_update" });
    }
    if (ACTIVE.has(before.state)) {
      answer(false, "busy", "UPDATE_ALREADY_RUNNING");
      return publicStatus({ ...before, action: "download_and_install_update" });
    }
    lock = await store.acquire();
    const installerRecoveryReason = unresolvedInstallerReason(updatesRoot, installRoot);
    if (installerRecoveryReason) {
      answer(false, "unknown", installerRecoveryReason);
      return { ok: false, state: "unknown", reason: installerRecoveryReason, recoveryBlocked: true, transactionId: nonce };
    }
    const previous = store.readJournal();
    if (previous?.invalid || (previous && (!TERMINAL.has(previous.state) || previous.verified !== true))) {
      answer(false, "unknown", "UPDATE_RECOVERY_REQUIRED");
      return { ok: false, state: "unknown", reason: "UPDATE_RECOVERY_REQUIRED", recoveryBlocked: true };
    }
    store.write(nonce, {
      state: "starting", phase: "preflight", percent: 1,
      message: "正在核对更新事务与本机环境…", verified: false,
      updateSha256: request.update.sha256,
      assetName: request.update.assetName,
      diagnostics: { installerStarted: false },
    }, { create: true });
    transactionCreated = true;
    answer(true, "starting");
    heartbeat = setInterval(() => {
      try { writeStatus({ state: phase === "installing" ? "installing" : "busy", phase, percent, message }); }
      catch (error) { failJournal(error); }
    }, options.heartbeatMs || HEARTBEAT_MS);

    if (!fs.existsSync(installRoot) || fs.lstatSync(installRoot).isSymbolicLink()) throw new Error("UPDATE_EXTENSION_PATH_REQUIRED");
    const nativeRoot = path.join(installRoot, "native-helper");
    const config = updater.readJson(path.join(nativeRoot, "runtime-config.json"));
    const current = updater.readJson(path.join(installRoot, "extension", "version.json"));
    const contract = updater.readJson(path.join(installRoot, "extension", "runtime-compat.json"));
    const currentManifest = updater.readJson(path.join(installRoot, "extension", "manifest.json"));
    for (const component of ["extension", "native-helper", "python", "runtime", "skills"]) {
      const componentPath = path.join(installRoot, component);
      if (fs.existsSync(componentPath) && fs.lstatSync(componentPath).isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
    }
    if (updater.extensionIdFromKey(currentManifest.key) !== updater.EXTENSION_ID
      || config.toolboxExtensionId !== updater.EXTENSION_ID || config.nativeHostName !== updater.NATIVE_HOST) {
      throw new Error("UPDATE_EXTENSION_PATH_REQUIRED");
    }
    baseline = { productVersion: String(current.productVersion || ""), buildNumber: Number(current.buildNumber || 0) };
    pythonBootstrap = updater.checkPythonRuntime(installRoot, runFileSync);
    const checked = options.checkUpdate || require("./update_checker.js").checkGithubUpdate;
    const latest = await checked({
      repository: "zer0-lyz/appraisal-toolbox-releases",
      currentVersion: current.productVersion,
      currentBuildNumber: current.buildNumber,
      currentRuntimeBuildId: contract.runtimeBuildId,
      currentRuntimeBuildKind: contract.runtimeBuildKind,
      platform: "darwin",
      architecture: "arm64",
    });
    assertJournalHealthy();
    if (!latest?.ok) throw new Error(latest?.reason || "UPDATE_CHECK_FAILED");
    if (!latest.releasePublished || latest.platform !== "macos-arm64"
      || (!latest.updateAvailable && !latest.repairRequired)) throw new Error("UPDATE_NOT_REQUIRED");
    const targetBuild = Number(latest.latestBuildNumber || 0);
    const comparison = updater.compareVersions(latest.latestVersion, current.productVersion);
    if (comparison < 0 || (comparison === 0 && targetBuild < Number(current.buildNumber || 0))
      || !Number.isSafeInteger(targetBuild) || targetBuild < 1) throw new Error("UPDATE_TARGET_CHANGED");
    const targetSha = String(latest.asset?.sha256 || "").replace(/^sha256:/i, "").toLowerCase();
    const targetSize = Number(latest.asset?.size || 0);
    if (!/^[a-f0-9]{64}$/.test(targetSha)) throw new Error("UPDATE_SHA256_MISSING");
    if (targetSha !== request.update.sha256) throw new Error("UPDATE_TARGET_CHANGED");
    if (!Number.isSafeInteger(targetSize) || targetSize <= 0
      || (request.update.sizeBytes > 0 && request.update.sizeBytes !== targetSize)) throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
    const candidates = [...new Map([
      ...(Array.isArray(latest.downloadCandidates) ? latest.downloadCandidates : []),
      latest.asset || {},
    ].filter((candidate) => candidate?.url).map((candidate) => [updater.allowedAssetUrl(candidate.url).href, candidate])).values()]
      .slice(0, MAX_DOWNLOAD_CANDIDATES);
    const requestedUrl = updater.allowedAssetUrl(request.update.url).href;
    if (!candidates.some((candidate) => updater.allowedAssetUrl(candidate.url).href === requestedUrl)) throw new Error("UPDATE_TARGET_CHANGED");
    reportProgress(1, "preflight", "官方发布记录与本机环境已核对。", "busy");

    fs.mkdirSync(updateDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(extractRoot, { recursive: true, mode: 0o700 });
    let downloaded = false;
    let downloadFailure = null;
    const download = options.downloadAsset || updater.downloadAsset;
    const attempts = Math.max(1, Math.min(3, Number(options.downloadAttempts) || 3));
    const retryDelay = Math.max(0, Math.min(30000, Number(options.retryDelayMs) || 750));
    const downloadDeadline = Date.now() + Math.max(1000, Math.min(TOTAL_DOWNLOAD_BUDGET_MS, Number(options.totalDownloadBudgetMs) || TOTAL_DOWNLOAD_BUDGET_MS));
    for (const candidate of candidates) {
      const candidateUrl = updater.allowedAssetUrl(candidate.url).href;
      let succeeded = false;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const remainingBudget = downloadDeadline - Date.now();
          if (remainingBudget <= 0) throw new Error("UPDATE_DOWNLOAD_TIMEOUT");
          reportProgress(2, "downloading", "正在下载官方 macOS 安装包…", "busy");
          await download(candidateUrl, zipPath, targetSize, targetSha, (bytes) => {
            const value = Math.min(58, 2 + (bytes / targetSize) * 56);
            if (Math.floor(value) > Math.floor(percent)) reportProgress(value, "downloading", "正在下载更新包…", "busy");
          }, remainingBudget);
          assertJournalHealthy();
          succeeded = true;
          downloaded = true;
          break;
        } catch (error) {
          downloadFailure = error;
          try { fs.rmSync(zipPath, { force: true }); } catch { /* preserve original error */ }
          if (Date.now() >= downloadDeadline || !updater.isRetryableDownloadError(error) || attempt >= attempts) break;
          reportProgress(2, "downloading", `下载连接中断，正在重试（${attempt + 1}/${attempts}）…`, "busy");
          await (options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(retryDelay * attempt);
        }
      }
      if (succeeded) break;
    }
    if (!downloaded) throw downloadFailure || new Error("UPDATE_DOWNLOAD_CHANNELS_FAILED");
    if (fs.statSync(zipPath).size !== targetSize || await updater.digestFile(zipPath) !== targetSha) {
      throw new Error("UPDATE_DOWNLOAD_SHA256_MISMATCH");
    }
    // Only a manifest-matched official archive may lose Chrome download quarantine before ditto propagates it.
    updater.clearVerifiedArchiveQuarantine(zipPath, runFileSync);
    reportProgress(60, "verifying", "正在校验下载包和内部文件清单…", "busy");
    reportProgress(68, "extracting", "正在安全暂存更新包…", "busy");
    await (options.extractZip || updater.extractZip)(zipPath, extractRoot);
    assertJournalHealthy();
    const packageRoot = updater.findPackageRoot(extractRoot);
    const packageDetails = await updater.validatePackage(packageRoot, latest, runFileSync);
    assertJournalHealthy();
    reportProgress(78, "installing", "正在安装组件、Python 依赖并登记 Chrome / Edge Native Host…", "installing");
    const env = updater.installerEnvironment(process.env, { homeDir, installRoot, pythonBootstrap });
    Object.assign(env, options.testInstallerEnvironment || {});
    Object.assign(env, {
      APPRAISAL_UPDATE_MODE: "worker",
      APPRAISAL_UPDATE_NONCE: nonce,
      APPRAISAL_UPDATE_WORKER_JOURNAL: store.journalPath,
      APPRAISAL_UPDATE_INSTALLER_JOURNAL: installerJournalPath,
      APPRAISAL_UPDATE_LOCK_PYTHON: lockPython,
    });
    const startInstaller = options.installPackage || (async ({ installerPath, packageRoot: root, logPath: output, env: installerEnv, onStarted }) => {
      const fd = fs.openSync(output, "wx", 0o600);
      try {
        return await updater.runProcess("/bin/bash", [installerPath], {
          cwd: root, env: installerEnv, stdio: ["ignore", fd, fd],
        }, updater.INSTALL_TIMEOUT_MS, spawnProcess, onStarted);
      } finally { fs.closeSync(fd); }
    });
    await startInstaller({
      installerPath: packageDetails.installerPath,
      packageRoot,
      logPath,
      env,
      onStarted: (child) => {
        installerChild = child;
        installerStarted = true;
        writeStatus({ state: "installing", phase: "installing", percent: 80, message: "安装器已启动，正在配置运行组件…", installerPid: Number(child.pid) || null });
      },
    });
    assertJournalHealthy();
    installerChild = null;
    const { journal } = readInstallerTransaction(options, installerJournalPath, nonce, installRoot);
    if (!journal.originalFingerprint || !journal.snapshotRoot || !journal.manifestBackupRoot
      || !journal.backupRoot || !journal.stagingRoot) throw new Error("UPDATE_INSTALLER_JOURNAL_INVALID");
    reportProgress(94, "verifying_install", "正在核验扩展版本、Native Host 与运行环境…", "installing");
    const installed = (options.verifyInstalled || updater.verifyInstalled)({
      installRoot,
      homeDir,
      packageDetails,
      pythonBootstrap: path.join(installRoot, "python", "bin", "python3"),
      runFileSync,
      verificationEnvironment: options.verificationEnvironment || {},
    });
    assertJournalHealthy();
    if (!installed || typeof installed !== "object") throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
    finalState = "complete";
    patch = {
      phase: "complete", percent: 100,
      message: "更新安装与组件核验完成。",
      verified: true, recoveryBlocked: false, currentVersionUnchanged: false,
      platform: "macos-arm64", latestVersion: installed.productVersion,
      latestBuildNumber: installed.buildNumber,
      diagnostics: { installerStarted: true, failureStage: "" },
    };
    result = publicStatus({ ok: true, state: "complete", ...patch, transactionId: nonce, platform: "macos-arm64" });
    try { fs.rmSync(zipPath, { force: true }); } catch { /* preserve verified install */ }
    try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* preserve verified install */ }
  } catch (error) {
    const rawReason = String(error?.message || "UPDATE_FAILED");
    const reason = /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(rawReason) ? rawReason : "UPDATE_FAILED";
    let verifiedRollback = false;
    if (transactionCreated && installerStarted) {
      try {
        const { helper, journal } = readInstallerTransaction(options, installerJournalPath, nonce, installRoot);
        const rollback = await helper.recoverInstallation({
          journalPath: installerJournalPath,
          root: installRoot,
          snapshotRoot: journal.snapshotRoot,
          manifestBackupRoot: journal.manifestBackupRoot,
          manifestPaths,
          expectedFingerprint: journal.originalFingerprint,
          nonce,
          canonicalRoot: installRoot,
          installerPid: journal.installerPid,
          processGroupId: journal.installerProcessGroupId,
          timeoutMs: Math.max(1000, Math.min(5000, Number(options.recoveryTimeoutMs) || 5000)),
          allowVerifiedCompleteRollback: true,
          reason: rawReason,
        });
        verifiedRollback = rollback?.state === "rolled_back" && rollback.verified === true
          && checkBaseline({ installRoot, homeDir, baseline, pythonBootstrap, runFileSync, verificationEnvironment: options.verificationEnvironment || {} });
      } catch { verifiedRollback = false; }
    } else if (transactionCreated && baseline) {
      verifiedRollback = checkBaseline({
        installRoot, homeDir, baseline, pythonBootstrap, runFileSync,
        verificationEnvironment: options.verificationEnvironment || {},
      });
    }
    if (transactionCreated && verifiedRollback) {
      finalState = installerStarted ? "rolled_back" : "failed_safe";
      patch = {
        phase: finalState,
        percent: 100,
        reason: installerStarted
          ? (reason === "UPDATE_PROCESS_TIMEOUT" ? "UPDATE_PROCESS_TIMEOUT_ROLLED_BACK" : "UPDATE_INSTALLER_ROLLED_BACK")
          : reason,
        message: installerStarted ? "安装未完成，已核验旧版本恢复，可以安全重试。" : "更新未完成；本机原版本和自检均已核验，可以安全重试。",
        verified: true, recoveryBlocked: false, currentVersionUnchanged: true,
        platform: "macos-arm64", latestVersion: baseline.productVersion, latestBuildNumber: baseline.buildNumber,
        diagnostics: { installerStarted, failureStage: installerStarted ? "install" : phase },
      };
      result = publicStatus({ ok: false, state: finalState, ...patch, transactionId: nonce, platform: "macos-arm64" });
      try { fs.rmSync(zipPath, { force: true }); } catch { /* retain the diagnostic directory */ }
      try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* retain the diagnostic directory */ }
    } else {
      finalState = transactionCreated ? "unknown" : null;
      patch = transactionCreated ? {
        phase: "recovery", percent,
        reason: installerStarted ? "UPDATE_INSTALLER_ROLLBACK_FAILED" : (baseline ? reason : "UPDATE_RECOVERY_REQUIRED"),
        message: "更新结果未能核验；请保留本机更新记录，系统已阻止重复安装。",
        verified: false, recoveryBlocked: true, currentVersionUnchanged: null,
        diagnostics: { installerStarted, failureStage: installerStarted ? "recovery" : phase },
      } : null;
      result = publicStatus({ ok: false, state: finalState || "unknown", ...patch, reason: patch?.reason || reason, transactionId: transactionCreated ? nonce : undefined, recoveryBlocked: transactionCreated });
    }
    if (!transactionCreated) answer(false, reason === "UPDATE_ALREADY_RUNNING" ? "busy" : "unknown", reason);
  } finally {
    clearInterval(heartbeat);
    if (heartbeatStopTimer) clearTimeout(heartbeatStopTimer);
    let pendingTerminalWritten = false;
    if (transactionCreated && finalState && patch) {
      try {
        store.write(nonce, {
          ...patch,
          state: finalState,
          verified: false,
          recoveryBlocked: true,
          phase: finalState === "unknown" ? "recovery" : "finalizing",
        });
        pendingTerminalWritten = true;
      } catch {
        result = publicStatus({ ok: false, state: "unknown", phase: "recovery", reason: "UPDATE_LOCK_STATE_INVALID", verified: false, recoveryBlocked: true, transactionId: nonce });
      }
    }
    let released = true;
    if (lock) {
      try { released = await lock.release(); } catch { released = false; }
    }
    if (!released && transactionCreated) {
      finalState = "unknown";
      patch = {
        phase: "recovery", percent,
        reason: "UPDATE_LOCK_RELEASE_FAILED",
        message: "更新锁释放未获确认；请保留现场，系统已阻止重复安装。",
        verified: false, recoveryBlocked: true, currentVersionUnchanged: null,
        diagnostics: { installerStarted, failureStage: "lock_release" },
      };
      try { store.write(nonce, { ...patch, state: "unknown" }); } catch { /* the active or pending journal remains fail-closed */ }
      result = publicStatus({ ok: false, state: "unknown", ...patch, transactionId: nonce, platform: "macos-arm64" });
    } else if (transactionCreated && finalState && patch && pendingTerminalWritten && patch.verified === true) {
      try {
        store.write(nonce, { ...patch, state: finalState });
      } catch {
        result = publicStatus({ ok: false, state: "unknown", phase: "recovery", reason: "UPDATE_LOCK_STATE_INVALID", verified: false, recoveryBlocked: true, transactionId: nonce });
      }
    } else if (transactionCreated && !pendingTerminalWritten && result?.state !== "unknown") {
      result = publicStatus({ ok: false, state: "unknown", phase: "recovery", reason: "UPDATE_LOCK_STATE_INVALID", verified: false, recoveryBlocked: true, transactionId: nonce });
    }
  }
  return result || publicStatus({ ok: false, state: "unknown", reason: "UPDATE_START_STATUS_UNKNOWN", verified: false, recoveryBlocked: true, transactionId: nonce });
}

async function runWorkerRequestFile(requestPath, options = {}) {
  const resolvedRequestPath = path.resolve(String(requestPath || ""));
  let nonce = "";
  const ackPath = `${resolvedRequestPath}.ack.json`;
  let ackWritten = false;
  const writeAck = (value) => {
    if (ackWritten) return;
    atomicWriteJson(ackPath, value);
    ackWritten = true;
    try { fs.rmSync(resolvedRequestPath, { force: true }); } catch { /* transaction status remains authoritative */ }
  };
  try {
    const raw = JSON.parse(fs.readFileSync(resolvedRequestPath, "utf8"));
    nonce = String(raw?.nonce || "");
    const request = validateRequest(raw, { homeDir: options.homeDir || os.homedir(), requestPath: resolvedRequestPath });
    const result = await runMacOSUpdateTransaction(request, {
      ...options,
      homeDir: options.homeDir || os.homedir(),
      updatesRoot: request.updatesRoot,
      onAccepted: writeAck,
    });
    if (!ackWritten) writeAck({ ok: false, accepted: false, transactionId: nonce, reason: result?.reason || "UPDATE_START_STATUS_UNKNOWN", state: result?.state || "unknown", verified: false });
    return result;
  } catch (error) {
    const reason = /^(?:UPDATE_[A-Z0-9_]+)$/.test(String(error?.message || "")) ? error.message : "UPDATE_REQUEST_INVALID";
    if (!ackWritten) writeAck({ ok: false, accepted: false, transactionId: UUID_PATTERN.test(nonce) ? nonce : undefined, reason, state: "unknown", verified: false, recoveryBlocked: true });
    return { ok: false, state: "unknown", reason, recoveryBlocked: true, transactionId: UUID_PATTERN.test(nonce) ? nonce : undefined };
  }
}

if (require.main === module) {
  const index = process.argv.indexOf("--request");
  const requestPath = index >= 0 ? process.argv[index + 1] : "";
  const homeDir = os.homedir();
  const installRoot = path.join(homeDir, ".appraisal-toolbox");
  const bootstrap = path.join(installRoot, "python", "bin", "python3");
  const runFileSync = execFileSync;
  let pythonBin = "";
  const lockEnvironment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: homeDir };
  try {
    pythonBin = resolveLockPython(installRoot, bootstrap, runFileSync);
    lockEnvironment.DYLD_FRAMEWORK_PATH = updater.frameworkSearchPathForPython(pythonBin);
  } catch { pythonBin = ""; /* worker records a safe start failure */ }
  runWorkerRequestFile(requestPath, { pythonBin, lockEnvironment })
    .then((result) => { process.exitCode = result?.state === "unknown" ? 1 : 0; })
    .catch(() => { process.exitCode = 1; });
}

module.exports = {
  MAX_DOWNLOAD_CANDIDATES,
  TOTAL_DOWNLOAD_BUDGET_MS,
  WORKER_BUDGET_MS,
  publicStatus,
  runMacOSUpdateTransaction,
  runWorkerRequestFile,
  validateRequest,
};
