"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { spawn, execFileSync } = require("node:child_process");

const REPOSITORY = "zer0-lyz/appraisal-toolbox-releases";
const EXTENSION_ID = "aamfmhcbjgofhmannejoiilkkpchfkgm";
const NATIVE_HOST = "com.appraisal.toolbox.helper";
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 750;
const STALE_LOCK_GRACE_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const PYTHON_VERSION = "3.14.6";

function capabilitiesFor(platform = process.platform, architecture = process.arch) {
  return { autoUpdateSupported: platform === "darwin" && architecture === "arm64" };
}

function extensionIdFromKey(value) {
  const key = Buffer.from(String(value || ""), "base64");
  if (key.length < 32) return "";
  const digest = crypto.createHash("sha256").update(key).digest();
  return [...digest.subarray(0, 16)].map((byte) =>
    String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))
  ).join("");
}

function allowedAssetUrl(value, redirected = false) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("UPDATE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("UPDATE_URL_INVALID");
  }
  const releasePath = /^\/zer0-lyz\/appraisal-toolbox-releases\/releases\/(?:download\/[^/]+\/[^/]+|latest\/download\/[^/]+)$/i;
  const apiPath = /^\/repos\/zer0-lyz\/appraisal-toolbox-releases\/releases\/assets\/\d+$/i;
  const giteePath = /^\/zer0_y\/appraisal-toolbox-releases\/releases\/download\/[^/]+\/[^/]+$/i;
  const official = (url.hostname === "github.com" && releasePath.test(url.pathname))
    || (url.hostname === "api.github.com" && apiPath.test(url.pathname))
    || (url.hostname === "gitee.com" && giteePath.test(url.pathname));
  const cdn = redirected
    && ["objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname)
    && url.pathname !== "/";
  if (!official && !cdn) throw new Error("UPDATE_URL_HOST_NOT_ALLOWED");
  return url;
}

function responseFor(value, signal, redirects = 5, redirected = false) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = allowedAssetUrl(value, redirected); } catch (error) { reject(error); return; }
    const request = https.get(url, {
      signal,
      headers: { "User-Agent": "appraisal-toolbox-updater", Accept: "application/octet-stream" },
    }, (response) => {
      response.on("error", reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirects <= 0) {
          reject(new Error("UPDATE_DOWNLOAD_REDIRECTS_EXHAUSTED"));
          return;
        }
        responseFor(new URL(response.headers.location, url).href, signal, redirects - 1, true)
          .then(resolve, reject);
      } else if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`UPDATE_DOWNLOAD_HTTP_${response.statusCode}`));
      } else {
        resolve(response);
      }
    });
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error("UPDATE_DOWNLOAD_TIMEOUT")));
  });
}

function digestFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadAsset(url, targetPath, expectedSize, expectedSha256, onBytes = () => {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const partialPath = `${targetPath}.part`;
  try {
    const response = await responseFor(url, controller.signal);
    const advertisedSize = response.headers["content-length"];
    if (advertisedSize !== undefined && Number(advertisedSize) !== expectedSize) {
      response.destroy();
      throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
    }
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > expectedSize) return callback(new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH"));
        onBytes(bytes);
        callback(null, chunk);
      },
    });
    await pipeline(response, meter, fs.createWriteStream(partialPath, { flags: "wx", mode: 0o600 }), {
      signal: controller.signal,
    });
    if (bytes !== expectedSize || fs.statSync(partialPath).size !== expectedSize) {
      throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
    }
    if (await digestFile(partialPath) !== expectedSha256) throw new Error("UPDATE_DOWNLOAD_SHA256_MISMATCH");
    fs.renameSync(partialPath, targetPath);
    return { size: bytes, sha256: expectedSha256 };
  } catch (error) {
    fs.rmSync(partialPath, { force: true });
    if (controller.signal.aborted && error?.name === "AbortError") throw new Error("UPDATE_DOWNLOAD_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function isRetryableDownloadError(error) {
  const message = String(error?.message || "");
  if (/^UPDATE_DOWNLOAD_(?:TIMEOUT|NETWORK_[A-Z0-9_]+)$/.test(message)) return true;
  if (/^UPDATE_DOWNLOAD_HTTP_(?:408|425|429|5\d\d)$/.test(message)) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]
    .includes(String(error?.code || "").toUpperCase());
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

function updateLockOwner(lockPath, nonce, update) {
  const ownerPath = path.join(lockPath, "owner.json");
  const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  if (owner.nonce !== nonce || Number(owner.pid) !== process.pid) throw new Error("UPDATE_LOCK_STATE_INVALID");
  const temporaryPath = `${ownerPath}.tmp-${nonce}`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ ...owner, ...update }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, ownerPath);
}

