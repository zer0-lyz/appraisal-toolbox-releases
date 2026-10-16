"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");

const DEFAULT_REPOSITORY = "zer0-lyz/appraisal-toolbox-releases";
// 允许独立扩展（如评估工具箱）按请求指定发布仓库；严格限制 owner/name 形态，
// 防止拼接 api.github.com 端点时被路径穿越或查询串注入。
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function resolveRepository(input = {}) {
  const value = String(input.repository || "").trim();
  if (!value) return DEFAULT_REPOSITORY;
  if (!REPOSITORY_PATTERN.test(value)) throw new Error("UPDATE_REPOSITORY_INVALID");
  return value;
}
const GITHUB_API_BASE = "https://api.github.com";
const UPDATE_MANIFEST_NAME = "update-manifest.json";
const DEFAULT_TIMEOUT_MS = 10000;
const MANIFEST_TIMEOUT_MS = 3000;
const OPTIONAL_MANIFEST_TIMEOUT_MS = 3000;
const CHECK_OPERATION_TIMEOUT_MS = 18000;
const UPDATE_SOURCES_FILE = path.join(nativeHelperDataDirectory(__dirname), "update-sources.json");
const ALLOWED_MANIFEST_HOSTS = new Set([
  "gitee.com",
  "github.com",
  "raw.githubusercontent.com",
  "raw.giteeusercontent.com",
]);

function parseSemver(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    raw: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) return Number(left[index]) > Number(right[index]) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left || !right) throw new Error("UPDATE_VERSION_INVALID");
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] === right[key]) continue;
    return left[key] > right[key] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function normalizeRuntimeBuildKind(value) {
  return String(value || "").trim().toLowerCase() === "local" ? "local" : "release";
}

function platformKey(platform = process.platform, architecture = process.arch) {
  if (platform === "win32" && architecture === "x64") return "windows-x64";
  if (platform === "darwin" && architecture === "arm64") return "macos-arm64";
  return `${platform}-${architecture}`;
}

function releaseNotes(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sha256FromDigest(value) {
  const match = String(value || "").trim().match(/^sha256:([0-9a-f]{64})$/i);
  return match?.[1]?.toLowerCase() || "";
}

function assetPlatformMatches(name, key) {
  const normalized = String(name || "").toLowerCase();
  if (!normalized.endsWith(".zip") || normalized.endsWith(".zip.sha256")) return false;
  if (key === "windows-x64") return normalized.includes("windows-x64");
  if (key === "macos-arm64") {
    return normalized.includes("macos-arm64")
      || normalized.includes("macos-apple")
      || normalized.includes("macos-apple芯片");
  }
  return normalized.includes(key.toLowerCase());
}

function normalizeGithubAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  return {
    id: String(asset.id || "").trim(),
    name: String(asset.name || ""),
    url: String(asset.browser_download_url || ""),
    apiUrl: String(asset.url || ""),
    size: Number(asset.size || 0),
    sha256: sha256FromDigest(asset.digest),
    updatedAt: asset.updated_at || null,
  };
}

function safeChannelReason(value) {
  return String(value || "")
    .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|cookie|password|token|验证码)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[URL]")
    .slice(0, 120);
}

function channelStatus(channel, status, reason = "") {
  return {
    channel: String(channel || "unknown"),
    status: ["ok", "failed", "not_attempted", "unavailable"].includes(status)
      ? status
      : "unavailable",
    ...(reason ? { reason: safeChannelReason(reason) } : {}),
  };
}

function channelSourceForManifestUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.hostname === "github.com") return "github-release";
    if (url.hostname === "api.github.com") return "github-api";
    return url.hostname === "gitee.com" || url.hostname === "raw.giteeusercontent.com"
      ? "gitee"
      : "manifest";
  } catch {
    return "manifest";
  }
}

