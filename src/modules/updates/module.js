const LEGACY_STORAGE_KEY = "appraisalToolboxUpdateResult";
// 工具箱使用独立发布仓库；清单未发布前检查会显式失败，绝不回落到主工作台的发布清单。
const TOOLBOX_UPDATE_REPOSITORY = "zer0-lyz/appraisal-toolbox-releases";
const TOOLBOX_UPDATE_MANIFEST_URLS = [
  "https://gitee.com/zer0_y/appraisal-toolbox-releases/raw/master/update-manifest.json",
  "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/latest/download/update-manifest.json",
];
// 更新界面和协议两端共用；Native Helper 按平台加载独立安装适配器。
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_TIMER_MS = 30 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_BUDGET_MS = 75 * 60 * 1000;
const STATUS_REQUEST_TIMEOUT_MS = 12000;
const RELOAD_MARKER_KEY = "appraisalToolboxUpdateReloadedTransactionId";
const STATUS_CAPABILITY_KEY = "appraisalToolboxUpdateStatusCapability";
const LEGACY_UPDATE_BLOCKING_REASONS = new Set([
  "NATIVE_STREAM_IDLE_TIMEOUT",
  "UPDATE_PROCESS_TERMINATION_UNCONFIRMED",
  "UPDATE_PROCESS_RECOVERY_FAILED",
  "UPDATE_INSTALLER_ROLLBACK_FAILED",
  "UPDATE_COMPLETION_STATUS_MISSING",
  "UPDATE_LOCK_RELEASE_FAILED",
  "UPDATE_LOCK_OWNER_UNVERIFIED",
  "UPDATE_LOCK_STATE_WRITE_FAILED",
  "UPDATE_LOCK_ARBITRATION_FAILED",
  "UPDATE_LOCK_ARBITRATION_ABANDONED",
  "UPDATE_LOCK_OWNERSHIP_CHANGED",
  "UPDATE_RECOVERY_REQUIRED",
  "UPDATE_ALREADY_RUNNING",
]);

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function safeReleaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const githubReleasePath = /^\/zer0-lyz\/appraisal-toolbox-releases\/releases(?:\/(?:latest|tag\/[^/]+|download\/[^/]+(?:\/[^/]+)?))?\/?$/i;
    const githubApiPath = /^\/repos\/zer0-lyz\/appraisal-toolbox-releases\/releases(?:\/(?:latest|assets\/\d+|\d+))?\/?$/i;
    const giteeReleasePath = /^\/zer0_y\/appraisal-toolbox-releases\/releases(?:\/(?:latest|tag\/[^/]+|download\/[^/]+(?:\/[^/]+)?))?\/?$/i;
    const githubAssetHost = url.hostname === "objects.githubusercontent.com"
      || url.hostname === "release-assets.githubusercontent.com";
    const allowed = (url.hostname === "github.com" && githubReleasePath.test(url.pathname))
      || (url.hostname === "api.github.com" && githubApiPath.test(url.pathname))
      || (url.hostname === "gitee.com" && giteeReleasePath.test(url.pathname))
      || (githubAssetHost && url.pathname !== "/");
    if (!allowed) return "";
    // Release manifests point releaseUrl at /releases/download/<tag>, which 404s
    // without an asset name. The browsable page lives at /releases/tag/<tag>.
    // Bare download URLs only; asset URLs keep their filename suffix.
    const bareDownload = url.pathname.match(
      /^\/(zer0-lyz)\/(appraisal-toolbox-releases)\/releases\/download\/([^/]+)\/?$/i,
    );
    if (bareDownload) {
      url.pathname = `/${bareDownload[1]}/${bareDownload[2]}/releases/tag/${bareDownload[3]}`;
    }
    return url.href;
  } catch {
    return "";
  }
}

function cacheMatchesRuntime(result, config, contract) {
  if (!result) return true;
  const currentVersion = config.productVersion
    || config.versionName
    || config.chromeVersion
    || "";
  return String(result.currentVersion || "") === String(currentVersion)
    && Number(result.currentBuildNumber || 0) === Number(config.buildNumber || 0)
    && String(result.currentRuntimeBuildId || "") === String(contract?.runtimeBuildId || "")
    && String(result.currentRuntimeBuildKind || "release")
      === String(contract?.runtimeBuildKind || "release");
}