function acquireUpdateLock(lockPath, nonce) {
  const create = () => {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    try {
      fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
        pid: process.pid, nonce, startedAt: new Date().toISOString(),
      }), { mode: 0o600, flag: "wx" });
    } catch (error) {
      fs.rmSync(lockPath, { recursive: true, force: true });
      throw error;
    }
  };
  try { create(); return; }
  catch (error) {
    if (error?.code !== "EEXIST") throw new Error("UPDATE_ALREADY_RUNNING");
  }
  let stat;
  try { stat = fs.lstatSync(lockPath); } catch { throw new Error("UPDATE_ALREADY_RUNNING"); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UPDATE_ALREADY_RUNNING");
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")); } catch { /* an interrupted lock creation is recoverable only after the grace period */ }
  const pids = [Number(owner?.pid), Number(owner?.installerPid)].filter((pid) => Number.isSafeInteger(pid) && pid > 1);
  if (pids.some(processIsAlive) || (pids.length === 0 && Date.now() - stat.mtimeMs < STALE_LOCK_GRACE_MS)) {
    throw new Error("UPDATE_ALREADY_RUNNING");
  }
  try { fs.rmSync(lockPath, { recursive: true }); create(); }
  catch { throw new Error("UPDATE_ALREADY_RUNNING"); }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error("UPDATE_PACKAGE_FILE_MISSING"); }
}

function relativePackagePath(value) {
  const text = String(value || "");
  const parts = text.split("/");
  if (!text || text.startsWith("/") || text.includes("\\") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("UPDATE_PACKAGE_FILE_MISSING");
  }
  return text;
}

function listPackageFiles(root, directory = root, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
    if (entry.isDirectory()) listPackageFiles(root, fullPath, result);
    else if (entry.isFile()) result.push(path.relative(root, fullPath).split(path.sep).join("/"));
    else throw new Error("UPDATE_PACKAGE_FILE_MISSING");
  }
  return result;
}

function verifyPackageChecksums(packageRoot, runFileSync) {
  const listPath = path.join(packageRoot, "SHA256SUMS");
  if (!fs.existsSync(listPath)) throw new Error("UPDATE_SHA256_MISSING");
  const expectedFiles = [];
  for (const line of fs.readFileSync(listPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    if (!/^[0-9a-f]{64}  /i.test(line)) throw new Error("UPDATE_SHA256_INVALID");
    expectedFiles.push(relativePackagePath(line.slice(66)));
  }
  const expected = [...new Set(expectedFiles)].sort();
  if (expected.length !== expectedFiles.length) throw new Error("UPDATE_SHA256_INVALID");
  const actual = listPackageFiles(packageRoot).filter((item) => item !== "SHA256SUMS").sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
  try {
    runFileSync("/usr/bin/shasum", ["-a", "256", "-c", "SHA256SUMS"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5 * 60 * 1000,
    });
  } catch {
    throw new Error("UPDATE_SHA256_MISMATCH");
  }
}

function findPackageRoot(extractRoot) {
  const queue = [{ directory: extractRoot, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (fs.existsSync(path.join(current.directory, "安装.command"))) return current.directory;
    if (current.depth >= 2) continue;
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }
    }
  }
  throw new Error("UPDATE_INSTALLER_NOT_FOUND");
}