function createSourceHealth(entries = [], preferredDownloadChannel = "") {
  const normalized = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const byChannel = (channel) => {
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      if (normalized[index].channel === channel) return normalized[index];
    }
    return channelStatus(channel, "not_attempted");
  };
  return {
    githubRelease: byChannel("github-release"),
    githubApi: byChannel("github-api"),
    manifest: byChannel("manifest"),
    gitee: byChannel("gitee"),
    checked: normalized.map((entry) => ({ ...entry })),
    preferredDownloadChannel: String(preferredDownloadChannel || ""),
  };
}

function safeCandidateId(source, value) {
  const suffix = String(value || "asset")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "asset";
  return `${String(source || "download").replace(/[^A-Za-z0-9._-]+/g, "-")}-${suffix}`;
}

/**
 * Return a stable, public-only candidate list for one release asset.
 * Older manifests only contain asset.url, while GitHub API assets contain
 * both browser_download_url and the API asset endpoint. Keep both forms so a
 * caller can switch channels without manufacturing a URL or exposing a token.
 */
function buildDownloadCandidates(asset, {
  preferredDownloadChannel = "",
  source = "manifest",
} = {}) {
  if (!asset || typeof asset !== "object") return [];
  const name = String(asset.name || asset.fileName || "asset");
  const directUrl = String(asset.url || "").trim();
  const apiUrl = String(asset.apiUrl || "").trim();
  const candidates = [];
  const directSource = String(source || "manifest").trim() || "manifest";
  if (directUrl) {
    candidates.push({
      id: safeCandidateId(directSource, name),
      url: directUrl,
      headers: {},
      source: directSource,
      priority: preferredDownloadChannel === directSource ? 10 : 20,
      name,
      size: Number(asset.size || 0),
      sha256: String(asset.sha256 || "").replace(/^sha256:/i, "").toLowerCase(),
    });
  }
  if (apiUrl) {
    candidates.push({
      id: safeCandidateId("github-api", asset.id || name),
      url: apiUrl,
      headers: { accept: "application/octet-stream" },
      source: "github-api",
      priority: preferredDownloadChannel === "github-api" ? 5 : 30,
      name,
      size: Number(asset.size || 0),
      sha256: String(asset.sha256 || "").replace(/^sha256:/i, "").toLowerCase(),
    });
  }
  const seen = new Set();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((left, right) => left.priority - right.priority)
    .map((candidate, index) => ({ ...candidate, priority: index + 1 }));
}

function selectGithubAsset(assets, key, requestedName = "") {
  const normalized = (Array.isArray(assets) ? assets : []).map(normalizeGithubAsset).filter(Boolean);
  if (requestedName) {
    const exact = normalized.find((asset) => asset.name === requestedName);
    if (exact) return exact;
  }
  const candidates = normalized.filter((asset) => assetPlatformMatches(asset.name, key));
  return candidates.find((asset) => !/(?:^|[-_])lite(?:[-_.]|$)/i.test(asset.name))
    || candidates[0]
    || null;
}

function selectChecksumAsset(assets, packageName) {
  const checksumName = packageName ? `${packageName}.sha256` : "";
  if (!checksumName) return null;
  return (Array.isArray(assets) ? assets : [])
    .map(normalizeGithubAsset)
    .find((asset) => asset?.name === checksumName) || null;
}

