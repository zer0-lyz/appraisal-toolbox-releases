"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeHelperDataDirectory } = require("./runtime_paths.js");

const DEFAULT_LIST_URL = "https://hz.sydc.anjuke.com/";
const DEFAULT_MAX_CASES = 10;
const CAPTURE_STATUSES = ["ok", "blocked_verification", "not_case", "read_failed"];
const MAP_ASSET_SOURCE_DIRECTORY = path.join(nativeHelperDataDirectory(__dirname), "map-assets");

function mapAssetsDir() {
  try {
    const resolved = fs.realpathSync(MAP_ASSET_SOURCE_DIRECTORY);
    return fs.statSync(resolved).isDirectory() ? resolved : "";
  } catch {
    return "";
  }
}

function security() {
  return { credentialsReturned: false };
}

function safeText(value, max = 400) {
  return String(value || "").replace(/cookie|authorization|password|验证码|token/gi, "[REDACTED]").slice(0, max);
}

function safeCoordinate(value, minimum, maximum) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANJUKE_URL_INVALID");
  }
  if (url.protocol !== "https:" || !/(^|\.)anjuke\.com$/i.test(url.hostname)) {
    throw new Error("ANJUKE_URL_HOST_NOT_ALLOWED");
  }
  return url.href;
}

function normalizeRequest(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const listUrls = (Array.isArray(source.listUrls) ? source.listUrls : source.listUrl ? [source.listUrl] : [])
    .map(normalizeUrl).filter(Boolean).slice(0, 5);
  const detailUrls = (Array.isArray(source.detailUrls) ? source.detailUrls : source.detailUrl ? [source.detailUrl] : [])
    .map(normalizeUrl).filter(Boolean).slice(0, 100);
  if (!listUrls.length && !detailUrls.length) throw new Error("ANJUKE_SOURCE_URL_REQUIRED");
  const outputDirectory = String(source.outputDirectory || "").trim();
  if (!outputDirectory || !path.isAbsolute(outputDirectory) || outputDirectory.includes("\0")) throw new Error("ANJUKE_OUTPUT_DIRECTORY_INVALID");
  const maxCases = Math.max(1, Math.min(100, Number(source.maxCases || DEFAULT_MAX_CASES)));
  if (!Number.isInteger(maxCases)) throw new Error("ANJUKE_MAX_CASES_INVALID");
  const caseType = ["auto", "sale", "rent"].includes(String(source.caseType || "auto")) ? String(source.caseType || "auto") : "auto";
  const rawUserDataDir = String(source.userDataDir || "").trim();
  const userDataDir = rawUserDataDir.startsWith("~/")
    ? path.join(os.homedir(), rawUserDataDir.slice(2))
    : (rawUserDataDir || path.join(process.env.LOCALAPPDATA || os.homedir(), "AppraisalToolbox", "profiles", "anjuke-property"));
  if (userDataDir && (!path.isAbsolute(userDataDir) || userDataDir.includes("\0"))) throw new Error("ANJUKE_USER_DATA_DIR_INVALID");
  return {
    listUrls,
    detailUrls,
    capturedPages: Array.isArray(source.capturedPages)
      ? source.capturedPages.slice(0, 100).map((page) => ({
        url: normalizeUrl(page?.url),
        title: safeText(page?.title, 300),
        location: safeText(page?.location, 300),
        text: safeText(page?.text, 60000),
        html: safeText(page?.html, 400000),
        longitude: safeCoordinate(page?.longitude, -180, 180),
        latitude: safeCoordinate(page?.latitude, -90, 90),
      })).filter((page) => page.url && page.text)
      : null,
    candidateOutcomes: Array.isArray(source.candidateOutcomes)
      ? source.candidateOutcomes.slice(0, 100).map((outcome, index) => {
        let url = "";
        try {
          url = normalizeUrl(outcome?.url);
        } catch {
          url = "";
        }
        return {
          url,
          title: safeText(outcome?.title, 300),
          location: safeText(outcome?.location, 300),
          text: safeText(outcome?.text, 60000),
          html: safeText(outcome?.html, 400000),
          longitude: safeCoordinate(outcome?.longitude, -180, 180),
          latitude: safeCoordinate(outcome?.latitude, -90, 90),
          captureStatus: CAPTURE_STATUSES.includes(String(outcome?.captureStatus || "")) ? String(outcome.captureStatus) : "read_failed",
          errorCode: safeText(outcome?.errorCode, 120),
          sequence: index + 1,
        };
      }).filter((outcome) => outcome.url)
      : null,
    runStatus: ["complete", "partial", "stopped"].includes(String(source.runStatus || "")) ? String(source.runStatus) : "partial",
    restoreStatus: ["restored", "restore_failed", "skipped"].includes(String(source.restoreStatus || "")) ? String(source.restoreStatus) : "skipped",
    keyword: String(source.keyword || "").trim().slice(0, 160),
    caseType,
    outputDirectory: path.resolve(outputDirectory),
    maxCases,
    skippedInvalidCount: Number.isFinite(Number(source.skippedInvalidCount)) ? Math.max(0, Math.floor(Number(source.skippedInvalidCount))) : 0,
    urlPattern: String(source.urlPattern || String.raw`anjuke\.com/.*/\d+/?`).slice(0, 300),
    headed: source.headed === true,
    screenshot: source.screenshot === true,
    waitVerification: source.waitVerification === true,
    verificationTimeout: Math.max(1, Math.min(900, Number(source.verificationTimeout || 300))),
    userDataDir,
  };
}

function validateOutputPath(value, outputDirectory) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) throw new Error("ANJUKE_OUTPUT_PATH_INVALID");
  const resolved = fs.realpathSync(raw);
  // 根目录同样 realpath：用户选择的目录可能在 /tmp 等符号链接路径下，
  // 只对文件一侧 realpath 会把合法输出误判为越界。
  const root = fs.realpathSync(path.resolve(outputDirectory));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("ANJUKE_OUTPUT_OUTSIDE_DIRECTORY");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("ANJUKE_OUTPUT_READBACK_FAILED");
  return resolved;
}

function safeError(error) {
  return safeText(error?.message || String(error));
}

module.exports = {
  DEFAULT_LIST_URL,
  normalizeRequest,
  validateOutputPath,
  safeError,
  security,
  mapAssetsDir,
};