async function validatePackage(packageRoot, latest, runFileSync) {
  verifyPackageChecksums(packageRoot, runFileSync);
  const provenance = readJson(path.join(packageRoot, "BUILD-PROVENANCE.json"));
  const version = readJson(path.join(packageRoot, "extension", "version.json"));
  const manifest = readJson(path.join(packageRoot, "extension", "manifest.json"));
  const contract = readJson(path.join(packageRoot, "extension", "runtime-compat.json"));
  const installerPath = path.join(packageRoot, "安装.command");
  for (const required of [
    path.join(packageRoot, "native-helper", "native_host.js"),
    path.join(packageRoot, "runtime", "node", "bin", "node"),
    path.join(packageRoot, "skills"),
    installerPath,
  ]) {
    if (!fs.existsSync(required)) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
  }
  const targetBuild = Number(latest.latestBuildNumber || 0);
  const targetVersion = String(latest.latestVersion || "");
  if (provenance.target !== "macos-arm64"
    || provenance.sourceDirty !== false
    || provenance.productVersion !== targetVersion
    || version.productVersion !== targetVersion
    || Number(version.buildNumber) !== targetBuild
    || Number(provenance.buildNumber) !== targetBuild
    || version.platformBuildId !== provenance.buildId
    || !/^[a-f0-9]{40}$/i.test(String(provenance.sourceCommit || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(String(provenance.buildId || ""))
    || manifest.version !== targetVersion
    || manifest.version_name !== targetVersion
    || contract.extensionVersion !== targetVersion
    || contract.buildId !== provenance.buildId
    || !/^[a-f0-9]{64}$/i.test(String(contract.runtimeBuildId || ""))) {
    throw new Error("UPDATE_TARGET_CHANGED");
  }
  if (latest.latestRuntimeBuildId
    && String(latest.latestRuntimeBuildId) !== String(contract.runtimeBuildId)) {
    throw new Error("UPDATE_TARGET_CHANGED");
  }
  if (provenance.lockSha256 !== await digestFile(path.join(packageRoot, "release-inputs.lock.json"))
    || provenance.sourceInventorySha256 !== await digestFile(path.join(packageRoot, "SOURCE-INVENTORY.json"))) {
    throw new Error("UPDATE_TARGET_CHANGED");
  }
  const installer = fs.readFileSync(installerPath, "utf8");
  const installerBuild = installer.match(/^INSTALLER_BUILD="([^"]+)"$/m)?.[1];
  if (!installerBuild || installerBuild !== provenance.installerBuild) throw new Error("UPDATE_INSTALLER_NOT_FOUND");
  try { fs.accessSync(installerPath, fs.constants.X_OK); } catch { throw new Error("UPDATE_INSTALLER_NOT_FOUND"); }
  if (manifest.manifest_version !== 3 || extensionIdFromKey(manifest.key) !== EXTENSION_ID) {
    throw new Error("UPDATE_TARGET_CHANGED");
  }
  return { packageRoot, installerPath, provenance, version, contract };
}

function installerEnvironment(baseEnvironment, { homeDir, installRoot, pythonBootstrap }) {
  const env = { ...baseEnvironment };
  for (const key of Object.keys(env)) {
    if (/^(?:TIANYUAN_|PYTHON(?:HOME|PATH|BIN)?$|APPRAISAL_TEST_|APPRAISAL_TOOLBOX_ROOT$|APPRAISAL_BROWSER_HOME$|APPRAISAL_PYTHON_BOOTSTRAP$|DYLD_)/i.test(key)) {
      delete env[key];
    }
  }
  env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  env.HOME = homeDir;
  env.APPRAISAL_TOOLBOX_ROOT = installRoot;
  env.APPRAISAL_BROWSER_HOME = homeDir;
  env.APPRAISAL_PYTHON_BOOTSTRAP = pythonBootstrap;
  env.APPRAISAL_INSTALL_NO_OPEN = "1";
  return env;
}

function runProcess(command, args, options, timeoutMs, spawnProcess, onStarted = null) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let escalation = null;
    const child = spawnProcess(command, args, { ...options, detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* close event decides */ } }
      escalation = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* close event decides */ } }
      }, 30000);
    }, timeoutMs);
    let startupError = null;
    child.once("error", () => {
      clearTimeout(timer);
      clearTimeout(escalation);
      reject(startupError || new Error("UPDATE_INSTALLER_NOT_STARTED"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (startupError) reject(startupError);
      else if (timedOut) reject(new Error("UPDATE_PROCESS_TIMEOUT"));
      else if (code !== 0) reject(new Error(`UPDATE_INSTALLER_EXIT_${code ?? -1}`));
      else resolve(code);
    });
    if (typeof onStarted === "function") {
      try { onStarted(child); }
      catch {
        startupError = new Error("UPDATE_LOCK_STATE_WRITE_FAILED");
        try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* close event decides */ } }
      }
    }
  });
}