function configuredManifestUrls(input = {}) {
  let urls = [];
  if (Array.isArray(input.updateManifestUrls)) {
    urls = input.updateManifestUrls;
  } else if (process.env.TIANYUAN_GITEE_MANIFEST_URL) {
    urls = [
      process.env.TIANYUAN_GITEE_MANIFEST_URL,
      ...(process.env.TIANYUAN_UPDATE_MANIFEST_URLS
        ? process.env.TIANYUAN_UPDATE_MANIFEST_URLS.split(",")
        : []),
    ];
  } else if (process.env.TIANYUAN_UPDATE_MANIFEST_URLS) {
    urls = process.env.TIANYUAN_UPDATE_MANIFEST_URLS.split(",");
  } else {
    try {
      const config = JSON.parse(fs.readFileSync(UPDATE_SOURCES_FILE, "utf8"));
      if (config.giteeManifestUrl) urls.push(config.giteeManifestUrl);
      if (Array.isArray(config.manifestUrls)) urls.push(...config.manifestUrls);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return [...new Set(urls
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function validateManifestUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("UPDATE_MANIFEST_URL_FORBIDDEN");
  }
  if (url.protocol !== "https:" || !ALLOWED_MANIFEST_HOSTS.has(url.hostname)) {
    throw new Error("UPDATE_MANIFEST_URL_FORBIDDEN");
  }
  return url.href;
}

function isAuthoritativeLatestManifestUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && /\/releases\/latest\/download\/update-manifest\.json$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function githubManifestAssetUrl(manifest, manifestUrl, fileName) {
  if (!fileName) return "";
  try {
    const sourceUrl = new URL(String(manifestUrl || ""));
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "github.com") return "";
    if (/\/releases\/latest\/download\/update-manifest\.json$/i.test(sourceUrl.pathname)) {
      return new URL(`./${encodeURIComponent(fileName)}`, sourceUrl).href;
    }
    const releaseUrl = new URL(String(manifest?.releaseUrl || ""));
    const match = releaseUrl.pathname.match(/^(.*\/releases)\/tag\/([^/]+)\/?$/i);
    if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com" || !match) return "";
    return `${releaseUrl.origin}${match[1]}/download/${match[2]}/${encodeURIComponent(fileName)}`;
  } catch {
    return "";
  }
}

function normalizeManifestAsset(asset, manifestUrl, manifest = null) {
  if (!asset || typeof asset !== "object") return null;
  const fileName = String(asset.fileName || asset.name || "");
  const directUrl = String(asset.url || "").trim();
  const url = directUrl
    ? new URL(directUrl, manifestUrl).href
    : githubManifestAssetUrl(manifest, manifestUrl, fileName);
  const normalized = {
    id: String(asset.id || "").trim(),
    name: fileName,
    url,
    apiUrl: String(asset.apiUrl || "").trim(),
    size: Number(asset.size || 0),
    sha256: String(asset.sha256 || "").replace(/^sha256:/i, "").toLowerCase(),
    updatedAt: asset.updatedAt || null,
  };
  if (Array.isArray(asset.downloadCandidates)) {
    normalized.downloadCandidates = asset.downloadCandidates
      .filter((candidate) => candidate && typeof candidate === "object")
      .map((candidate, index) => ({
        id: safeCandidateId(candidate.source || "manifest", candidate.id || fileName || index),
        url: candidate.url
          ? new URL(String(candidate.url).trim(), manifestUrl).href
          : "",
        headers: candidate.headers && typeof candidate.headers === "object"
          ? { ...candidate.headers }
          : {},
        source: String(candidate.source || "manifest"),
        priority: Number(candidate.priority || index + 1),
        name: fileName,
        size: Number(candidate.size || normalized.size || 0),
        sha256: String(candidate.sha256 || normalized.sha256 || "")
          .replace(/^sha256:/i, "").toLowerCase(),
      }))
      .filter((candidate) => candidate.url)
      .sort((left, right) => left.priority - right.priority)
      .map((candidate, index) => ({ ...candidate, priority: index + 1 }));
  }
  return normalized;
}

function resultFromManifest(manifest, manifestUrl, input, sourceHealth = null) {
  manifest = require("./platform-update-manifest.js").selectPlatformManifest(manifest, platformKey(input.platform, input.architecture));
  const currentVersion = String(input.currentVersion || "").trim();
  const currentBuildNumber = Number(input.currentBuildNumber || 0);
  const latestVersion = String(manifest?.productVersion || "").trim().replace(/^v/i, "");
  if (!parseSemver(latestVersion)) throw new Error("LATEST_VERSION_INVALID");
  const latestBuildNumber = Number(manifest?.buildNumber || 0);
  const versionComparison = compareSemver(latestVersion, currentVersion);
  const buildUpdate = versionComparison === 0
    && latestBuildNumber > 0
    && latestBuildNumber > currentBuildNumber;
  const latestRuntimeBuildId = String(manifest?.runtimeBuildId || "").trim();
  const currentRuntimeBuildId = String(input.currentRuntimeBuildId || "").trim();
  const currentRuntimeBuildKind = normalizeRuntimeBuildKind(input.currentRuntimeBuildKind);
  const latestRuntimeBuildKind = normalizeRuntimeBuildKind(manifest?.runtimeBuildKind);
  const repairRequired = versionComparison === 0
    && currentRuntimeBuildKind !== "local"
    && latestBuildNumber >= currentBuildNumber
    && Boolean(latestRuntimeBuildId && currentRuntimeBuildId && latestRuntimeBuildId !== currentRuntimeBuildId);
  const key = platformKey(input.platform, input.architecture);
  const requestedAsset = manifest?.assets?.[key] || null;
  const packageAsset = normalizeManifestAsset(requestedAsset, manifestUrl, manifest);
  const preferredDownloadChannel = packageAsset?.downloadCandidates?.length
    ? String(packageAsset.downloadCandidates[0].source || "manifest")
    : channelSourceForManifestUrl(manifestUrl);
  const downloadCandidates = packageAsset?.downloadCandidates?.length
    ? packageAsset.downloadCandidates
    : buildDownloadCandidates(packageAsset, {
      preferredDownloadChannel,
      source: channelSourceForManifestUrl(manifestUrl),
    });
  const minimumSupportedVersion = String(manifest?.minimumSupportedVersion || "").trim();
  const mandatory = Boolean(
    manifest?.mandatory
    || (parseSemver(minimumSupportedVersion) && compareSemver(currentVersion, minimumSupportedVersion) < 0)
  );
  return {
    ok: true,
    action: "check_github_update",
    repository: manifest?.repository || DEFAULT_REPOSITORY,
    source: manifest?.source || "manifest",
    sourceHealth: sourceHealth || createSourceHealth([
      channelStatus(channelSourceForManifestUrl(manifestUrl), "ok"),
    ], preferredDownloadChannel),
    preferredDownloadChannel,
    manifestUrl,
    currentVersion,
    currentBuildNumber,
    currentRuntimeBuildId,
    currentRuntimeBuildKind,
    latestVersion,
    latestBuildNumber,
    latestRuntimeBuildId,
    latestRuntimeBuildKind,
    releasePublished: true,
    updateAvailable: versionComparison > 0 || buildUpdate || repairRequired,
    repairRequired,
    mandatory,
    minimumSupportedVersion: minimumSupportedVersion || null,
    channel: manifest?.channel || "stable",
    releaseName: String(manifest?.releaseName || `v${latestVersion}`),
    releaseUrl: String(manifest?.releaseUrl || manifestUrl),
    publishedAt: manifest?.publishedAt || null,
    notes: releaseNotes(manifest?.releaseNotes),
    platform: key,
    asset: packageAsset,
    downloadCandidates,
    checksumAsset: null,
    manifestFound: true,
    checkedAt: new Date().toISOString(),
    security: { credentialsReturned: false, tokenUsed: false },
  };
}

function withManifestSourceHealth(update, health = []) {
  if (!update) return null;
  const preferred = update.preferredDownloadChannel || "";
  return {
    ...update,
    sourceHealth: createSourceHealth(health, preferred),
    preferredDownloadChannel: preferred,
    downloadCandidates: update.asset?.downloadCandidates?.length
      ? update.asset.downloadCandidates
      : buildDownloadCandidates(update.asset, {
        preferredDownloadChannel: preferred,
        source: channelSourceForManifestUrl(update.manifestUrl),
      }),
  };
}

function isFresherManifestResult(candidate, current) {
  if (!current) return true;
  try {
    const versionComparison = compareSemver(candidate.latestVersion, current.latestVersion);
    if (versionComparison !== 0) return versionComparison > 0;
  } catch {
    return false;
  }
  const candidateBuild = Number(candidate.latestBuildNumber || 0);
  const currentBuild = Number(current.latestBuildNumber || 0);
  if (candidateBuild !== currentBuild) return candidateBuild > currentBuild;
  return Boolean(candidate.updateAvailable) && !Boolean(current.updateAvailable);
}

/**
 * The GitHub API asset path loses the mirror's download candidates because
 * the API response cannot know them; on networks where github.com is flaky
 * but api.github.com works this would push domestic users onto the slow
 * GitHub channels. Only adopt mirror candidates when the authoritative API
 * just confirmed the exact same package (same file name, size and SHA-256),
 * so a stale mirror can never change the version or the expected digest —
 * it can only contribute an extra download URL that the installer still
 * verifies byte-for-byte.
 */
function mergeMirrorCandidatesForApiResult({
  mirrorUpdate,
  latestVersion,
  packageAsset,
  downloadCandidates,
  fallbackPreferredChannel,
}) {
  const unchanged = { downloadCandidates, preferredDownloadChannel: fallbackPreferredChannel };
  if (!mirrorUpdate || !packageAsset) return unchanged;
  try {
    if (compareSemver(mirrorUpdate.latestVersion, latestVersion) !== 0) return unchanged;
  } catch {
    return unchanged;
  }
  const mirrorAsset = mirrorUpdate.asset || {};
  if (!mirrorAsset.name
    || mirrorAsset.name !== packageAsset.name
    || String(mirrorAsset.sha256 || "").toLowerCase() !== String(packageAsset.sha256 || "").toLowerCase()
    || Number(mirrorAsset.size || 0) !== Number(packageAsset.size || 0)) {
    return unchanged;
  }
  const giteeCandidates = (Array.isArray(mirrorUpdate.downloadCandidates) ? mirrorUpdate.downloadCandidates : [])
    .filter((candidate) => candidate?.source === "gitee" && String(candidate.url || "").trim());
  if (!giteeCandidates.length) return unchanged;
  const seen = new Set();
  const merged = [];
  for (const candidate of [...giteeCandidates, ...downloadCandidates]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    merged.push({ ...candidate, priority: merged.length + 1 });
  }
  return { downloadCandidates: merged, preferredDownloadChannel: "gitee" };
}

async function checkManifestSources(input = {}, options = {}) {
  const health = [];
  let mirrorUpdate = null;
  for (const sourceUrl of configuredManifestUrls(input)) {
    const manifestUrl = validateManifestUrl(sourceUrl);
    const channel = channelSourceForManifestUrl(manifestUrl);
    try {
      const result = await fetchJson(manifestUrl, {
        ...options,
        accept: "application/json",
      });
      if (!result.found || !result.payload) {
        health.push(channelStatus(channel, "unavailable", `HTTP_${result.status || 404}`));
        continue;
      }
      health.push(channelStatus(channel, "ok"));
      const update = resultFromManifest(result.payload, manifestUrl, input);
      // Only the GitHub latest-release manifest is authoritative. A Gitee or
      // other mirror result is retained as a fallback while the canonical
      // GitHub Release/API channels are still checked.
      if (isAuthoritativeLatestManifestUrl(manifestUrl)) {
        return {
          update: withManifestSourceHealth(update, health),
          mirrorUpdate,
          health,
        };
      }
      if (isFresherManifestResult(update, mirrorUpdate)) mirrorUpdate = update;
    } catch (error) {
      health.push(channelStatus(channel, "failed", error?.message || error));
      continue;
    }
  }
  // A stale mirror must not mask the authoritative GitHub release check.
  return {
    update: null,
    mirrorUpdate: withManifestSourceHealth(mirrorUpdate, health),
    health,
  };
}

function mirrorFallback(update, entries, reason = "") {
  if (!update) return null;
  return {
    ...update,
    sourceHealth: createSourceHealth(entries, update.preferredDownloadChannel || ""),
    ...(reason ? {
      fallback: {
        channel: update.preferredDownloadChannel || channelSourceForManifestUrl(update.manifestUrl),
        reason: safeChannelReason(reason),
      },
    } : {}),
  };
}

function updateManifestSourceHealth(update, status, reason = "") {
  const checked = Array.isArray(update?.sourceHealth?.checked)
    ? update.sourceHealth.checked.filter((entry) => entry?.channel !== "github-api")
    : [];
  return {
    ...update,
    sourceHealth: createSourceHealth([
      ...checked,
      channelStatus("github-api", status, reason),
    ], update?.preferredDownloadChannel || ""),
  };
}

async function enrichManifestWithApiCandidate(update, input, options = {}) {
  const candidates = Array.isArray(update?.downloadCandidates)
    ? update.downloadCandidates
    : [];
  if (!update || (!update.updateAvailable && !update.repairRequired)) return update;
  if (candidates.some((candidate) => candidate?.source === "github-api")) return update;
  const packageName = String(update.asset?.name || update.asset?.fileName || "").trim();
  if (!packageName) return update;

  const endpoint = `${GITHUB_API_BASE}/repos/${resolveRepository(input)}/releases/latest`;
  let releaseResult;
  try {
    releaseResult = await fetchJson(endpoint, {
      ...options,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    return updateManifestSourceHealth(update, "failed", error?.message || error);
  }
  if (!releaseResult.found) {
    return updateManifestSourceHealth(
      update,
      "unavailable",
      `HTTP_${releaseResult.status || 404}`,
    );
  }

  const key = platformKey(input.platform, input.architecture);
  const apiAsset = selectGithubAsset(releaseResult.payload?.assets, key, packageName);
  if (!apiAsset || apiAsset.name !== packageName || !apiAsset.apiUrl) {
    return updateManifestSourceHealth(update, "unavailable", "ASSET_NOT_FOUND");
  }

  const nextPriority = candidates.reduce(
    (highest, candidate) => Math.max(highest, Number(candidate?.priority || 0)),
    0,
  ) + 1;
  const apiCandidate = {
    id: safeCandidateId("github-api", apiAsset.id || packageName),
    url: apiAsset.apiUrl,
    headers: { accept: "application/octet-stream" },
    source: "github-api",
    priority: nextPriority,
    name: packageName,
    size: Number(update.asset?.size || apiAsset.size || 0),
    sha256: String(update.asset?.sha256 || apiAsset.sha256 || "")
      .replace(/^sha256:/i, "")
      .toLowerCase(),
  };
  return updateManifestSourceHealth({
    ...update,
    asset: {
      ...update.asset,
      id: String(update.asset?.id || apiAsset.id || ""),
      apiUrl: apiAsset.apiUrl,
      size: Number(update.asset?.size || apiAsset.size || 0),
      sha256: String(update.asset?.sha256 || apiAsset.sha256 || "")
        .replace(/^sha256:/i, "")
        .toLowerCase(),
    },
    downloadCandidates: [...candidates, apiCandidate],
  }, "ok");
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, accept = "application/vnd.github+json" } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("UPDATE_FETCH_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": accept,
        "user-agent": "Tianyuan-Workbench-Updater",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (response.status === 404) return { found: false, status: 404, payload: null };
    if (!response.ok) {
      const error = new Error(`GITHUB_UPDATE_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return { found: true, status: response.status, payload: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOptionalManifest(release, options) {
  const asset = (Array.isArray(release?.assets) ? release.assets : [])
    .find((item) => item?.name === UPDATE_MANIFEST_NAME);
  if (!asset?.browser_download_url) return null;
  try {
    const result = await fetchJson(asset.browser_download_url, {
      ...options,
      accept: "application/json",
    });
    return result.found && result.payload && typeof result.payload === "object"
      ? result.payload
      : null;
  } catch {
    return null;
  }
}

async function checkGithubUpdateInternal(input = {}, options = {}) {
  const repository = resolveRepository(input);
  const currentVersion = String(input.currentVersion || "").trim();
  const currentBuildNumber = Number(input.currentBuildNumber || 0);
  if (!parseSemver(currentVersion)) throw new Error("CURRENT_VERSION_INVALID");
  const manifestCheck = await checkManifestSources(input, {
    ...options,
    timeoutMs: MANIFEST_TIMEOUT_MS,
  });
  if (manifestCheck?.update) {
    return await enrichManifestWithApiCandidate(manifestCheck.update, input, options);
  }
  const endpoint = `${GITHUB_API_BASE}/repos/${repository}/releases/latest`;
  let releaseResult;
  try {
    releaseResult = await fetchJson(endpoint, {
      ...options,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    const checked = [
      ...(manifestCheck?.health || []),
      channelStatus("github-api", "failed", error?.message || error),
    ];
    const fallback = mirrorFallback(manifestCheck?.mirrorUpdate, checked, error?.message || error);
    if (fallback) return fallback;
    const health = createSourceHealth(checked, "");
    return {
      ok: false,
      action: "check_github_update",
      repository,
      currentVersion,
      currentBuildNumber,
      releasePublished: false,
      updateAvailable: false,
      mandatory: false,
      reason: safeChannelReason(error?.message || error || "GITHUB_UPDATE_CHECK_FAILED"),
      source: "github-api",
      sourceHealth: health,
      preferredDownloadChannel: "",
      checkedAt: new Date().toISOString(),
      security: { credentialsReturned: false, tokenUsed: false },
    };
  }
  if (!releaseResult.found) {
    const checked = [
      ...(manifestCheck?.health || []),
      channelStatus("github-api", "unavailable", `HTTP_${releaseResult.status || 404}`),
    ];
    const fallback = mirrorFallback(
      manifestCheck?.mirrorUpdate,
      checked,
      `HTTP_${releaseResult.status || 404}`,
    );
    if (fallback) return fallback;
    const health = createSourceHealth(checked, "");
    return {
      ok: true,
      action: "check_github_update",
      repository,
      currentVersion,
      currentBuildNumber,
      releasePublished: false,
      updateAvailable: false,
      mandatory: false,
      reason: "GITHUB_RELEASE_NOT_PUBLISHED",
      source: "github-api",
      sourceHealth: health,
      preferredDownloadChannel: "",
      checkedAt: new Date().toISOString(),
      security: { credentialsReturned: false, tokenUsed: false },
    };
  }

  const release = releaseResult.payload || {};
  const manifest = await loadOptionalManifest(release, {
    ...options,
    timeoutMs: OPTIONAL_MANIFEST_TIMEOUT_MS,
  });
  const latestVersion = String(manifest?.productVersion || release.tag_name || "").trim().replace(/^v/i, "");
  if (!parseSemver(latestVersion)) {
    const reason = "LATEST_VERSION_INVALID";
    const checked = [
      ...(manifestCheck?.health || []),
      channelStatus("github-api", "failed", reason),
    ];
    const fallback = mirrorFallback(manifestCheck?.mirrorUpdate, checked, reason);
    if (fallback) return fallback;
    throw new Error(reason);
  }
  const latestBuildNumber = Number(manifest?.buildNumber || 0);
  const versionComparison = compareSemver(latestVersion, currentVersion);
  const buildUpdate = versionComparison === 0
    && latestBuildNumber > 0
    && latestBuildNumber > currentBuildNumber;
  const updateAvailable = versionComparison > 0 || buildUpdate;
  const minimumSupportedVersion = String(manifest?.minimumSupportedVersion || "").trim();
  const mandatory = Boolean(
    manifest?.mandatory
    || (parseSemver(minimumSupportedVersion) && compareSemver(currentVersion, minimumSupportedVersion) < 0)
  );
  const key = platformKey(input.platform, input.architecture);
  const requestedAsset = manifest?.assets?.[key] || null;
  const packageAsset = selectGithubAsset(release.assets, key, requestedAsset?.fileName);
  const checksumAsset = selectChecksumAsset(release.assets, packageAsset?.name);
  const githubReleaseStatus = (manifestCheck?.health || [])
    .find((entry) => entry.channel === "github-release");
  const preferredDownloadChannel = githubReleaseStatus && githubReleaseStatus.status !== "ok"
    ? "github-api"
    : "github-release";
  const apiCandidates = buildDownloadCandidates(packageAsset, {
    preferredDownloadChannel,
    source: "github-release",
  });
  const merged = mergeMirrorCandidatesForApiResult({
    mirrorUpdate: manifestCheck?.mirrorUpdate || null,
    latestVersion,
    packageAsset: packageAsset ? {
      name: packageAsset.name,
      size: packageAsset.size,
      sha256: String(requestedAsset?.sha256 || packageAsset.sha256 || "").replace(/^sha256:/i, "").toLowerCase(),
    } : null,
    downloadCandidates: apiCandidates,
    fallbackPreferredChannel: preferredDownloadChannel,
  });
  const downloadCandidates = merged.downloadCandidates;
  const sourceHealth = createSourceHealth([
    ...(manifestCheck?.health || []),
    channelStatus("github-api", "ok"),
  ], merged.preferredDownloadChannel);
  const latestRuntimeBuildId = String(manifest?.runtimeBuildId || "").trim();
  const currentRuntimeBuildId = String(input.currentRuntimeBuildId || "").trim();
  const currentRuntimeBuildKind = normalizeRuntimeBuildKind(input.currentRuntimeBuildKind);
  const latestRuntimeBuildKind = normalizeRuntimeBuildKind(manifest?.runtimeBuildKind);
  const repairRequired = versionComparison === 0
    && currentRuntimeBuildKind !== "local"
    && latestBuildNumber >= currentBuildNumber
    && Boolean(latestRuntimeBuildId && currentRuntimeBuildId && latestRuntimeBuildId !== currentRuntimeBuildId);

  return {
    ok: true,
    action: "check_github_update",
    repository,
    currentVersion,
    currentBuildNumber,
    currentRuntimeBuildId,
    currentRuntimeBuildKind,
    latestVersion,
    latestBuildNumber,
    latestRuntimeBuildId,
    latestRuntimeBuildKind,
    releasePublished: true,
    updateAvailable: updateAvailable || repairRequired,
    repairRequired,
    mandatory,
    minimumSupportedVersion: minimumSupportedVersion || null,
    source: "github-api",
    sourceHealth,
    preferredDownloadChannel: merged.preferredDownloadChannel,
    channel: manifest?.channel || (release.prerelease ? "beta" : "stable"),
    releaseName: String(release.name || release.tag_name || latestVersion),
    releaseUrl: String(release.html_url || ""),
    publishedAt: release.published_at || null,
    notes: releaseNotes(manifest?.releaseNotes || release.body),
    platform: key,
    asset: packageAsset ? {
      ...packageAsset,
      sha256: String(requestedAsset?.sha256 || packageAsset.sha256 || "").replace(/^sha256:/i, "").toLowerCase(),
    } : null,
    downloadCandidates,
    checksumAsset,
    manifestFound: Boolean(manifest),
    checkedAt: new Date().toISOString(),
    security: { credentialsReturned: false, tokenUsed: false },
  };
}

async function checkGithubUpdate(input = {}, options = {}) {
  const timeoutMs = Number(options.checkTimeoutMs || CHECK_OPERATION_TIMEOUT_MS);
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("UPDATE_CHECK_TIMEOUT")), timeoutMs);
  });
  try {
    const result = await Promise.race([
      checkGithubUpdateInternal(input, options),
      timeoutPromise,
    ]);
    return { ...result, ...platformUpdate.capabilities() };
  } finally {
    clearTimeout(timeout);
  }
}

const platformUpdate = require("./platform/update.js");
function downloadAndInstallUpdate(message, emit) {
  return platformUpdate.downloadAndInstallUpdate(message, emit, checkGithubUpdate);
}

module.exports = {
  DEFAULT_REPOSITORY,
  UPDATE_MANIFEST_NAME,
  configuredManifestUrls,
  parseSemver,
  compareSemver,
  platformKey,
  selectGithubAsset,
  buildDownloadCandidates,
  createSourceHealth,
  isAuthoritativeLatestManifestUrl,
  checkGithubUpdate,
  resultFromManifest,
  downloadAndInstallUpdate,
  isUpdateInProgress: () => platformUpdate.isUpdating(),
};