function elementMap(documentRef) {
  const ids = [
    "openUpdatesTop",
    "updateTopStatus",
    "backFromUpdates",
    "updateHeadline",
    "updateDescription",
    "updateBadge",
    "updateCurrentVersion",
    "updateLatestVersion",
    "updateChannel",
    "updateBuildNumber",
    "updatePlatform",
    "updateCheckedAt",
    "updateFeedback",
    "updatePrimaryAction",
        "updateMoreActions",
        "updateNotesDetails",
        "updateNotesRemainingDetails",
        "updateNotesRemaining",
        "updateTechnicalDetails",
    "downloadUpdate",
    "openReleasePage",
    "updateProgressPanel",
    "updateProgressBar",
    "updateProgressText",
    "updateNotes",
    "updateAssetName",
    "updateAssetSize",
    "updateAssetSha",
    "copyUpdateDiagnostics",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

export const updatesModule = {
  manifest: {
    id: "updates",
    type: "utility",
    stage: "stable",
    route: "updates",
    displayName: "版本更新",
    messageNamespace: "updates",
    entryElementId: "openUpdatesTop",
    pageElementId: "page-updates",
    storageVersion: 1,
    countInModuleBadge: false,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let checking = false;
    let autoUpdating = false;
    let recoveryBlocked = false;
    let latestResult = null;
    let versionConfig = null;
    let runtimeContract = null;
    let operationStatus = null;
    let updateStatusSupported = false;
    let resumedStatusOperation = false;
    let statusPollPromise = null;
    let reloadRequestedTransactionId = "";

    function sleep(delay) {
      return new Promise((resolve) => window.setTimeout(resolve, delay));
    }

    function isActiveUpdateState(state) {
      return ["starting", "busy", "installing", "recovering"].includes(String(state || ""));
    }

    function statusHeartbeat(startedAt, status = null) {
      const minutes = Math.max(1, Math.floor((Date.now() - startedAt) / 60000));
      const stage = status?.message || progressMessage(status);
      const current = stage && stage !== "等待开始" ? stage : "后台更新仍在运行";
      return `${current}（本次状态读取已持续 ${minutes} 分钟，仍在持续读取后台阶段与恢复状态…）`;
    }

    async function getStatusCapabilityMarker() {
      const local = context.chrome?.storage?.local;
      if (!local?.get) return null;
      return new Promise((resolve) => {
        try {
          local.get([STATUS_CAPABILITY_KEY], (values) => resolve(values?.[STATUS_CAPABILITY_KEY] || null));
        } catch {
          resolve(null);
        }
      });
    }

    async function saveStatusCapabilityMarker(result) {
      const local = context.chrome?.storage?.local;
      if (!local?.set) return;
      const platform = String(result?.platform || "");
      const marker = {
        platform,
        updateStatusSupported: platform === "macos-arm64" && result?.updateStatusSupported === true,
      };
      await new Promise((resolve) => {
        try { local.set({ [STATUS_CAPABILITY_KEY]: marker }, resolve); }
        catch { resolve(); }
      });
    }

    async function getReloadMarker() {
      const local = context.chrome?.storage?.local;
      if (!local?.get) return reloadRequestedTransactionId;
      return new Promise((resolve) => {
        try {
          local.get([RELOAD_MARKER_KEY], (values) => {
            resolve(String(values?.[RELOAD_MARKER_KEY] || reloadRequestedTransactionId));
          });
        } catch {
          resolve(reloadRequestedTransactionId);
        }
      });
    }

    async function setReloadMarker(transactionId) {
      const local = context.chrome?.storage?.local;
      if (!local?.set) {
        reloadRequestedTransactionId = transactionId;
        return true;
      }
      return new Promise((resolve) => {
        try {
          local.set({ [RELOAD_MARKER_KEY]: transactionId }, () => {
            reloadRequestedTransactionId = transactionId;
            resolve(true);
          });
        } catch {
          resolve(false);
        }
      });
    }

    async function reloadAfterVerifiedUpdate(transactionId) {
      if (typeof context.chrome?.runtime?.reload !== "function") return false;
      if (!transactionId) {
        elements.updateFeedback.textContent = "安装结果已核验，请在扩展管理页重新加载评估工具箱。";
        return false;
      }
      if (await getReloadMarker() === transactionId) return false;
      if (!await setReloadMarker(transactionId)) {
        elements.updateFeedback.textContent = "安装结果已核验，请在扩展管理页重新加载评估工具箱。";
        return false;
      }
      elements.updateFeedback.textContent = "安装结果已核验，正在重新加载评估工具箱扩展。";
      window.setTimeout(() => {
        try {
          context.chrome.runtime.reload();
        } catch {
          elements.updateFeedback.textContent = "组件已更新，请在扩展管理页重新加载评估工具箱。";
        }
      }, 900);
      return true;
    }

    async function applyUpdateStatus(status, { allowReload = false } = {}) {
      const state = String(status?.state || "unknown");
      operationStatus = { ...status, normalizedPhase: status?.phase || state };
      renderProgress(operationStatus);

      if (isActiveUpdateState(state)) {
        resumedStatusOperation = true;
        recoveryBlocked = false;
        render(latestResult);
        elements.updateBadge.textContent = "更新处理中";
        elements.updateFeedback.textContent = status?.message || progressMessage(operationStatus);
        elements.updateFeedback.dataset.kind = "warn";
        setTopStatus("更新处理中", "warn");
        return "active";
      }

      if (state === "idle" && status?.recoveryBlocked !== true) {
        resumedStatusOperation = false;
        recoveryBlocked = false;
        render(latestResult);
        return "idle";
      }

      if (state === "complete" && status?.verified === true) {
        resumedStatusOperation = false;
        recoveryBlocked = false;
        render(latestResult);
        elements.updateHeadline.textContent = "自动更新已完成";
        elements.updateBadge.textContent = "已完成";
        elements.updateFeedback.textContent = "安装结果已核验，工具箱组件已更新。";
        elements.updateFeedback.dataset.kind = "ok";
        renderProgress({ ...status, phase: "complete", percent: 100 });
        setTopStatus("更新完成", "ok");
        context.setStatus("一键更新完成：安装结果已核验。", "ok");
        if (allowReload) await reloadAfterVerifiedUpdate(String(status.transactionId || ""));
        return "complete";
      }

      if (["rolled_back", "failed_safe"].includes(state) && status?.verified === true) {
        resumedStatusOperation = false;
        recoveryBlocked = false;
        render(latestResult);
        const reason = status.reason || (state === "failed_safe" ? "UPDATE_FAILED_SAFE" : "UPDATE_INSTALLER_ROLLED_BACK");
        elements.updateBadge.textContent = "更新未完成";
        elements.updateFeedback.textContent = updateFailureText(reason);
        elements.updateFeedback.dataset.kind = "error";
        renderProgress({ ...status, phase: "failed" });
        setTopStatus("更新未完成，可重试", "warn");
        context.setStatus(`一键更新未完成：${updateFailureText(reason)}`, "error");
        return state;
      }

      resumedStatusOperation = false;
      recoveryBlocked = true;
      render(latestResult);
      const reason = status?.reason || "UPDATE_STATUS_UNCONFIRMED";
      elements.updateBadge.textContent = "更新状态待核验";
      elements.updateFeedback.textContent = updateFailureText(reason);
      elements.updateFeedback.dataset.kind = "error";
      renderProgress({ ...status, state: "unknown", phase: "failed", reason });
      setTopStatus("状态待核验", "error");
      context.setStatus(`更新状态待核验：${updateFailureText(reason)}`, "error");
      return "unknown";
    }

    async function pollUpdateStatus({ waitForTerminal = false, allowReload = false } = {}) {
      if (!updateStatusSupported) return "unsupported";
      if (statusPollPromise) return statusPollPromise;
      statusPollPromise = (async () => {
        const startedAt = Date.now();
        let keepPolling = waitForTerminal;
        while (true) {
          let status;
          try {
            status = await context.sendNativeMessage(
              { action: "get_update_status" },
              STATUS_REQUEST_TIMEOUT_MS,
            );
          } catch {
            if (!keepPolling) {
              return await applyUpdateStatus({
                ok: false,
                action: "get_update_status",
                state: "unknown",
                phase: "unknown",
                reason: "UPDATE_STATUS_READ_FAILED",
                recoveryBlocked: true,
                verified: false,
              });
            }
            resumedStatusOperation = true;
            renderProgress({
              state: "starting",
              phase: "starting",
              message: statusHeartbeat(startedAt),
            });
            render(latestResult);
          }

          if (status) {
            if (status.action !== "get_update_status" || status.updateStatusSupported !== true) {
              return await applyUpdateStatus({
                ok: false,
                action: "get_update_status",
                state: "unknown",
                phase: "unknown",
                reason: "UPDATE_STATUS_READ_FAILED",
                recoveryBlocked: true,
                verified: false,
              });
            }
            const outcome = await applyUpdateStatus(status, { allowReload });
            if (outcome === "active") {
              keepPolling = true;
              elements.updateFeedback.textContent = statusHeartbeat(startedAt, status);
            }
            else if (outcome === "idle" && keepPolling) {
              resumedStatusOperation = true;
              render(latestResult);
              renderProgress({ state: "starting", phase: "starting", message: statusHeartbeat(startedAt) });
            } else return outcome;
          }

          if (!keepPolling) return "idle";
          if (Date.now() - startedAt >= STATUS_POLL_BUDGET_MS) break;
          await sleep(STATUS_POLL_INTERVAL_MS);
        }
        return await applyUpdateStatus({
          ok: false,
          action: "get_update_status",
          state: "unknown",
          phase: "unknown",
          reason: "UPDATE_STATUS_UNCONFIRMED",
          message: "后台更新状态在等待期限内仍未核验。",
          recoveryBlocked: true,
          verified: false,
        });
      })().finally(() => { statusPollPromise = null; });
      return statusPollPromise;
    }

    function currentVersion() {
      return (versionConfig?.productVersion
        || context?.extensionManifest?.version_name
        || context?.extensionManifest?.version
        || "-");
    }

    function diagnosticSummary(status = operationStatus, result = latestResult) {
      const attempts = Array.isArray(status?.channelAttempts)
        ? status.channelAttempts.map((attempt) => ({
          id: String(attempt?.id || "").slice(0, 80),
          source: String(attempt?.source || "").slice(0, 40),
          status: String(attempt?.status || "").slice(0, 30),
          attempts: Number(attempt?.attempts || 0),
        }))
        : [];
      return JSON.stringify({
        product: "评估工具箱",
        currentVersion: String(currentVersion()),
        latestVersion: String(result?.latestVersion || ""),
        platform: String(result?.platform || ""),
        phase: String(status?.phase || result?.phase || "idle"),
        stage: String(status?.stage || result?.stage || ""),
        errorCode: String(status?.reason || status?.errorCode || result?.errorCode || result?.reason || ""),
        currentVersionUnchanged: status?.currentVersionUnchanged === true
          ? true
          : (status?.currentVersionUnchanged === false ? false : null),
        diagnostics: status?.diagnostics && typeof status.diagnostics === "object"
          ? {
            installerStarted: status.diagnostics.installerStarted === true,
            failureStage: String(status.diagnostics.failureStage || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40),
          }
          : null,
        downloadChannel: String(status?.downloadChannel || result?.preferredDownloadChannel || ""),
        channelAttempts: attempts,
        checkedAt: String(result?.checkedAt || ""),
      }, null, 2);
    }

    function hasDownloadAsset(result = latestResult) {
      return Boolean(
        result?.asset?.url
        || (Array.isArray(result?.downloadCandidates) && result.downloadCandidates.some((candidate) => candidate?.url)),
      );
    }

    async function copyDiagnostics() {
      const text = diagnosticSummary();
      try {
        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
        await clipboard.writeText(text);
        if (elements.updateFeedback) {
          elements.updateFeedback.textContent = "已复制脱敏诊断摘要（不含路径、凭据或页面数据）";
          elements.updateFeedback.dataset.kind = "ok";
        }
        context.setStatus("已复制脱敏诊断摘要。", "ok");
      } catch {
        context.setStatus("当前页面不允许复制诊断摘要，请手动查看更新状态。", "warn");
      }
      return text;
    }

    function updateFailureText(reason, status = operationStatus) {
      if (status?.diagnostics?.failureCategory === "registration_context_rejected") {
        if (status?.diagnostics?.rollbackVerified === true || status?.currentVersionUnchanged === true) {
          return "安装器未通过本机环境核验，旧版本已恢复。可复制诊断详情后重试或联系技术支持。";
        }
        return "安装器未通过本机环境核验，旧版本状态尚未确认。请勿重复更新，复制诊断详情联系技术支持。";
      }
      const messages = {
        UPDATE_URL_INVALID: "更新地址无效，已停止处理。",
        UPDATE_URL_NOT_HTTPS: "更新地址未使用安全连接，已停止处理。",
        UPDATE_URL_HOST_NOT_ALLOWED: "更新地址不属于官方发布渠道，已停止处理。",
        UPDATE_SHA256_REQUIRED: "官方安装包缺少有效校验值，已停止安装。",
        UPDATE_DOWNLOAD_SHA256_MISMATCH: "安装包校验失败，已删除下载文件，请重试。",
        UPDATE_PACKAGE_FILE_MISSING: "安装包文件不完整，已停止安装。",
        UPDATE_STAGING_PATH_INVALID: "更新暂存路径不可用，请检查用户目录权限后重试。",
        UPDATE_DOWNLOAD_REDIRECTS_EXHAUSTED: "下载地址跳转过多，请使用其他官方通道。",
        UPDATE_TARGET_CHANGED: "发布记录发生变化，请重新检查更新。",
        UPDATE_PROCESS_TIMEOUT: "安装或解压超时，请查看安装日志并确认进程已结束。",
        UPDATE_PROCESS_TIMEOUT_ROLLED_BACK: "安装超过时限，已核验旧版本仍可用，可以稍后重试。",
        UPDATE_PROCESS_RECOVERY_FAILED: "安装超过时限，自动恢复未能核验；请保留诊断详情并联系技术支持。",
        UPDATE_PROCESS_TERMINATION_UNCONFIRMED: "更新进程未确认结束，已阻止再次安装，请查看诊断日志。",
        UPDATE_INSTALLER_ROLLED_BACK: "安装未完成，已核验旧版本与原插件目录仍可用，可以稍后重试。",
        UPDATE_INSTALLER_ROLLBACK_FAILED: "安装未完成，旧版本恢复状态无法核验；更新已锁定，请保留诊断详情并联系技术支持。",
        UPDATE_LOCK_RELEASE_FAILED: "更新锁归档或释放失败，现场已保留。请保留诊断详情并联系技术支持，暂不要再次更新。",
        UPDATE_LOCK_OWNER_UNVERIFIED: "无法确认上次更新事务状态，已保留锁和现场并阻止再次安装。当前安装状态尚未核验，请保留诊断详情并联系技术支持。",
        UPDATE_LOCK_STATE_WRITE_FAILED: "更新事务状态无法可靠写入，已停止自动更新并保留现场。请核对诊断详情，不要重复操作。",
        UPDATE_LOCK_ARBITRATION_FAILED: "无法确认跨进程更新锁状态，已停止更新并保留现场。请稍后重试；若仍失败，请保留诊断详情联系技术支持。",
        UPDATE_LOCK_ARBITRATION_ABANDONED: "检测到上次更新锁异常中断，事务状态尚未核验；已阻止再次安装。请保留诊断详情并联系技术支持。",
        UPDATE_LOCK_OWNERSHIP_CHANGED: "更新锁归属信息发生变化，已停止处理并保留现场。请保留诊断详情，不要重复更新。",
        UPDATE_LOCK_CREATE_FAILED: "更新暂存锁创建失败，当前版本未改变。请检查更新目录是否可写后重试。",
        APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED: "本地助手尚不支持此动作，请使用原桌面更新入口。",
        NATIVE_STREAM_IDLE_TIMEOUT: "更新响应超时，请查看诊断详情与安装日志。",
        UPDATE_NOT_REQUIRED: "当前已经是最新版本。",
        UPDATE_ASSET_NOT_FOUND: "未找到适用于当前系统的安装包。",
        UPDATE_SHA256_MISSING: "官方发布包缺少 SHA-256，已停止安装。",
        UPDATE_SHA256_INVALID: "官方校验文件格式无效，已停止安装。",
        UPDATE_SHA256_MISMATCH: "安装包校验失败，文件可能损坏，已停止安装。",
        UPDATE_INSTALLER_NOT_FOUND: "安装包中缺少安装程序，已停止安装。",
        UPDATE_DOWNLOAD_NETWORK_FAILED: "安装包下载网络连接失败，请检查网络后重试。",
        UPDATE_DOWNLOAD_CHANNELS_FAILED: "所有下载通道均失败，请检查网络或打开发布页手动下载。",
        UPDATE_PYTHON_RUNTIME_UNAVAILABLE: "当前 macOS 没有可复用且兼容的 Python 运行时，请运行完整 Mac 安装包修复。",
        UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED: "当前安装中的 Python 运行时版本或组件不符合要求，请用完整 Mac 安装包修复。",
        UPDATE_PREFLIGHT_FAILED: "更新环境预检未通过，请按提示修复后重试。",
        UPDATE_LOCK_LOST: "更新事务锁状态丢失，无法确认后台进程是否结束；已阻止重复安装。请保留诊断并联系技术支持。",
        LOCK_LOST: "更新事务锁状态丢失，无法确认后台进程是否结束；已阻止重复安装。请保留诊断并联系技术支持。",
        UPDATE_STATE_INVALID: "更新状态记录无效，事务结果未核验；已阻止重复安装。请保留诊断并联系技术支持。",
        STATE_INVALID: "更新状态记录无效，事务结果未核验；已阻止重复安装。请保留诊断并联系技术支持。",
        UPDATE_LOCK_STATE_INVALID: "更新状态记录无效，事务结果未核验；已阻止重复安装。请保留诊断并联系技术支持。",
        UPDATE_RUNTIME_UNAVAILABLE: "更新所需的锁定运行环境不可用，请使用完整安装包修复运行环境。",
        RUNTIME_UNAVAILABLE: "更新所需的锁定运行环境不可用，请使用完整安装包修复运行环境。",
        UPDATE_RECOVERY_REQUIRED: "安装结果仍需恢复核验，已阻止重复更新。请等待后台恢复后重新检查；若持续显示，请使用完整安装包修复。",
        RECOVERY_REQUIRED: "安装结果仍需恢复核验，已阻止重复更新。请等待后台恢复后重新检查；若持续显示，请使用完整安装包修复。",
        UPDATE_STATUS_READ_FAILED: "暂时无法读取后台更新状态，已阻止重复安装。请重新检查状态，必要时联系技术支持。",
        UPDATE_STATUS_UNCONFIRMED: "后台更新状态在等待期限内仍未核验，已阻止重复安装。请保留诊断并联系技术支持。",
        UPDATE_FAILED_SAFE: "安装未完成，但安全状态已核验，可以稍后重试。",
        UPDATE_WINDOWS_CONTEXT_UNVERIFIED: "Windows 安装上下文未能核验，安装已停止；请在普通桌面会话运行正式安装包。",
        UPDATE_DOWNLOAD_TIMEOUT: "安装包下载超时，请检查网络稳定性后重试。",
        UPDATE_CHECK_TIMEOUT: "更新源响应超时，当前版本可以继续使用，请稍后重试。",
        NATIVE_HELPER_TIMEOUT: "本机助手响应超时，请重新加载扩展并重新检查后台状态。",
        UPDATE_DOWNLOAD_SIZE_MISMATCH: "安装包大小与发布记录不一致，已停止处理。",
        UPDATE_FETCH_UNAVAILABLE: "本机 Node.js 运行时不支持下载，请更新本机运行组件。",
        UPDATE_INSTALLER_NOT_STARTED: "更新程序没有成功启动，请重试并查看诊断日志。",
        UPDATE_RUNNER_NOT_FOUND: "更新脚本没有成功启动，请重新加载扩展后重试。",
        UPDATE_PARENT_PROCESS_NOT_EXITED: "旧版本服务没有及时退出，已停止更新以保护当前版本。",
        UPDATE_FILE_LOCKED: "工具箱文件仍被占用，当前版本已保留；请关闭相关浏览器窗口后重试。",
        UPDATE_ALREADY_RUNNING: "已有更新正在执行，请等待当前更新结束。",
        UPDATE_COMPLETION_STATUS_MISSING: "安装程序未返回完成状态，请查看诊断日志确认当前安装状态。",
        WORKBENCH_UPDATE_TIMEOUT: "更新等待超时，当前版本已保留；请查看诊断日志后重试。",
        PLATFORM_UPDATE_UNSUPPORTED: "当前系统暂不支持一键更新。",
        UNKNOWN_ACTION: "当前 Native Helper 版本较旧，需要手动安装一次新版。",
      };
      if (String(reason || "").startsWith("UPDATE_DOWNLOAD_NETWORK_")) {
        const code = String(reason).slice("UPDATE_DOWNLOAD_NETWORK_".length);
        return "安装包下载网络连接失败，请检查网络后重试。";
      }
      if (String(reason || "").startsWith("UPDATE_PYTHON_RUNTIME_UNAVAILABLE")) {
        return messages.UPDATE_PYTHON_RUNTIME_UNAVAILABLE;
      }
      if (String(reason || "").startsWith("UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED")) {
        return messages.UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED;
      }
      if (reason === "UPDATE_EXTENSION_PATH_REQUIRED") {
        const platform = String(latestResult?.platform || "");
        if (platform === "windows-x64") {
          return "未找到原 Windows 插件目录或本机助手配置。请从原 Windows 安装目录修复或重新安装，然后重试。";
        }
        if (platform.startsWith("macos-")) {
          return "未找到原 Mac 插件目录或本机助手配置。请运行正式 Mac 完整安装包修复，然后重试。";
        }
        return "未找到当前平台的原插件目录或本机助手配置，请运行对应平台的完整安装包修复。";
      }
      if (String(reason || "").startsWith("UPDATE_DOWNLOAD_HTTP_")) {
        const code = String(reason).slice("UPDATE_DOWNLOAD_HTTP_".length);
        return "安装包下载失败，请打开发布页或稍后重试。";
      }
      if (String(reason || "").startsWith("UPDATE_PACKAGE_FILE_MISSING:")) {
        return "安装包文件不完整，已停止处理。";
      }
      if (String(reason || "").startsWith("UPDATE_INSTALLER_EXIT_")) {
        const code = String(reason).slice("UPDATE_INSTALLER_EXIT_".length);
        return "平台安装程序未完成，请查看诊断日志确认当前安装状态。";
      }
      return messages[reason] || "更新未完成，请复制诊断详情或查看安装日志。";
    }

    function progressMessage(status) {
      if (status?.message) return status.message;
      const phase = status?.normalizedPhase || status?.phase || status?.state;
      const labels = {
        checking: "正在检查更新源",
        preflight: "正在预检本机运行环境",
        downloading: "正在下载更新包",
        verifying: "正在校验更新包",
        extracting: "正在解压更新包",
        installing: "正在安装工具箱组件",
        verifying_install: "正在验证安装结果",
        starting: "正在启动后台更新",
        busy: "后台更新正在运行",
        recovering: "正在核验恢复状态",
        unknown: "后台更新状态待核验",
        rolled_back: "安装未完成，已核验恢复结果",
        failed_safe: "安装未完成，安全状态已核验",
        complete: "更新已核验完成",
        preparing: "正在准备更新",
        stopping_services: "正在停止旧版本服务",
        waiting_for_file_release: "正在等待文件释放",
        restarting_services: "正在重启服务",
        rollback: "正在恢复原版本",
      };
      return labels[phase] || (phase === "failed"
        ? updateFailureText(status.reason, status)
        : "等待开始");
    }

    function renderProgress(status = operationStatus) {
      if (status?.event === "complete") {
        const activeReceipt = status.accepted === true && isActiveUpdateState(status.state);
        const verifiedSuccess = status.state === "complete" && status.verified === true;
        if (activeReceipt) {
          status = { ...status, phase: status.phase || status.state || "starting" };
        } else if (updateStatusSupported && !verifiedSuccess) {
          status = { ...status, phase: status.phase || status.state || "unknown" };
        } else {
          status = { ...status, phase: status.ok ? "complete" : "failed", percent: status.ok ? 100 : status.percent };
        }
      }
      operationStatus = status;
      const normalizedPhase = status?.normalizedPhase || status?.phase || status?.state;
      const active = checking || resumedStatusOperation || (
        status
        && !["idle", "complete", "test_complete", "failed"].includes(normalizedPhase)
      );
      elements.updateProgressPanel.classList.toggle("hidden", !active && !status);
      elements.updateProgressBar.value = Math.max(0, Math.min(100, Number(status?.percent || 0)));
      elements.updateProgressText.textContent = progressMessage(status);
    }

    function setTopStatus(text, kind = "idle") {
      context.setConnection(elements.updateTopStatus, text, kind);
    }

    async function loadVersionContext() {
      if (!versionConfig) {
        versionConfig = await fetch(context.chrome.runtime.getURL("version.json"), {
          cache: "no-store",
        })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null) || {
          productVersion: context.extensionManifest.version_name
            || context.extensionManifest.version,
          chromeVersion: context.extensionManifest.version,
          channel: "stable",
          buildNumber: 0,
          bridgeProtocol: context.connectorProtocolVersion,
        };
      }
      if (!runtimeContract) {
        runtimeContract = await fetch(
          context.chrome.runtime.getURL("runtime-compat.json"),
          { cache: "no-store" },
        )
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
      }
      return { config: versionConfig, contract: runtimeContract };
    }

    function renderNotes(notes) {
      elements.updateNotes.innerHTML = "";
      const values = Array.isArray(notes) && notes.length
        ? notes
        : ["暂无更新说明"];
      const visibleValues = values.slice(0, 5);
      const remainingValues = values.slice(5);
      for (const value of visibleValues) {
        const item = context.document.createElement("li");
        item.textContent = String(value);
        elements.updateNotes.appendChild(item);
      }
      if (elements.updateNotesDetails) {
        const summary = elements.updateNotesDetails.querySelector?.("summary");
        if (summary) {
          summary.textContent = "本次更新说明";
        }
      }
      if (elements.updateNotesRemainingDetails) {
        const summaryText = `查看其余 ${remainingValues.length} 条`;
        elements.updateNotesRemainingDetails.hidden = remainingValues.length === 0;
        elements.updateNotesRemainingDetails.dataset.summaryText = summaryText;
        const summary = elements.updateNotesRemainingDetails.querySelector?.("summary");
        if (summary) summary.textContent = summaryText;
        if (elements.updateNotesRemaining) {
          elements.updateNotesRemaining.innerHTML = "";
          for (const value of remainingValues) {
            const item = context.document.createElement("li");
            item.textContent = String(value);
            elements.updateNotesRemaining.appendChild(item);
          }
        }
      }
    }

    function render(result = latestResult) {
      const config = versionConfig || {};
      const currentVersion = config.productVersion
        || context.extensionManifest.version_name
        || context.extensionManifest.version;
      const buildNumber = Number(config.buildNumber || 0);
      elements.updateCurrentVersion.textContent = `v${currentVersion}`;
      elements.updateBuildNumber.textContent = buildNumber ? String(buildNumber) : "-";
      elements.updateChannel.textContent = String(result?.channel || config.channel || "stable");
      elements.updateLatestVersion.textContent = result?.latestVersion
        ? `v${result.latestVersion}`
        : "-";
      elements.updatePlatform.textContent = result?.platform || "-";
      elements.updateCheckedAt.textContent = formatTime(result?.checkedAt);
      const candidates = Array.isArray(result?.downloadCandidates)
        ? result.downloadCandidates
        : [];
      const preferredCandidate = candidates.find((candidate) =>
        candidate?.source === result?.preferredDownloadChannel)
      || candidates[0]
      || null;
      const asset = result?.asset || {};
      elements.updateAssetName.textContent = asset.name || preferredCandidate?.name || "-";
      elements.updateAssetSize.textContent = formatBytes(asset.size || preferredCandidate?.size);
      elements.updateAssetSha.textContent = asset.sha256 || preferredCandidate?.sha256 || (
        result?.checksumAsset?.url ? "请使用同名 .sha256 文件校验" : "-"
      );
      renderNotes(result?.notes);

      const assetUrl = safeReleaseUrl(preferredCandidate?.url || result?.asset?.url);
      const releaseUrl = safeReleaseUrl(result?.releaseUrl);
      const operationBusy = autoUpdating || checking || resumedStatusOperation;
      if (elements.downloadUpdate) {
        elements.downloadUpdate.disabled = operationBusy || !assetUrl;
        elements.downloadUpdate.dataset.url = assetUrl;
      }
      if (elements.openReleasePage) {
        elements.openReleasePage.disabled = operationBusy || !releaseUrl;
        elements.openReleasePage.dataset.url = releaseUrl;
      }
      if (elements.updatePrimaryAction) {
        elements.updatePrimaryAction.disabled = operationBusy || recoveryBlocked;
        // 发现新版本/需修复时主按钮一键自动更新；其余场景保持检查行为。
        elements.updatePrimaryAction.textContent = result?.updateAvailable || result?.repairRequired
          ? (result.autoUpdateSupported === true ? "自动下载并更新" : "打开发布页")
          : "检查更新";
      }

      if (!result) {
        elements.updateHeadline.textContent = `评估工具箱 v${currentVersion}`;
        elements.updateDescription.textContent = "Mac 与 Windows 可一键校验、安装并配置原插件目录。";
        elements.updateBadge.textContent = "未检查";
        elements.updateFeedback.textContent = "尚未检查工具箱专属发布源";
        elements.updateFeedback.dataset.kind = "";
        setTopStatus(`v${currentVersion}`, "idle");
        return;
      }
      if (!result.ok) {
        elements.updateHeadline.textContent = "暂时无法检查更新";
        elements.updateDescription.textContent = "当前版本可以继续使用，稍后可重新检查。";
        elements.updateBadge.textContent = "检查失败";
        elements.updateFeedback.textContent = updateFailureText(result.reason, result);
        elements.updateFeedback.dataset.kind = "error";
        setTopStatus("检查失败", "warn");
        return;
      }
      if (!result.releasePublished) {
        elements.updateHeadline.textContent = `评估工具箱 v${currentVersion}`;
        elements.updateDescription.textContent = "发布源尚未发布正式版本，当前安装保持不变。";
        elements.updateBadge.textContent = "尚未发布";
        elements.updateFeedback.textContent = "仓库目前没有可供更新的正式版本";
        elements.updateFeedback.dataset.kind = "";
        setTopStatus(`v${currentVersion}`, "ok");
        return;
      }
      if (result.currentRuntimeBuildKind === "local" && !result.updateAvailable) {
        elements.updateHeadline.textContent = "本地整合构建";
        elements.updateDescription.textContent =
          "当前组件来自本机整合构建；不会因与官方发布指纹不同而反复提示修复。";
        elements.updateBadge.textContent = "本地构建";
        elements.updateFeedback.textContent = "版本检查完成，正式包校验规则保持不变";
        elements.updateFeedback.dataset.kind = "ok";
        setTopStatus(`v${currentVersion}`, "ok");
        renderProgress();
        return;
      }
      if (result.repairRequired) {
        elements.updateHeadline.textContent = "检测到组件版本不一致";
        elements.updateDescription.textContent = "产品版本相同，但运行指纹不同，需要重新下载安装当前版本。";
        elements.updateBadge.textContent = "需要修复";
        elements.updateFeedback.textContent = assetUrl
          ? "版本指纹与发布源不一致，请从发布页重新下载安装当前版本"
          : "请打开发布页重新下载安装当前版本";
        elements.updateFeedback.dataset.kind = "error";
        setTopStatus("需修复", "error");
        return;
      }
      if (result.updateAvailable) {
        elements.updateHeadline.textContent = `发现新版本 v${result.latestVersion}`;
        elements.updateDescription.textContent = result.mandatory
          ? "当前版本低于最低支持版本，需要更新后再继续使用。"
          : (result.autoUpdateSupported === true ? "点击“自动下载并更新”，本机将下载、校验并安装最新组件。" : "请打开发布页下载并安装当前平台的更新包。");
        elements.updateBadge.textContent = result.mandatory ? "必须更新" : "有新版本";
        elements.updateFeedback.textContent = assetUrl
          ? `已找到适用于 ${result.platform} 的安装包（${formatBytes(asset.size || preferredCandidate?.size)}），${result.autoUpdateSupported === true ? "可直接一键更新" : "请从发布页下载安装"}`
          : "未找到当前平台安装包，请打开发布页查看";
        elements.updateFeedback.dataset.kind = result.mandatory ? "error" : "ok";
        setTopStatus(
          result.mandatory ? "必须更新" : "有更新",
          result.mandatory ? "error" : "warn",
        );
        return;
      }
      if (result.latestVersion && String(result.latestVersion) !== String(currentVersion)) {
        elements.updateHeadline.textContent = "本机版本高于公开版本";
        elements.updateDescription.textContent =
          `当前为 v${currentVersion}，GitHub 最新正式版本为 v${result.latestVersion}。`;
        elements.updateBadge.textContent = "本机较新";
        elements.updateFeedback.textContent =
          "如需回退，请从发布页下载历史版本安装包";
        elements.updateFeedback.dataset.kind = "ok";
        setTopStatus(`v${currentVersion}`, "ok");
        renderProgress();
        return;
      }
      elements.updateHeadline.textContent = "已是最新版本";
      elements.updateDescription.textContent = `当前版本 v${currentVersion} 与工具箱发布源最新正式版本一致。`;
      elements.updateBadge.textContent = "最新";
      elements.updateFeedback.textContent = "无需更新";
      elements.updateFeedback.dataset.kind = "ok";
      setTopStatus(`v${currentVersion}`, "ok");
      renderProgress();
    }

    async function check({ automatic = false } = {}) {
      if (checking || autoUpdating) return latestResult;
      checking = true;

      elements.downloadUpdate.disabled = true;
      setTopStatus("检查中", "idle");
      elements.updateBadge.textContent = "检查中";
      elements.updateFeedback.textContent = "正在连接发布源...";
      elements.updateFeedback.dataset.kind = "";
      try {
        const { config, contract } = await loadVersionContext();
        const result = await context.sendNativeMessage({
          action: "check_github_update",
          updateManifestUrls: TOOLBOX_UPDATE_MANIFEST_URLS,
          repository: TOOLBOX_UPDATE_REPOSITORY,
          currentVersion: config.productVersion
            || context.extensionManifest.version_name
            || context.extensionManifest.version,
          currentBuildNumber: Number(config.buildNumber || 0),
          currentRuntimeBuildId: String(contract?.runtimeBuildId || ""),
          currentRuntimeBuildKind: String(contract?.runtimeBuildKind || "release"),
        // Leave enough room for the Helper's bounded network fallback to
        // return UPDATE_CHECK_TIMEOUT instead of surfacing a transport timeout.
        }, 30000);
        if (!result?.ok) throw new Error(result?.reason || "GITHUB_UPDATE_CHECK_FAILED");
        latestResult = result;
        updateStatusSupported = result.platform === "macos-arm64" && result.updateStatusSupported === true;
        await saveStatusCapabilityMarker(result);
        await context.storage.save(result);
        render(result);
        if (updateStatusSupported) await pollUpdateStatus({ allowReload: true });
        if (!automatic) {
          context.setStatus(
            result.updateAvailable ? "发现 GitHub 新版本" : "版本检查完成",
            result.mandatory
              ? "error"
              : (result.updateAvailable ? "warn" : "ok"),
          );
        }
        return result;
      } catch (error) {
        latestResult = {
          ok: false,
          action: "check_github_update",
          reason: error?.message || String(error),
          checkedAt: new Date().toISOString(),
        };
        render(latestResult);
        if (!automatic) {
          context.setStatus(`更新检查失败：${updateFailureText(latestResult.reason, latestResult)}`, "warn");
        }
        return latestResult;
      } finally {
        checking = false;
        if (updateStatusSupported && operationStatus?.action === "get_update_status") {
          await applyUpdateStatus(operationStatus, { allowReload: false });
        } else {
          render(latestResult);
        }
      }
    }

    async function maybeAutoCheck() {
      if (
        checking
        || autoUpdating
        || resumedStatusOperation
        || context.isBusy()
        || context.document.visibilityState !== "visible"
      ) return;
      const checkedAt = new Date(latestResult?.checkedAt || 0).getTime();
      if (checkedAt && Date.now() - checkedAt < CHECK_INTERVAL_MS) return;
      await check({ automatic: true });
    }

    async function openUrl(element) {
      const url = safeReleaseUrl(element?.dataset?.url);
      if (!url) {
        context.setStatus("没有可打开的更新地址", "warn");
        return;
      }
      await context.chrome.tabs.create({ url });
    }

    // 一键更新由平台 Native Helper 下载、校验并调用原生安装器；页面只呈现进度与结果。
    async function autoDownloadInstall() {
      if (recoveryBlocked) {
        context.setStatus("更新事务需要人工检查，请先查看诊断详情。", "error");
        return;
      }
      if (autoUpdating || checking || resumedStatusOperation) return;
      const result = latestResult;
      if (!result?.updateAvailable && !result?.repairRequired) {
        context.setStatus("当前没有需要安装的更新", "warn");
        return;
      }
      if (result?.autoUpdateSupported !== true) { await openUrl(elements.openReleasePage); return; }
      const preferred = (Array.isArray(result?.downloadCandidates) && result.downloadCandidates[0]) || null;
      const assetUrl = safeReleaseUrl(preferred?.url || result?.asset?.url);
      const sha256 = String(result?.asset?.sha256 || preferred?.sha256 || "");
      const assetName = String(result?.asset?.name || preferred?.name || "appraisal-toolbox-update.zip");
      if (!assetUrl || !/^[0-9a-f]{64}$/i.test(sha256)) {
        context.setStatus("发布源缺少下载地址或 SHA-256，无法一键更新；请打开发布页手动下载。", "warn");
        return;
      }
      autoUpdating = true;
      render(result);
      elements.updatePrimaryAction.disabled = true;
      renderProgress({ phase: "downloading", percent: 1, message: "正在准备一键更新…" });
      let final = null;
      let streamError = null;
      try {
        try {
          final = await context.streamNativeMessage({
            action: "download_and_install_update",
            url: assetUrl,
            sha256,
            assetName,
            sizeBytes: Number(result?.asset?.size || preferred?.size || 0),
          }, (progress) => renderProgress(progress));
        } catch (error) {
          streamError = error;
        }

        if (!updateStatusSupported) {
          const reason = streamError?.message || final?.reason || "UPDATE_FAILED";
          if (!streamError && final?.ok) {
            operationStatus = final;
            renderProgress(final);
            elements.updateHeadline.textContent = "自动更新已完成";
            elements.updateBadge.textContent = "已完成";
            elements.updateFeedback.textContent = "本机运行组件已更新为最新版本。";
            elements.updateFeedback.dataset.kind = "ok";
            context.setStatus("一键更新完成：本机组件已安装最新版。", "ok");
            const updatedPlatform = final?.platform || result?.platform;
            if (["macos-arm64", "windows-x64"].includes(updatedPlatform)
              && typeof context.chrome?.runtime?.reload === "function") {
              elements.updateFeedback.textContent = "更新完成，正在重新加载评估工具箱扩展。";
              window.setTimeout(() => {
                try { context.chrome.runtime.reload(); }
                catch { elements.updateFeedback.textContent = "组件已更新，请在扩展管理页重新加载评估工具箱。"; }
              }, 900);
            } else {
              elements.updateFeedback.textContent = "本机运行组件已更新。请在扩展管理页重新加载评估工具箱。";
            }
          } else {
            operationStatus = { ok: false, phase: "failed", reason };
            renderProgress(operationStatus);
            if (LEGACY_UPDATE_BLOCKING_REASONS.has(reason)) recoveryBlocked = true;
            elements.updateBadge.textContent = "更新未完成";
            elements.updateFeedback.textContent = updateFailureText(reason, final);
            elements.updateFeedback.dataset.kind = "error";
            context.setStatus(`一键更新未完成：${updateFailureText(reason, final)}`, "error");
          }
          return;
        }

        if (final) {
          operationStatus = final;
          renderProgress(final);
        }
        const verifiedTerminal = ["complete", "rolled_back", "failed_safe"].includes(final?.state)
          && final?.verified === true;
        if (verifiedTerminal) {
          await applyUpdateStatus(final, { allowReload: true });
        } else {
          if (streamError) {
            renderProgress({
              state: "starting",
              phase: "starting",
              message: "与本机助手的连接中断，正在重新读取后台更新状态…",
            });
          }
          const uncertainStart = Boolean(streamError || !final || final?.accepted === true || final?.ok === true || isActiveUpdateState(final?.state));
          const outcome = await pollUpdateStatus({ waitForTerminal: uncertainStart, allowReload: true });
          if (outcome === "idle" && final?.ok === false && final?.accepted !== true && !streamError) {
            const reason = final.reason || "UPDATE_FAILED";
            recoveryBlocked = false;
            resumedStatusOperation = false;
            operationStatus = { ...final, action: "download_and_install_update" };
            render(latestResult);
            elements.updateBadge.textContent = "更新未完成";
            elements.updateFeedback.textContent = updateFailureText(reason, final);
            elements.updateFeedback.dataset.kind = "error";
            context.setStatus(`一键更新未完成：${updateFailureText(reason, final)}`, "error");
          }
        }
      } catch (error) {
        if (updateStatusSupported) {
          await pollUpdateStatus({ waitForTerminal: true, allowReload: true });
        } else {
          const reason = error?.message || String(error);
          operationStatus = { ok: false, phase: "failed", reason };
          renderProgress(operationStatus);
          if (LEGACY_UPDATE_BLOCKING_REASONS.has(reason)) recoveryBlocked = true;
          elements.updateBadge.textContent = "更新未完成";
          elements.updateFeedback.textContent = updateFailureText(reason, operationStatus);
          elements.updateFeedback.dataset.kind = "error";
          context.setStatus(`一键更新未完成：${updateFailureText(reason, operationStatus)}`, "error");
        }
      } finally {
        autoUpdating = false;
        if (updateStatusSupported && operationStatus?.action === "get_update_status") {
          await applyUpdateStatus(operationStatus, { allowReload: false });
        } else {
          elements.updatePrimaryAction.disabled = recoveryBlocked || resumedStatusOperation;
          if (elements.downloadUpdate) elements.downloadUpdate.disabled = !elements.downloadUpdate.dataset.url;
          if (elements.openReleasePage) elements.openReleasePage.disabled = !elements.openReleasePage.dataset.url;
        }
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const pageRoot = context.document.getElementById(
          context.manifest.pageElementId,
        );
        pageRoot.innerHTML = updatesTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL(
          "src/modules/updates/styles.css",
        );
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        latestResult = await context.storage.migrateLegacy(
          LEGACY_STORAGE_KEY,
          null,
        );
        const { config, contract } = await loadVersionContext();
        if (!cacheMatchesRuntime(latestResult, config, contract)) {
          latestResult = null;
        }
        updateStatusSupported = latestResult?.platform === "macos-arm64"
          && latestResult?.updateStatusSupported === true;
        const cachedCapability = await getStatusCapabilityMarker();
        if (cachedCapability?.platform === "macos-arm64"
          && cachedCapability?.updateStatusSupported === true
          && (!latestResult?.platform || latestResult.platform === cachedCapability.platform)) {
          updateStatusSupported = true;
        }
        render(latestResult);

        context.scope.on(elements.openUpdatesTop, "click", () =>
          context.navigate("updates")
        );
        context.scope.on(elements.backFromUpdates, "click", () =>
          context.navigate("home")
        );
        context.scope.on(elements.updatePrimaryAction, "click", () => (
          latestResult?.updateAvailable || latestResult?.repairRequired
            ? autoDownloadInstall()
            : check({ automatic: false })
        ));
        context.scope.on(elements.downloadUpdate, "click", () =>
          openUrl(elements.downloadUpdate)
        );
        context.scope.on(elements.openReleasePage, "click", () =>
          openUrl(elements.openReleasePage)
        );
        context.scope.on(elements.copyUpdateDiagnostics, "click", copyDiagnostics);
        context.scope.on(window, "focus", async () => {
          if (updateStatusSupported) await pollUpdateStatus({ allowReload: true });
          await maybeAutoCheck();
        });
        context.scope.interval(maybeAutoCheck, AUTO_CHECK_TIMER_MS);
        if (updateStatusSupported) context.scope.timeout(() => pollUpdateStatus({ allowReload: true }), 0);
        context.scope.timeout(maybeAutoCheck, 0);
      },

      async activate() {
        render(latestResult);
        if (updateStatusSupported) context.scope.timeout(() => pollUpdateStatus({ allowReload: true }), 0);
        context.scope.timeout(maybeAutoCheck, 0);
      },

      deactivate() {},
      dispose() {},
    };
  },
};
import { updatesTemplate } from "./template.js";