function checkPythonRuntime(installRoot, runFileSync) {
  const pythonBootstrap = path.join(installRoot, "python", "bin", "python3");
  if (!fs.existsSync(pythonBootstrap) || !fs.statSync(pythonBootstrap).isFile()) {
    throw new Error("UPDATE_PYTHON_RUNTIME_UNAVAILABLE");
  }
  let version = "";
  try {
    version = String(runFileSync(pythonBootstrap, ["--version"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    }) || "").trim();
  } catch {
    throw new Error("UPDATE_PYTHON_RUNTIME_UNAVAILABLE");
  }
  if (version !== `Python ${PYTHON_VERSION}`) throw new Error("UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED");
  try {
    runFileSync(pythonBootstrap, ["-c", "import ensurepip, venv"], {
      stdio: ["ignore", "ignore", "ignore"], timeout: 5000,
    });
  } catch {
    throw new Error("UPDATE_PYTHON_RUNTIME_ABI_UNSUPPORTED");
  }
  return pythonBootstrap;
}

function compareVersions(left, right) {
  const a = String(left || "").replace(/^v/i, "").split(".").map(Number);
  const b = String(right || "").replace(/^v/i, "").split(".").map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error("UPDATE_TARGET_CHANGED");
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function verifyInstalled({ installRoot, homeDir, packageDetails, pythonBootstrap, runFileSync, verificationEnvironment = {} }) {
  const version = readJson(path.join(installRoot, "extension", "version.json"));
  const contract = readJson(path.join(installRoot, "extension", "runtime-compat.json"));
  const config = readJson(path.join(installRoot, "native-helper", "runtime-config.json"));
  const extensionManifest = readJson(path.join(installRoot, "extension", "manifest.json"));
  const expectedVersion = packageDetails.version;
  const expectedLauncher = path.join(installRoot, "native-helper", "native_host_launcher.sh");
  if (version.productVersion !== expectedVersion.productVersion
    || Number(version.buildNumber) !== Number(expectedVersion.buildNumber)
    || version.platformBuildId !== expectedVersion.platformBuildId
    || contract.runtimeBuildId !== packageDetails.contract.runtimeBuildId
    || config.toolboxExtensionId !== EXTENSION_ID
    || config.nativeHostName !== NATIVE_HOST
    || config.pythonBin !== pythonBootstrap
    || config.printSkillsDir !== path.join(installRoot, "skills")
    || extensionManifest.manifest_version !== 3
    || extensionIdFromKey(extensionManifest.key) !== EXTENSION_ID
    || extensionManifest.key !== readJson(path.join(packageDetails.packageRoot, "extension", "manifest.json")).key
    || !fs.existsSync(expectedLauncher)) {
    throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
  }
  const report = fs.readFileSync(path.join(installRoot, "安装检查结果.txt"), "utf8");
  if (!report.includes("安装状态：成功")
    || !report.includes(`版本：${expectedVersion.productVersion}`)
    || !report.includes(`源码：${packageDetails.provenance.sourceCommit}`)
    || !report.includes(`扩展 ID：${EXTENSION_ID}`)
    || !report.includes(`Native Host：${NATIVE_HOST}`)) {
    throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
  }
  const launcherMode = fs.statSync(expectedLauncher).mode;
  if ((launcherMode & fs.constants.S_IXUSR) === 0) throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
  const registrations = [
    path.join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${NATIVE_HOST}.json`),
    path.join(homeDir, "Library/Application Support/Microsoft Edge/NativeMessagingHosts", `${NATIVE_HOST}.json`),
  ];
  for (const manifestPath of registrations) {
    const nativeManifest = readJson(manifestPath);
    if (nativeManifest.name !== NATIVE_HOST
      || nativeManifest.path !== expectedLauncher
      || nativeManifest.type !== "stdio"
      || JSON.stringify(nativeManifest.allowed_origins) !== JSON.stringify([`chrome-extension://${EXTENSION_ID}/`])) {
      throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
    }
  }
  const nodePath = path.join(installRoot, "runtime/node/bin/node");
  const helperPath = path.join(installRoot, "native-helper/native_host.js");
  if (fs.readFileSync(path.join(installRoot, "extension/version.json"), "utf8")
    !== fs.readFileSync(path.join(packageDetails.packageRoot, "extension/version.json"), "utf8")
    || fs.readFileSync(helperPath, "utf8")
      !== fs.readFileSync(path.join(packageDetails.packageRoot, "native-helper/native_host.js"), "utf8")) {
    throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
  }
  const env = installerEnvironment(process.env, { homeDir, installRoot, pythonBootstrap });
  Object.assign(env, verificationEnvironment);
  const selfTest = runFileSync(nodePath, [helperPath, "--self-test"], {
    cwd: path.dirname(helperPath),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    env,
  });
  let selfTestResult;
  try { selfTestResult = JSON.parse(String(selfTest || "")); }
  catch { throw new Error("UPDATE_COMPLETION_STATUS_MISSING"); }
  if (!selfTestResult.ok || !selfTestResult.pythonSkillImportSmoke?.ok) {
    throw new Error("UPDATE_COMPLETION_STATUS_MISSING");
  }
  return { productVersion: version.productVersion, buildNumber: Number(version.buildNumber), buildId: packageDetails.provenance.buildId };
}

