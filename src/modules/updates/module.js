const LEGACY_STORAGE_KEY = "appraisalToolboxUpdateResult";
// 工具箱使用独立发布仓库；清单未发布前检查会显式失败，绝不回落到主工作台的发布清单。
const TOOLBOX_UPDATE_REPOSITORY = "zer0-lyz/appraisal-toolbox-releases";
const TOOLBOX_UPDATE_MANIFEST_URLS = [
  "https://gitee.com/zer0_y/appraisal-toolbox-releases/raw/master/update-manifest.json",
  "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/latest/download/update-manifest.json",
];
// 工具箱与主工作台共用同一个本机运行组件。Helper 的页内安装/自测动作
// 目标写死为主工作台运行副本，工具箱绝不调用（本文件不出现任何此类
// action），更新一律经发布页下载安装。
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_TIMER_MS = 30 * 60 * 1000;

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
    const hosts = new Set([
      "github.com",
      "api.github.com",
      "objects.githubusercontent.com",
      "release-assets.githubusercontent.com",
      "gitee.com",
      "raw.giteeusercontent.com",
    ]);
    if (url.protocol !== "https:" || !hosts.has(url.hostname)) return "";
    // Release manifests point releaseUrl at /releases/download/<tag>, which 404s
    // without an asset name. The browsable page lives at /releases/tag/<tag>.
    // Bare download URLs only; asset URLs keep their filename suffix.
    const bareDownload = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/?$/,
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
    let latestResult = null;
    let versionConfig = null;
    let runtimeContract = null;
    let operationStatus = null;

    function sleep(delay) {
      return new Promise((resolve) => window.setTimeout(resolve, delay));
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
        errorCode: String(status?.errorCode || result?.errorCode || result?.reason || ""),
        currentVersionUnchanged: status?.currentVersionUnchanged !== false
          && result?.currentVersionUnchanged !== false,
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

    function updateFailureText(reason) {
      const messages = {
        UPDATE_NOT_REQUIRED: "当前已经是最新版本。",
        UPDATE_ASSET_NOT_FOUND: "未找到适用于当前系统的安装包。",
        UPDATE_SHA256_MISSING: "官方发布包缺少 SHA-256，已停止安装。",
        UPDATE_SHA256_INVALID: "官方校验文件格式无效，已停止安装。",
        UPDATE_SHA256_MISMATCH: "安装包校验失败，文件可能损坏，已停止安装。",
        UPDATE_INSTALLER_NOT_FOUND: "安装包中缺少安装程序，已停止安装。",
        UPDATE_DOWNLOAD_NETWORK_FAILED: "安装包下载网络连接失败，请检查网络后重试。",
        UPDATE_DOWNLOAD_CHANNELS_FAILED: "所有下载通道均失败，当前版本未改变；请检查网络或打开发布页手动下载。",
        UPDATE_PYTHON_RUNTIME_UNAVAILABLE: "当前 macOS 没有可复用且兼容的 Python 运行时；当前版本未改变，请先运行 macOS 安装包。",
        UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED: "当前 macOS Python 缺少更新所需依赖，且版本不在轻量包支持范围内；当前版本未改变，请安装 Python 3.9/3.14 或运行 macOS 安装包。",
        UPDATE_PREFLIGHT_FAILED: "更新环境预检未通过，当前版本未改变，请按提示修复后重试。",
        UPDATE_DOWNLOAD_TIMEOUT: "安装包下载超时，请检查网络稳定性后重试。",
        UPDATE_CHECK_TIMEOUT: "更新源响应超时，当前版本可以继续使用，请稍后重试。",
        NATIVE_HELPER_TIMEOUT: "本地助手响应超时，请重新加载扩展后重试；当前版本未改变。",
        UPDATE_DOWNLOAD_SIZE_MISMATCH: "安装包大小与发布记录不一致，已停止处理。",
        UPDATE_FETCH_UNAVAILABLE: "本机 Node.js 运行时不支持下载，请更新本机运行组件。",
        UPDATE_INSTALLER_NOT_STARTED: "更新程序没有成功启动，请重试并查看诊断日志。",
        UPDATE_RUNNER_NOT_FOUND: "更新脚本没有成功启动，请重新加载扩展后重试。",
        UPDATE_PARENT_PROCESS_NOT_EXITED: "旧版本服务没有及时退出，已停止更新以保护当前版本。",
        UPDATE_FILE_LOCKED: "工具箱文件仍被占用，当前版本已保留；请关闭相关浏览器窗口后重试。",
        UPDATE_ALREADY_RUNNING: "已有更新正在执行，请等待当前更新结束。",
        UPDATE_COMPLETION_STATUS_MISSING: "安装程序未返回完成状态，当前版本已保留。",
        WORKBENCH_UPDATE_TIMEOUT: "更新等待超时，当前版本已保留；请查看诊断日志后重试。",
        PLATFORM_UPDATE_UNSUPPORTED: "当前系统暂不支持一键更新。",
        UNKNOWN_ACTION: "当前 Native Helper 版本较旧，需要手动安装一次新版。",
      };
      if (String(reason || "").startsWith("UPDATE_DOWNLOAD_NETWORK_")) {
        const code = String(reason).slice("UPDATE_DOWNLOAD_NETWORK_".length);
        return `安装包下载网络连接失败（${code}），请检查网络后重试。`;
      }
      if (String(reason || "").startsWith("UPDATE_PYTHON_RUNTIME_UNAVAILABLE")) {
        return messages.UPDATE_PYTHON_RUNTIME_UNAVAILABLE;
      }
      if (String(reason || "").startsWith("UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED")) {
        return messages.UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED;
      }
      if (String(reason || "").startsWith("UPDATE_DOWNLOAD_HTTP_")) {
        const code = String(reason).slice("UPDATE_DOWNLOAD_HTTP_".length);
        return `安装包下载失败（HTTP ${code}），请打开发布页重试。`;
      }
      if (String(reason || "").startsWith("UPDATE_PACKAGE_FILE_MISSING:")) {
        return "安装包文件不完整，已停止处理。";
      }
      if (String(reason || "").startsWith("UPDATE_INSTALLER_EXIT_")) {
        const code = String(reason).slice("UPDATE_INSTALLER_EXIT_".length);
        return `Windows 安装脚本失败（退出码 ${code}），当前版本已保留。`;
      }
      return messages[reason] || reason || "更新失败";
    }

    function progressMessage(status) {
      if (status?.message) return status.message;
      const phase = status?.normalizedPhase || status?.phase;
      const labels = {
        checking: "正在检查更新源",
        preflight: "正在预检本机运行环境",
        downloading: "正在下载更新包",
        verifying: "正在校验更新包",
        extracting: "正在解压更新包",
        installing: "正在安装工具箱组件",
        verifying_install: "正在验证安装结果",
        complete: "更新已完成",
        preparing: "正在准备更新",
        stopping_services: "正在停止旧版本服务",
        waiting_for_file_release: "正在等待文件释放",
        restarting_services: "正在重启服务",
        rollback: "正在恢复原版本",
      };
      return labels[phase] || (phase === "failed"
        ? updateFailureText(status.reason)
        : "等待开始");
    }

    function renderProgress(status = operationStatus) {
      operationStatus = status;
      const normalizedPhase = status?.normalizedPhase || status?.phase;
      const active = checking || (
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
      const operationBusy = checking;
      if (elements.downloadUpdate) {
        elements.downloadUpdate.disabled = operationBusy || !assetUrl;
        elements.downloadUpdate.dataset.url = assetUrl;
      }
      if (elements.openReleasePage) {
        elements.openReleasePage.disabled = operationBusy || !releaseUrl;
        elements.openReleasePage.dataset.url = releaseUrl;
      }
      if (elements.updatePrimaryAction) {
        elements.updatePrimaryAction.disabled = operationBusy;
        // 页内不安装：发现新版本/需修复时主按钮直接打开发布页。
        elements.updatePrimaryAction.textContent = result?.updateAvailable || result?.repairRequired
          ? "打开发布页"
          : "检查更新";
      }

      if (!result) {
        elements.updateHeadline.textContent = `评估工具箱 v${currentVersion}`;
        elements.updateDescription.textContent = "检查不使用任何凭据；工具箱更新经发布页下载安装，不在页内覆盖组件。";
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
        elements.updateFeedback.textContent = result.reason || "发布源更新检查失败";
        elements.updateFeedback.dataset.kind = "error";
        setTopStatus("检查失败", "warn");
        return;
      }
      if (!result.releasePublished) {
        elements.updateHeadline.textContent = `当前版本 v${currentVersion}`;
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
          : "工具箱只更新扩展本体；请从发布页下载安装包后覆盖加载目录。";
        elements.updateBadge.textContent = result.mandatory ? "必须更新" : "有新版本";
        elements.updateFeedback.textContent = assetUrl
          ? `已找到适用于 ${result.platform} 的安装包，请打开发布页下载`
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
      if (checking) return latestResult;
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
        await context.storage.save(result);
        render(result);
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
          context.setStatus(`更新检查失败：${latestResult.reason}`, "warn");
        }
        return latestResult;
      } finally {
        checking = false;
        render(latestResult);
      }
    }

    async function maybeAutoCheck() {
      if (
        checking
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
        render(latestResult);

        context.scope.on(elements.openUpdatesTop, "click", () =>
          context.navigate("updates")
        );
        context.scope.on(elements.backFromUpdates, "click", () =>
          context.navigate("home")
        );
        context.scope.on(elements.updatePrimaryAction, "click", () => (
          latestResult?.updateAvailable || latestResult?.repairRequired
            ? openUrl(elements.openReleasePage)
            : check({ automatic: false })
        ));
        context.scope.on(elements.downloadUpdate, "click", () =>
          openUrl(elements.downloadUpdate)
        );
        context.scope.on(elements.openReleasePage, "click", () =>
          openUrl(elements.openReleasePage)
        );
        context.scope.on(elements.copyUpdateDiagnostics, "click", copyDiagnostics);
        context.scope.on(window, "focus", maybeAutoCheck);
        context.scope.interval(maybeAutoCheck, AUTO_CHECK_TIMER_MS);
        context.scope.timeout(maybeAutoCheck, 0);
      },

      async activate() {
        render(latestResult);
        context.scope.timeout(maybeAutoCheck, 0);
      },

      deactivate() {},
      dispose() {},
    };
  },
};
import { updatesTemplate } from "./template.js";