function rollbackFromInstallerLog({ installRoot, logPath, homeDir, expectedVersion, nonce }) {
  let log = "";
  try { log = fs.readFileSync(logPath, "utf8"); } catch { return false; }
  const backupText = log.match(/^旧运行目录备份保留：(.+)$/m)?.[1]?.trim();
  if (!backupText) return false;
  const backupRoot = path.resolve(backupText);
  if (path.dirname(backupRoot) !== homeDir
    || !/^\.appraisal-toolbox\.previous-\d+$/.test(path.basename(backupRoot))
    || !fs.existsSync(backupRoot)
    || fs.lstatSync(backupRoot).isSymbolicLink()) return false;
  const failedRoot = `${installRoot}.failed-${nonce}`;
  if (fs.existsSync(failedRoot)) return false;
  try {
    fs.renameSync(installRoot, failedRoot);
    fs.renameSync(backupRoot, installRoot);
    const restored = readJson(path.join(installRoot, "extension", "version.json"));
    if (restored.productVersion !== expectedVersion.productVersion
      || Number(restored.buildNumber) !== Number(expectedVersion.buildNumber)) {
      fs.renameSync(installRoot, backupRoot);
      fs.renameSync(failedRoot, installRoot);
      return false;
    }
    fs.rmSync(failedRoot, { recursive: true, force: true });
    return true;
  } catch {
    try { if (!fs.existsSync(installRoot) && fs.existsSync(failedRoot)) fs.renameSync(failedRoot, installRoot); } catch { /* preserve recovery paths */ }
    return false;
  }
}

function createMacOSUpdateEngine(options = {}) {
  const platform = options.platform || process.platform;
  const architecture = options.architecture || process.arch;
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const installRoot = path.resolve(options.installRoot || path.join(homeDir, ".appraisal-toolbox"));
  const updatesRoot = path.resolve(options.updatesRoot || path.join(homeDir, ".appraisal-toolbox-updates"));
  const spawnProcess = options.spawn || spawn;
  const runFileSync = options.execFileSync || execFileSync;
  const download = options.downloadAsset || downloadAsset;
  const downloadAttempts = Math.max(1, Math.min(5, Number(options.downloadAttempts) || DOWNLOAD_ATTEMPTS));
  const retryDelayMs = Math.max(0, Math.min(30000, Number(options.retryDelayMs) || DOWNLOAD_RETRY_DELAY_MS));
  const wait = options.sleep || ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
  const extract = options.extractZip || ((zipPath, destination) => runProcess(
    "/usr/bin/ditto", ["-x", "-k", zipPath, destination],
    { cwd: path.dirname(zipPath), stdio: "ignore" }, 3 * 60 * 1000, spawnProcess,
  ));
  const installPackage = options.installPackage || (async ({ installerPath, packageRoot, logPath, env, onStarted }) => {
    const logFd = fs.openSync(logPath, "wx", 0o600);
    try {
      return await runProcess("/bin/bash", [installerPath], {
        cwd: packageRoot,
        env,
        stdio: ["ignore", logFd, logFd],
      }, INSTALL_TIMEOUT_MS, spawnProcess, onStarted);
    } finally {
      fs.closeSync(logFd);
    }
  });
  let updating = false;

  function capabilities() { return capabilitiesFor(platform, architecture); }

  async function downloadAndInstallUpdate(message = {}, emit = () => {}, checkUpdate) {
    let updateRoot = "";
    let lockPath = "";
    let lockAcquired = false;
    let originalCwd = "";
    let installerStarted = false;
    let installerHeartbeat = null;
    let currentVersion = null;
    let final;
    const nonce = crypto.randomUUID();
    const progress = (percent, phase, text) => emit({
      ok: true,
      event: "progress",
      action: "download_and_install_update",
      phase,
      percent,
      message: text,
      security: { credentialsReturned: false },
    });
    try {
      if (!capabilities().autoUpdateSupported) throw new Error("PLATFORM_UPDATE_UNSUPPORTED");
      if (updating) throw new Error("UPDATE_ALREADY_RUNNING");
      updating = true;
      if (!fs.existsSync(installRoot) || fs.lstatSync(installRoot).isSymbolicLink()) {
        throw new Error("UPDATE_EXTENSION_PATH_REQUIRED");
      }
      const nativeRoot = path.join(installRoot, "native-helper");
      const config = readJson(path.join(nativeRoot, "runtime-config.json"));
      const current = readJson(path.join(installRoot, "extension", "version.json"));
      const contract = readJson(path.join(installRoot, "extension", "runtime-compat.json"));
      const currentManifest = readJson(path.join(installRoot, "extension", "manifest.json"));
      for (const component of ["extension", "native-helper", "python", "runtime", "skills"]) {
        const componentPath = path.join(installRoot, component);
        if (fs.existsSync(componentPath) && fs.lstatSync(componentPath).isSymbolicLink()) {
          throw new Error("UPDATE_STAGING_PATH_INVALID");
        }
      }
      if (extensionIdFromKey(currentManifest.key) !== EXTENSION_ID
        || config.toolboxExtensionId !== EXTENSION_ID
        || config.nativeHostName !== NATIVE_HOST) {
        throw new Error("UPDATE_EXTENSION_PATH_REQUIRED");
      }
      currentVersion = { productVersion: String(current.productVersion || ""), buildNumber: Number(current.buildNumber || 0) };
      const pythonBootstrap = checkPythonRuntime(installRoot, runFileSync);
      const requestSha = String(message.sha256 || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(requestSha)) throw new Error("UPDATE_SHA256_REQUIRED");
      if (typeof checkUpdate !== "function") throw new Error("UPDATE_CHECK_FAILED");
      progress(1, "preflight", "正在核对官方发布记录与本机运行环境…");
      const latest = await checkUpdate({
        repository: REPOSITORY,
        currentVersion: current.productVersion,
        currentBuildNumber: current.buildNumber,
        currentRuntimeBuildId: contract.runtimeBuildId,
        currentRuntimeBuildKind: contract.runtimeBuildKind,
        platform: "darwin",
        architecture: "arm64",
      });
      if (!latest?.ok) throw new Error(latest?.reason || "UPDATE_CHECK_FAILED");
      if (!latest.releasePublished || latest.platform !== "macos-arm64"
        || (!latest.updateAvailable && !latest.repairRequired)) throw new Error("UPDATE_NOT_REQUIRED");
      const targetBuild = Number(latest.latestBuildNumber || 0);
      const comparison = compareVersions(latest.latestVersion, current.productVersion);
      if (comparison < 0 || (comparison === 0 && targetBuild < Number(current.buildNumber || 0))) {
        throw new Error("UPDATE_TARGET_CHANGED");
      }
      if (!Number.isSafeInteger(targetBuild) || targetBuild < 1) throw new Error("UPDATE_TARGET_CHANGED");
      const targetSha = String(latest.asset?.sha256 || "").replace(/^sha256:/i, "").toLowerCase();
      const targetSize = Number(latest.asset?.size || 0);
      if (!/^[a-f0-9]{64}$/.test(targetSha)) throw new Error("UPDATE_SHA256_MISSING");
      if (targetSha !== requestSha) throw new Error("UPDATE_TARGET_CHANGED");
      if (!Number.isSafeInteger(targetSize) || targetSize <= 0) throw new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH");
      const candidates = [...new Map([
        ...(Array.isArray(latest.downloadCandidates) ? latest.downloadCandidates : []),
        latest.asset || {},
      ].filter((candidate) => candidate?.url).map((candidate) => [String(candidate.url), candidate])).values()];
      const requestedUrl = allowedAssetUrl(message.url).href;
      if (!candidates.some((candidate) => allowedAssetUrl(candidate.url).href === requestedUrl)) {
        throw new Error("UPDATE_TARGET_CHANGED");
      }

      if (fs.existsSync(updatesRoot) && fs.lstatSync(updatesRoot).isSymbolicLink()) {
        throw new Error("UPDATE_STAGING_PATH_INVALID");
      }
      fs.mkdirSync(updatesRoot, { recursive: true, mode: 0o700 });
      fs.chmodSync(updatesRoot, 0o700);
      lockPath = path.join(homeDir, ".appraisal-toolbox-update.lock");
      acquireUpdateLock(lockPath, nonce);
      lockAcquired = true;
      updateRoot = fs.mkdtempSync(path.join(updatesRoot, `run-${nonce.slice(0, 8)}-`));
      const zipPath = path.join(updateRoot, "package.zip");
      const extractRoot = path.join(updateRoot, "extracted");
      const logPath = path.join(updateRoot, "installer.log");
      fs.mkdirSync(extractRoot, { mode: 0o700 });
      let downloaded = false;
      let downloadFailure = null;
      for (const candidate of candidates) {
        const url = String(candidate.url || "");
        try {
          allowedAssetUrl(url);
          const candidateSha = String(candidate.sha256 || targetSha).replace(/^sha256:/i, "").toLowerCase();
          if (candidateSha !== targetSha) continue;
          for (let attempt = 1; attempt <= downloadAttempts; attempt += 1) {
            try {
              progress(2, "downloading", "正在下载官方 macOS 安装包…");
              await download(url, zipPath, targetSize, targetSha, (bytes) => {
                progress(Math.min(58, 2 + bytes / targetSize * 56), "downloading", "正在下载更新包…");
              });
              downloaded = true;
              break;
            } catch (error) {
              downloadFailure = error;
              fs.rmSync(zipPath, { force: true });
              if (!isRetryableDownloadError(error) || attempt >= downloadAttempts) break;
              progress(2, "downloading", `下载连接中断，正在重试（${attempt + 1}/${downloadAttempts}）…`);
              await wait(retryDelayMs * attempt);
            }
          }
          if (downloaded) break;
        } catch (error) {
          downloadFailure = error;
          fs.rmSync(zipPath, { force: true });
        }
      }
      if (!downloaded) throw downloadFailure || new Error("UPDATE_DOWNLOAD_CHANNELS_FAILED");
      progress(60, "verifying", "正在校验下载包和内部文件清单…");
      if (fs.statSync(zipPath).size !== targetSize || await digestFile(zipPath) !== targetSha) {
        throw new Error("UPDATE_DOWNLOAD_SHA256_MISMATCH");
      }
      progress(68, "extracting", "正在安全暂存更新包…");
      await extract(zipPath, extractRoot);
      const packageRoot = findPackageRoot(extractRoot);
      const packageDetails = await validatePackage(packageRoot, latest, runFileSync);
      progress(78, "installing", "正在安装组件、Python 依赖并登记 Chrome / Edge Native Host…");
      const env = installerEnvironment(process.env, { homeDir, installRoot, pythonBootstrap });
      originalCwd = process.cwd();
      process.chdir(updateRoot);
      installerStarted = true;
      installerHeartbeat = setInterval(() => {
        progress(80, "installing", "安装器正在配置组件，请保持浏览器开启…");
      }, 10000);
      try {
        await installPackage({
          installerPath: packageDetails.installerPath,
          packageRoot,
          logPath,
          env,
          onStarted: (child) => updateLockOwner(lockPath, nonce, { installerPid: Number(child.pid) }),
        });
      } finally {
        clearInterval(installerHeartbeat);
        installerHeartbeat = null;
      }
      progress(94, "verifying_install", "正在核验扩展版本、Native Host 与运行环境…");
      let installed;
      try {
        installed = verifyInstalled({
          installRoot,
          homeDir,
          packageDetails,
          pythonBootstrap: path.join(installRoot, "python", "bin", "python3"),
          runFileSync,
          verificationEnvironment: options.verificationEnvironment,
        });
      } catch (error) {
        rollbackFromInstallerLog({ installRoot, logPath, homeDir, expectedVersion: currentVersion, nonce });
        throw error;
      }
      final = {
        ok: true,
        phase: "complete",
        percent: 100,
        message: "更新安装与配置核验完成；即将重新加载扩展。",
        platform: "macos-arm64",
        latestVersion: installed.productVersion,
        latestBuildNumber: installed.buildNumber,
        buildId: installed.buildId,
        installerLogPath: logPath,
        currentVersionUnchanged: false,
      };
      fs.rmSync(zipPath, { force: true });
      fs.rmSync(extractRoot, { recursive: true, force: true });
    } catch (error) {
      const raw = String(error?.message || "");
      const reason = /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(raw)
        ? raw
        : "UPDATE_FAILED";
      let currentVersionUnchanged = null;
      try {
        const now = readJson(path.join(installRoot, "extension", "version.json"));
        currentVersionUnchanged = Boolean(currentVersion
          && now.productVersion === currentVersion.productVersion
          && Number(now.buildNumber) === Number(currentVersion.buildNumber));
      } catch { /* preserve unknown when the installation cannot be read */ }
      final = {
        ok: false,
        phase: "failed",
        percent: installerStarted ? 78 : 1,
        reason,
        message: "更新未完成；当前版本状态已核验，请查看本机更新日志。",
        currentVersionUnchanged,
        diagnostics: {
          stagePath: updateRoot || null,
          installerLogPath: fs.existsSync(path.join(updateRoot, "installer.log")) ? path.join(updateRoot, "installer.log") : null,
          installerStarted,
        },
      };
    } finally {
      clearInterval(installerHeartbeat);
      if (originalCwd) { try { process.chdir(originalCwd); } catch { /* leave the process outside the replaced install tree */ } }
      updating = false;
      if (lockAcquired && lockPath && final?.reason !== "UPDATE_PROCESS_TIMEOUT") {
        try { fs.rmSync(lockPath, { recursive: true, force: true }); }
        catch { final = { ok: false, phase: "failed", reason: "UPDATE_LOCK_RELEASE_FAILED", currentVersionUnchanged: null }; }
      }
      if (updateRoot && !installerStarted && final?.ok !== true) {
        fs.rmSync(updateRoot, { recursive: true, force: true });
      }
    }
    const result = { ...final, event: "complete", action: "download_and_install_update", security: { credentialsReturned: false } };
    emit(result);
    return result;
  }

  return { capabilities, downloadAndInstallUpdate, isUpdating: () => updating };
}

module.exports = {
  allowedAssetUrl,
  capabilitiesFor,
  compareVersions,
  extensionIdFromKey,
  createMacOSUpdateEngine,
};
