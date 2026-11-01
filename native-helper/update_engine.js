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

function createShortExtractionRoot() {
  const candidates = [...new Set([process.env.USERPROFILE, process.env.LOCALAPPDATA]
    .map(value => String(value || "").trim())
    .filter(value => path.isAbsolute(value))
    .map(value => path.resolve(value)))].sort((left, right) => left.length - right.length);
  for (const base of candidates) {
    try {
      if (!fs.statSync(base).isDirectory()) continue;
      let safe = true;
      for (let current = base; ; current = path.dirname(current)) {
        if (fs.lstatSync(current).isSymbolicLink()) { safe = false; break; }
        if (path.dirname(current) === current) break;
      }
      if (!safe) continue;
      const extracted = fs.mkdtempSync(path.join(base, "ATU-"));
      if (fs.lstatSync(extracted).isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
      return extracted;
    } catch (error) {
      if (error?.message === "UPDATE_STAGING_PATH_INVALID") throw error;
    }
  }
  throw new Error("UPDATE_STAGING_PATH_INVALID");
}

function tailFile(filePath, maxLines = 20, maxChars = 6000) {
  try {
    return fs.readFileSync(filePath).toString("latin1").replace(/\r/g, "")
      .split("\n").filter(line => line && !line.includes("APPRAISAL_UPDATE_ERROR:")).slice(-maxLines).join("\n").slice(-maxChars);
  } catch { return ""; }
}

function redactExtractionText(value, roots = []) {
  let text = String(value || "");
  for (const root of [...new Set(roots.map(item => String(item || "")).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    text = text.split(root).join("[本机暂存路径]");
  }
  for (const [value, label] of [[process.env.USERPROFILE, "%USERPROFILE%"], [process.env.LOCALAPPDATA, "%LOCALAPPDATA%"]]) {
    if (value) text = text.split(String(value)).join(label);
  }
  return text.replace(/https?:\/\/\S+/g, "[url]").slice(-6000);
}

function readExtractionMarker(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath); } catch { return null; }
  for (const text of [raw.toString("latin1"), raw.toString("utf8"), raw.toString("utf16le")]) {
    const match = text.match(/APPRAISAL_UPDATE_ERROR:([A-Za-z0-9+/=]+)/);
    if (!match) continue;
    try { return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")); } catch { return null; }
  }
  return null;
}

function processError(code, properties = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, properties);
  return error;
}

const UPDATE_LOCK_PID_REUSE_TOLERANCE_MS = 5000;
const UPDATE_LOCK_SCHEMA_VERSION = 2;
const UPDATE_LOCK_SAFE_PHASES = new Set(["preflight", "downloading", "verifying", "extracting", "package_verified"]);
const UPDATE_LOCK_TERMINAL_OUTCOMES = new Set(["completed", "rolled_back", "failed_before_install"]);

function updateLockMutexName(lockPath) {
  let input = String(lockPath).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  const absolute = path.resolve(input);
  const parent = fs.realpathSync.native(path.dirname(absolute));
  const canonicalParent = String(parent).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  const normalized = path.join(canonicalParent, path.basename(absolute)).replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase("en-US");
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  return `Global\\AppraisalToolboxUpdate-${digest}`;
}

const WINDOWS_UPDATE_MUTEX_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$mutex=$null; $owns=$false",
  "try {",
  "  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
  "  if($null -eq $sid){ throw 'identity-unavailable' }",
  "  $security=[System.Security.AccessControl.MutexSecurity]::new()",
  "  $rule=[System.Security.AccessControl.MutexAccessRule]::new($sid,[System.Security.AccessControl.MutexRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow)",
  "  $security.AddAccessRule($rule)",
  "  $created=$false",
  "  $mutex=[System.Threading.Mutex]::new($false,$env:APPRAISAL_UPDATE_MUTEX_NAME,[ref]$created,$security)",
  "  try { $owns=$mutex.WaitOne(5000) } catch [System.Threading.AbandonedMutexException] { $mutex.ReleaseMutex(); [Console]::Out.WriteLine('ABANDONED'); exit 7 }",
  "  if(-not $owns){ [Console]::Out.WriteLine('BUSY'); exit 8 }",
  "  [Console]::Out.WriteLine('READY')",
  "  $command=[Console]::In.ReadLine()",
  "  if($command -cne 'RELEASE'){ exit 9 }",
  "} catch { [Console]::Out.WriteLine('ERROR'); exit 10 } finally {",
  "  if($owns){ try { $mutex.ReleaseMutex() } catch {} }",
  "  if($mutex){ $mutex.Dispose() }",
  "}",
].join("\n");

function acquireGlobalUpdateMutex(lockPath, { spawnProcess = spawn, timeoutMs = 12000 } = {}) {
  if (process.platform !== "win32") return Promise.reject(processError("UPDATE_LOCK_ARBITRATION_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    const mutexName = updateLockMutexName(lockPath);
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    let child, buffer = "", settled = false, timer;
    const finishError = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(processError(code));
    };
    try {
      child = spawnProcess(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_UPDATE_MUTEX_SCRIPT], {
        env: { ...process.env, APPRAISAL_UPDATE_MUTEX_NAME: mutexName },
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch { finishError("UPDATE_LOCK_ARBITRATION_FAILED"); return; }
    const lease = {
      mutexName,
      child,
      active: true,
      release() {
        if (!lease.active) return Promise.reject(processError("UPDATE_LOCK_ARBITRATION_FAILED"));
        return new Promise((resolveRelease, rejectRelease) => {
          let releaseSettled = false;
          const releaseTimer = setTimeout(() => {
            if (releaseSettled) return;
            releaseSettled = true;
            try { child.kill(); } catch { /* process handle may already be closed */ }
            rejectRelease(processError("UPDATE_LOCK_ARBITRATION_FAILED"));
          }, 12000);
          child.once("error", () => {
            if (releaseSettled) return;
            releaseSettled = true;
            clearTimeout(releaseTimer);
            rejectRelease(processError("UPDATE_LOCK_ARBITRATION_FAILED"));
          });
          child.once("close", code => {
            lease.active = false;
            if (releaseSettled) return;
            releaseSettled = true;
            clearTimeout(releaseTimer);
            if (code === 0) resolveRelease();
            else rejectRelease(processError("UPDATE_LOCK_ARBITRATION_FAILED"));
          });
          try { child.stdin.write("RELEASE\n", error => { if (error && !releaseSettled) { releaseSettled = true; clearTimeout(releaseTimer); rejectRelease(processError("UPDATE_LOCK_ARBITRATION_FAILED")); } }); }
          catch { releaseSettled = true; clearTimeout(releaseTimer); rejectRelease(processError("UPDATE_LOCK_ARBITRATION_FAILED")); }
        });
      },
    };
    child.stdout?.on("data", chunk => {
      buffer = (buffer + chunk.toString("utf8")).slice(-512);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const value = line.trim();
        if (value === "READY" && !settled) {
          settled = true;
          clearTimeout(timer);
          child.once("close", () => { lease.active = false; });
          child.once("error", () => { lease.active = false; });
          resolve(lease);
        } else if (["BUSY", "ABANDONED", "ERROR"].includes(value)) {
          const code = value === "BUSY" ? "UPDATE_ALREADY_RUNNING" : value === "ABANDONED" ? "UPDATE_LOCK_ARBITRATION_ABANDONED" : "UPDATE_LOCK_ARBITRATION_FAILED";
          finishError(code);
          try { child.kill(); } catch { /* process may already be closing */ }
        }
      }
    });
    child.once("error", () => finishError("UPDATE_LOCK_ARBITRATION_FAILED"));
    child.once("close", () => { if (!settled) finishError("UPDATE_LOCK_ARBITRATION_FAILED"); });
    timer = setTimeout(() => {
      finishError("UPDATE_LOCK_ARBITRATION_FAILED");
      try { child.kill(); } catch { /* process may already be closing */ }
    }, timeoutMs);
  });
}

function writeAtomicJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx");
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* preserve original failure */ } }
    try { fs.rmSync(temporary, { force: true }); } catch { /* leave the original journal intact */ }
    throw error;
  }
}

function readLockJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("lock-record-invalid");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function lockOwnerMatchesState(owner, state) {
  return state?.schemaVersion === UPDATE_LOCK_SCHEMA_VERSION
    && Number(state.ownerPid) === Number(owner.pid)
    && state.nonce === owner.nonce
    && state.ownerStartedAtUtc === owner.startedAtUtc;
}

function isTerminalLockState(state) {
  return state?.recoveryRequired === false
    && state.installerStartPending !== true
    && state.workerStartPending !== true
    && state.recoveryStartPending !== true
    && UPDATE_LOCK_TERMINAL_OUTCOMES.has(state?.terminalOutcome)
    && (!state.installerStarted || state.installerProcess?.exitObserved === true)
    && (!state.workerProcess || state.workerProcess.exitObserved === true)
    && (!state.recoveryProcess || state.recoveryProcess.exitObserved === true);
}

async function isReclaimableLockState(state, readProcessStartTime) {
  if (isTerminalLockState(state)) return { reclaimable: true, classification: "verified_terminal_transaction" };
  if (state.recoveryRequired === true || state.installerStartPending === true || state.installerStarted !== false
    || state.recoveryStartPending === true || state.recoveryProcess || !UPDATE_LOCK_SAFE_PHASES.has(state.phase)) {
    return { reclaimable: false, classification: "recovery_required" };
  }
  if (state.workerStartPending === true) return { reclaimable: false, classification: "worker_start_unverified" };
  const worker = state.workerProcess;
  if (worker) {
    if (worker.role !== "extraction") return { reclaimable: false, classification: "worker_identity_unverified" };
    if (worker.exitObserved === true || worker.spawnFailed === true) return { reclaimable: true, classification: "worker_exit_observed" };
    const pid = Number(worker.pid), startedAtMs = Date.parse(worker.spawnedAtUtc || "");
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(startedAtMs)) return { reclaimable: false, classification: "worker_identity_unverified" };
    let currentStart;
    try { currentStart = await readProcessStartTime(pid); } catch { currentStart = null; }
    if (currentStart === "PROCESS_MISSING") return { reclaimable: true, classification: "worker_process_exited" };
    const currentStartMs = Date.parse(currentStart || "");
    if (!Number.isFinite(currentStartMs)) return { reclaimable: false, classification: "worker_identity_unverified" };
    if (currentStartMs > startedAtMs + UPDATE_LOCK_PID_REUSE_TOLERANCE_MS) return { reclaimable: true, classification: "worker_pid_reused" };
    if (currentStartMs < startedAtMs - UPDATE_LOCK_PID_REUSE_TOLERANCE_MS) return { reclaimable: false, classification: "worker_identity_unverified" };
    return { reclaimable: false, classification: "worker_process_active" };
  }
  if (state.phase === "extracting") return { reclaimable: false, classification: "worker_identity_unverified" };
  return { reclaimable: true, classification: "owner_process_exited_before_install" };
}

function classifyUpdateLockOwner({ owner, lockMtimeMs, processStartTimeUtc, nowMs = Date.now() }) {
  if (!owner) return { stale: false, classification: "owner_unverified" };
  const pid = Number(owner.pid);
  const attemptStartedAt = Date.parse(owner.startedAtUtc || "");
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(attemptStartedAt)) {
    return { stale: false, classification: "owner_unverified" };
  }
  if (processStartTimeUtc === "PROCESS_MISSING") {
    return { stale: true, classification: "owner_process_exited" };
  }
  const processStartedAt = Date.parse(processStartTimeUtc || "");
  if (!Number.isFinite(processStartedAt)) {
    return { stale: false, classification: "owner_unverified" };
  }
  if (processStartedAt > attemptStartedAt + UPDATE_LOCK_PID_REUSE_TOLERANCE_MS) {
    return { stale: true, classification: "owner_pid_reused" };
  }
  return { stale: false, classification: "owner_process_active" };
}

function readWindowsProcessStartTime(pid, spawnProcess = spawn, timeoutMs = 5000) {
  if (process.platform !== "win32" || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let output = "", settled = false, timer;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const script = [
      "$ErrorActionPreference='Continue'",
      "$id=[int]$env:APPRAISAL_UPDATE_OWNER_PID",
      "$queryErrors=@()",
      "$p=Get-Process -Id $id -ErrorAction SilentlyContinue -ErrorVariable queryErrors",
      "if($null -ne $p){try{[Console]::Out.Write($p.StartTime.ToUniversalTime().ToString('o'))}catch{[Console]::Out.Write('PROCESS_QUERY_FAILED')}}elseif($queryErrors.Count -gt 0 -and $queryErrors[0].CategoryInfo.Category -eq 'ObjectNotFound'){[Console]::Out.Write('PROCESS_MISSING')}else{[Console]::Out.Write('PROCESS_QUERY_FAILED')}",
    ].join("; ");
    let child;
    try {
      child = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        env: { ...process.env, APPRAISAL_UPDATE_OWNER_PID: String(Number(pid)) },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    child.stdout?.on("data", chunk => { output = (output + chunk.toString("utf8")).slice(-128); });
    child.once("error", () => finish(null));
    child.once("close", code => {
      const value = output.trim();
      if (code !== 0) return finish(null);
      if (value === "PROCESS_MISSING") return finish(value);
      if (value === "PROCESS_QUERY_FAILED") return finish(null);
      finish(Number.isFinite(Date.parse(value)) ? value : null);
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* an unresponsive query remains unverified */ }
      finish(null);
    }, timeoutMs);
  });
}

async function acquireUpdateLock(lockPath, nonce, { readProcessStartTime = readWindowsProcessStartTime, now = Date.now, acquireMutex = acquireGlobalUpdateMutex } = {}) {
  const mutex = await acquireMutex(lockPath);
  const ownerStartedAtUtc = new Date(now()).toISOString();
  let recovered = false;
  let initializingPath;
  try {
    try {
      const stat = fs.lstatSync(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw processError("UPDATE_LOCK_OWNER_UNVERIFIED");
      let owner, state;
      try {
        owner = readLockJson(path.join(lockPath, "owner.json"));
        state = readLockJson(path.join(lockPath, "transaction.json"));
      } catch { throw processError("UPDATE_LOCK_OWNER_UNVERIFIED", { lockClassification: "owner_or_transaction_unverified" }); }
      if (!lockOwnerMatchesState(owner, state)) throw processError("UPDATE_LOCK_OWNER_UNVERIFIED", { lockClassification: "transaction_identity_mismatch" });

      let processStartTimeUtc;
      try { processStartTimeUtc = await readProcessStartTime(Number(owner.pid)); }
      catch { processStartTimeUtc = null; }
      const ownerStatus = classifyUpdateLockOwner({ owner, processStartTimeUtc, nowMs: now() });
      if (ownerStatus.classification === "owner_unverified") {
        throw processError("UPDATE_LOCK_OWNER_UNVERIFIED", { lockClassification: ownerStatus.classification });
      }
      if (ownerStatus.classification === "owner_process_active") {
        throw processError(state.recoveryRequired === true ? "UPDATE_RECOVERY_REQUIRED" : "UPDATE_ALREADY_RUNNING", { lockClassification: ownerStatus.classification, phase: state.phase });
      }
      if (!isTerminalLockState(state)) {
        const reclaim = await isReclaimableLockState(state, readProcessStartTime);
        if (!reclaim.reclaimable) {
          throw processError(reclaim.classification.endsWith("unverified") ? "UPDATE_LOCK_OWNER_UNVERIFIED" : "UPDATE_RECOVERY_REQUIRED", { lockClassification: reclaim.classification, phase: state.phase });
        }
      }

      const stalePath = `${lockPath}.stale-${now()}-${crypto.randomBytes(8).toString("hex")}`;
      const currentOwner = readLockJson(path.join(lockPath, "owner.json"));
      const currentState = readLockJson(path.join(lockPath, "transaction.json"));
      if (!lockOwnerMatchesState(currentOwner, currentState)
        || currentOwner.nonce !== owner.nonce
        || currentOwner.startedAtUtc !== owner.startedAtUtc
        || Number(currentOwner.pid) !== Number(owner.pid)) {
        throw processError("UPDATE_LOCK_OWNER_UNVERIFIED", { lockClassification: "lock_identity_changed" });
      }
      fs.renameSync(lockPath, stalePath);
      recovered = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    initializingPath = `${lockPath}.new-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
    fs.mkdirSync(initializingPath);
    const owner = { schemaVersion: UPDATE_LOCK_SCHEMA_VERSION, pid: process.pid, nonce, startedAtUtc: ownerStartedAtUtc };
    const state = {
      schemaVersion: UPDATE_LOCK_SCHEMA_VERSION,
      ownerPid: process.pid,
      nonce,
      ownerStartedAtUtc,
      phase: "preflight",
      installerStarted: false,
      installerStartPending: false,
      installerProcess: null,
      workerStartPending: false,
      workerProcess: null,
      recoveryStartPending: false,
      recoveryProcess: null,
      recoveryRequired: false,
      terminalOutcome: null,
      updatedAtUtc: new Date(now()).toISOString(),
    };
    writeAtomicJson(path.join(initializingPath, "owner.json"), owner);
    writeAtomicJson(path.join(initializingPath, "transaction.json"), state);
    fs.renameSync(initializingPath, lockPath);
    initializingPath = undefined;
    return { lockPath, ownerPid: process.pid, nonce, ownerStartedAtUtc, recovered, mutex, state };
  } catch (error) {
    if (initializingPath) {
      try { fs.rmSync(initializingPath, { recursive: true, force: true }); } catch { /* a failed private initialization is not an active lock */ }
    }
    try { await mutex.release(); } catch { /* preserve the original lock error */ }
    if (error?.code) throw error;
    throw processError("UPDATE_LOCK_CREATE_FAILED");
  }
}

function assertUpdateLockIdentity(lock) {
  if (!lock?.mutex?.active) throw processError("UPDATE_LOCK_ARBITRATION_FAILED");
  const owner = readLockJson(path.join(lock.lockPath, "owner.json"));
  const current = readLockJson(path.join(lock.lockPath, "transaction.json"));
  if (!lockOwnerMatchesState(owner, current)
    || Number(owner.pid) !== Number(lock.ownerPid)
    || owner.nonce !== lock.nonce
    || owner.startedAtUtc !== lock.ownerStartedAtUtc) {
    throw processError("UPDATE_LOCK_OWNERSHIP_CHANGED");
  }
  return { owner, current };
}

function writeUpdateLockState(lock, updates = {}) {
  try {
    const { current } = assertUpdateLockIdentity(lock);
    const next = { ...current, ...updates, schemaVersion: UPDATE_LOCK_SCHEMA_VERSION, ownerPid: lock.ownerPid, nonce: lock.nonce, ownerStartedAtUtc: lock.ownerStartedAtUtc, updatedAtUtc: new Date().toISOString() };
    writeAtomicJson(path.join(lock.lockPath, "transaction.json"), next);
    lock.state = next;
    return next;
  } catch (error) {
    if (["UPDATE_LOCK_OWNERSHIP_CHANGED", "UPDATE_LOCK_ARBITRATION_FAILED"].includes(error?.code)) throw error;
    throw processError("UPDATE_LOCK_STATE_WRITE_FAILED", { lockClassification: "transaction_state_write_failed" });
  }
}

async function archiveFinishedUpdateLock(lock, renameDirectory = fs.renameSync) {
  assertUpdateLockIdentity(lock);
  const suffix = `${new Date().toISOString().replace(/[:.]/g, "-")}-${lock.nonce.replace(/[^a-f0-9-]/gi, "").slice(0, 36)}-${crypto.randomBytes(4).toString("hex")}`;
  const archivePath = `${lock.lockPath}.${lock.state.terminalOutcome}-${suffix}`;
  try { renameDirectory(lock.lockPath, archivePath); }
  catch { throw processError("UPDATE_LOCK_RELEASE_FAILED", { lockPath: lock.lockPath, archivePath }); }
  lock.archivedPath = archivePath;
  lock.activePathReleased = true;
}

async function finishUpdateLock(lock, terminalOutcome, updates = {}, { writeState = writeUpdateLockState, renameDirectory = fs.renameSync } = {}) {
  if (!UPDATE_LOCK_TERMINAL_OUTCOMES.has(terminalOutcome)) throw processError("UPDATE_LOCK_OWNER_UNVERIFIED");
  const current = lock?.state || {};
  if (terminalOutcome === "failed_before_install" && (current.installerStarted !== false
    || current.installerStartPending === true
    || current.workerStartPending === true
    || current.recoveryStartPending === true
    || (current.workerProcess && current.workerProcess.exitObserved !== true)
    || current.recoveryProcess)) throw processError("UPDATE_RECOVERY_REQUIRED");
  if (["completed", "rolled_back"].includes(terminalOutcome)
    && (current.installerStarted !== true || current.installerStartPending === true || current.installerProcess?.exitObserved !== true
      || current.workerStartPending === true || (current.workerProcess && current.workerProcess.exitObserved !== true)
      || current.recoveryStartPending === true || (current.recoveryProcess && current.recoveryProcess.exitObserved !== true))) throw processError("UPDATE_RECOVERY_REQUIRED");
  writeState(lock, { ...updates, phase: terminalOutcome, terminalOutcome, recoveryRequired: false });
  await archiveFinishedUpdateLock(lock, renameDirectory);
  await lock.mutex.release();
}

async function abandonUpdateLock(lock) {
  if (!lock?.mutex?.active) return;
  await lock.mutex.release();
}

function runProcess(command, args, options, timeoutMs, spawnProcess = spawn, lifecycle = {}) {
  return new Promise((resolve, reject) => {
    let timedOut = false, settled = false, childClosed = false, killFinished = false, spawnObserved = false;
    let killConfirmed = false, childCode = -1, timer, killWatchdog;
    let lifecycleFailure = null;
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
        finishError(lifecycleFailure || processError("UPDATE_PROCESS_TIMEOUT", { terminationConfirmed: true }));
      }
    };
    let child;
    try { lifecycle.beforeSpawn?.(); }
    catch (error) { reject(error?.code ? error : processError("UPDATE_LOCK_STATE_WRITE_FAILED")); return; }
    try { child = spawnProcess(command, args, { ...options, windowsHide: true }); }
    catch (error) {
      try { lifecycle.onSpawnFailure?.({ pid: null, errorCode: String(error?.code || "spawn-failed") }); }
      catch (stateError) { reject(stateError?.code ? stateError : processError("UPDATE_LOCK_STATE_WRITE_FAILED")); return; }
      reject(processError("UPDATE_INSTALLER_NOT_STARTED"));
      return;
    }
    child.once("spawn", () => {
      spawnObserved = true;
      try { lifecycle.onSpawn?.({ pid: child.pid, spawnedAtUtc: new Date().toISOString() }); }
      catch (error) { lifecycleFailure = error?.code ? error : processError("UPDATE_LOCK_STATE_WRITE_FAILED"); }
    });
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
    child.once("error", error => {
      if (!spawnObserved && !child.pid) {
        try { lifecycle.onSpawnFailure?.({ pid: null, errorCode: String(error?.code || "spawn-failed") }); }
        catch (stateError) { lifecycleFailure = stateError?.code ? stateError : processError("UPDATE_LOCK_STATE_WRITE_FAILED"); }
      } else {
        try { lifecycle.onError?.({ pid: child.pid ?? null, errorCode: String(error?.code || "process-error") }); }
        catch (stateError) { lifecycleFailure = stateError?.code ? stateError : processError("UPDATE_LOCK_STATE_WRITE_FAILED"); }
      }
      finishError(lifecycleFailure || processError(timedOut ? "UPDATE_PROCESS_TERMINATION_UNCONFIRMED" : "UPDATE_INSTALLER_NOT_STARTED"));
    });
    child.on("close", code => {
      childClosed = true;
      childCode = code ?? -1;
      try {
        if (spawnObserved) lifecycle.onClose?.({ pid: child.pid ?? null, exitCode: childCode, exitedAtUtc: new Date().toISOString() });
        else lifecycle.onSpawnFailure?.({ pid: null, errorCode: "spawn-not-observed", exitCode: childCode });
      } catch (error) { lifecycleFailure = error?.code ? error : processError("UPDATE_LOCK_STATE_WRITE_FAILED"); }
      if (!timedOut) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (lifecycleFailure) reject(lifecycleFailure);
        else resolve(childCode);
        return;
      }
      finishTimeoutIfReady();
    });
  });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function capabilities() { return { autoUpdateSupported: process.platform === "win32" && process.arch === "x64" }; }

function parseSemver(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split(".") : [] };
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue), right = parseSemver(rightValue);
  if (!left || !right) throw new Error("UPDATE_VERSION_INVALID");
  for (const key of ["major", "minor", "patch"]) if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    if (left.prerelease[i] === undefined) return -1;
    if (right.prerelease[i] === undefined) return 1;
    if (left.prerelease[i] === right.prerelease[i]) continue;
    const aNumeric = /^\d+$/.test(left.prerelease[i]), bNumeric = /^\d+$/.test(right.prerelease[i]);
    if (aNumeric && bNumeric) return Number(left.prerelease[i]) > Number(right.prerelease[i]) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return left.prerelease[i] > right.prerelease[i] ? 1 : -1;
  }
  return 0;
}

function packageMatchesReleaseTarget(targetVersion, latest, local) {
  const releaseVersion = String(latest?.latestVersion || "").trim();
  const packageVersion = String(targetVersion?.productVersion || "").trim();
  const currentVersion = String(local?.productVersion || "").trim();
  const packageBuild = Number(targetVersion?.buildNumber);
  const rawLatestBuild = latest?.latestBuildNumber;
  const latestBuild = Number(rawLatestBuild);
  if (!releaseVersion || packageVersion !== releaseVersion || !Number.isSafeInteger(packageBuild) || packageBuild <= 0) return false;
  if (Number.isSafeInteger(latestBuild) && latestBuild > 0) return packageBuild === latestBuild;
  const buildMetadataMissing = rawLatestBuild == null || rawLatestBuild === "" || Number(rawLatestBuild) === 0;
  if (!buildMetadataMissing || latest?.source !== "github-api" || latest?.updateAvailable !== true) return false;
  try { return compareSemver(releaseVersion, currentVersion) > 0; }
  catch { return false; }
}
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

function diagnosticText(value, limit = 600) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(-limit);
}

function readInstallerDiagnosticTail(filePath, maxLines = 20) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-maxLines)
      .map(line => diagnosticText(line, 500));
  } catch { return []; }
}

function installerFailureDiagnostics(failure, installerLogPath) {
  const report = failure?.report || null;
  const error = diagnosticText(report?.error || "", 600);
  const contextRejected = /^REGISTRATION_VERIFICATION_INVALID\b/.test(error);
  const reasons = Array.isArray(report?.executionContext?.reasons)
    ? report.executionContext.reasons.map(value => String(value)).filter(value => /^[a-z0-9-]{1,80}$/i.test(value)).slice(0, 16)
    : [];
  return {
    failureCategory: contextRejected ? "registration_context_rejected" : "installer_failed",
    failureSummary: error,
    contextReasons: reasons,
    failureReportPath: failure?.file || null,
    installerLogPath: installerLogPath || null,
    installerLogTail: readInstallerDiagnosticTail(installerLogPath),
  };
}

function emitInstallerVerificationProgress(exitCode, progress) {
  if (Number(exitCode) !== 0) return false;
  progress(96, "verifying_install", "正在核对本次安装结果…");
  return true;
}

async function recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath, nonce, nativeExeSha256, extensionVersionSha256, lock, processLifecycle = {} }) {
  if (!journalPath || !fs.existsSync(journalPath)) {
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryDetail: "transaction journal is missing; file fingerprints cannot prove registry rollback" });
  }
  if (!lock || !Number.isSafeInteger(Number(lock.ownerPid)) || Number(lock.ownerPid) <= 0
    || !lock.ownerStartedAtUtc || !lock.lockPath) {
    throw processError("UPDATE_PROCESS_RECOVERY_FAILED", { recoveryDetail: "update lock owner identity is missing" });
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
      env: {
        ...ordinaryInstallerEnv(),
        ...spec.env,
        TB_UPDATE_NONCE: nonce,
        TB_UPDATE_INSTALL_ROOT: installRoot,
        TB_UPDATE_EXTENSION_PATH: extensionRoot,
        TB_UPDATE_JOURNAL_PATH: journalPath,
        TB_UPDATE_OWNER_PID: String(lock.ownerPid),
        TB_UPDATE_OWNER_STARTED_AT_UTC: lock.ownerStartedAtUtc,
        TB_UPDATE_LOCK_PATH: lock.lockPath,
        TB_UPDATE_LOCK_STATE_PATH: path.join(lock.lockPath, "transaction.json"),
      },
      stdio: ["ignore", logFd, logFd],
    }, 2 * 60 * 1000, spawn, processLifecycle);
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
  let stage, extracted, extractionLogPath, lock, heartbeat, logFd, originalCwd, installRoot, extensionRoot, packageRoot;
  let transactionJournalPath, installerLogPath, provenance, previousNativeExeSha256, previousExtensionVersionSha256;
  let installerProcessIdentity = null, recoveryProcessIdentity = null;
  let phase = "preflight", percent = 1, installerStarted = false, ownsBusy = false;
  let bytesReceived = 0, recoveredStaleLock = false;
  const nonce = crypto.randomUUID();
  const writeUpdateState = (extra = {}) => {
    if (!stage) return;
    try {
      const statePath = childPath(stage, "update-state.json");
      const temporary = `${statePath}.tmp-${process.pid}`;
      const payload = {
        schemaVersion: 1,
        pid: process.pid,
        nonce,
        phase,
        percent: Math.max(0, Math.min(100, Number(percent) || 0)),
        bytesReceived: Math.max(0, Number(bytesReceived) || 0),
        installerStarted,
        updatedAtUtc: new Date().toISOString(),
        ...extra,
      };
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n");
      fs.renameSync(temporary, statePath);
    } catch { /* durable progress is best-effort and never blocks an update */ }
  };
  const progress = (p, nextPhase, text) => {
    percent = p; phase = nextPhase;
    writeUpdateState({ message: text });
    emit({ ok: true, event: "progress", action: "download_and_install_update", phase, percent, message: text });
  };
  const lockProcessLifecycle = role => {
    const field = role === "installer" ? "installerProcess" : role === "recovery" ? "recoveryProcess" : "workerProcess";
    const pendingField = role === "installer" ? "installerStartPending" : role === "recovery" ? "recoveryStartPending" : "workerStartPending";
    const phases = role === "installer"
      ? { pending: "installer_start_pending", running: "installer_running", exited: "installer_exit_observed" }
      : role === "recovery"
        ? { pending: "recovery_start_pending", running: "recovery_running", exited: "recovery_exit_observed" }
        : { pending: "extracting", running: "extracting", exited: "extracting" };
    const persist = updates => writeUpdateLockState(lock, updates);
    const identity = (event, previous = {}) => ({
      ...previous,
      ...event,
      role,
      identityBasis: "node-child-process-event",
      exitObserved: event.exitCode !== undefined || event.spawnFailed === true,
    });
    return {
      beforeSpawn() {
        persist({
          phase: phases.pending,
          [pendingField]: true,
          [field]: null,
          ...(role === "installer" ? { installerStarted: false, recoveryRequired: true, installerJournalPath: transactionJournalPath } : {}),
          ...(role === "recovery" ? { recoveryRequired: true } : {}),
          ...(role === "extraction" ? { recoveryRequired: false } : {}),
        });
      },
      onSpawn(event) {
        const processIdentity = identity(event);
        if (role === "installer") installerStarted = true;
        if (role === "installer") installerProcessIdentity = processIdentity;
        if (role === "recovery") recoveryProcessIdentity = processIdentity;
        persist({
          phase: phases.running,
          [pendingField]: false,
          [field]: processIdentity,
          ...(role === "installer" ? { installerStarted: true, recoveryRequired: true } : {}),
          ...(role === "recovery" ? { recoveryRequired: true } : {}),
        });
      },
      onClose(event) {
        const processIdentity = identity(event, lock.state?.[field] || {});
        if (role === "installer") installerProcessIdentity = processIdentity;
        if (role === "recovery") recoveryProcessIdentity = processIdentity;
        persist({
          phase: phases.exited,
          [pendingField]: false,
          [field]: processIdentity,
          ...(role === "installer" ? { installerStarted: true, recoveryRequired: true } : {}),
          ...(role === "recovery" ? { recoveryRequired: true } : {}),
        });
      },
      onSpawnFailure(event) {
        const processIdentity = identity({ ...event, spawnFailed: true, exitCode: event.exitCode ?? null }, lock.state?.[field] || {});
        if (role === "installer") installerProcessIdentity = processIdentity;
        if (role === "recovery") recoveryProcessIdentity = processIdentity;
        persist({
          phase: role === "installer" ? "package_verified" : phases.exited,
          [pendingField]: false,
          [field]: processIdentity,
          ...(role === "installer" ? { installerStarted: false, recoveryRequired: false } : {}),
          ...(role === "recovery" ? { recoveryRequired: true } : {}),
          ...(role === "extraction" ? { recoveryRequired: false } : {}),
        });
      },
    };
  };
  const recoveryLifecycle = role => lockProcessLifecycle(role);
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
    const lockPath = path.join(parent, ".AppraisalToolbox-update.lock");
    const lockResult = await acquireUpdateLock(lockPath, nonce);
    lock = lockResult;
    recoveredStaleLock = lockResult.recovered;
    if (recoveredStaleLock) progress(1, "preflight", "已确认上次更新进程已结束，保留旧现场后继续重试…");
    fs.mkdirSync(stagingRoot, { recursive: true });
    if (fs.lstatSync(stagingRoot).isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
    stage = fs.mkdtempSync(path.join(stagingRoot, "run-"));
    writeUpdateState({ message: "更新事务已开始。", recoveredStaleLock });
    writeUpdateLockState(lock, { phase: "downloading", stagePath: stage, bytesReceived: 0, installerStarted: false, recoveryRequired: false });
    const zip = childPath(stage, "package.zip");
    extracted = childPath(stage, "extracted");
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
          bytesReceived = bytes;
          if (bytes > size) controller.abort(new Error("UPDATE_DOWNLOAD_SIZE_MISMATCH"));
          if (Date.now() - last > 1000) { last = Date.now(); progress(Math.min(60, 2 + bytes / size * 58), "downloading", "正在下载安装包…"); }
        });
        await pipeline(response, fs.createWriteStream(zip, { flags: "wx" }), { signal: controller.signal });
        bytesReceived = fs.statSync(zip).size;
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
    writeUpdateLockState(lock, { phase: "verifying", bytesReceived, downloadSha256: sha, expectedDownloadSize: size, installerStarted: false, installerStartPending: false, recoveryRequired: false });
    progress(70, "extracting", "正在解压更新包…");
    extracted = createShortExtractionRoot();
    extractionLogPath = childPath(stage, "extract-log.txt");
    const spec = commandLaunchSpec("powershell.exe", []);
    const extractionCode = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "$zip=$null",
      "try {",
      "  $ZipPath=[IO.Path]::GetFullPath($env:TB_ZIP)",
      "  $Destination=[IO.Path]::GetFullPath($env:TB_DEST)",
      "  $root=$Destination.TrimEnd([char]92)+[char]92",
      "  $zip=[IO.Compression.ZipFile]::OpenRead($ZipPath)",
      "  foreach($entry in $zip.Entries) {",
      "    $name=[string]$entry.FullName",
      "    if([string]::IsNullOrWhiteSpace($name)) { continue }",
      "    $normalized=$name.Replace('/',[char]92)",
      "    if([IO.Path]::IsPathRooted($normalized) -or ($normalized.Split([char]92) -contains '..')) { throw [System.Exception]::new('UPDATE_ZIP_PATH_TRAVERSAL|' + $name) }",
      "    $candidate=[IO.Path]::Combine($Destination,$normalized)",
      "    if($candidate.Length -gt 250) { throw [System.Exception]::new('UPDATE_PATH_TOO_LONG|entry=' + $name + '|targetLength=' + $candidate.Length) }",
      "    $target=[IO.Path]::GetFullPath($candidate)",
      "    if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw [System.Exception]::new('UPDATE_ZIP_PATH_TRAVERSAL|' + $name) }",
      "  }",
      "  $zip.Dispose(); $zip=$null",
      "  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force",
      "} catch {",
      "  if($zip) { $zip.Dispose() }",
      "  $raw=[string]$_.Exception.Message",
      "  $parts=$raw.Split('|',2)",
      "  $code=if($parts[0] -in @('UPDATE_PATH_TOO_LONG','UPDATE_ZIP_PATH_TRAVERSAL')) { $parts[0] } else { 'UPDATE_EXTRACT_FAILED' }",
      "  $payload=[ordered]@{code=$code; detail=$raw.Substring(0,[Math]::Min(600,$raw.Length)); stage='extracting'}",
      "  [Console]::Error.WriteLine('APPRAISAL_UPDATE_ERROR:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress))))",
      "  exit 1",
      "}",
    ].join("\n");
    const common = { cwd: stage, env: { ...process.env, ...spec.env, TB_ZIP: zip, TB_DEST: extracted } };
    let extractFd, extractionExit = -1, extractionError;
    try {
      extractFd = fs.openSync(extractionLogPath, "wx");
      extractionExit = await runProcess(spec.command, [...spec.args, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", extractionCode], { ...common, stdio: ["ignore", extractFd, extractFd] }, 10 * 60 * 1000, spawn, lockProcessLifecycle("extraction"));
    } catch (error) { extractionError = error; }
    finally { if (extractFd !== undefined) fs.closeSync(extractFd); }
    const extractionMarker = readExtractionMarker(extractionLogPath);
    if (extractionError || extractionExit !== 0 || extractionMarker) {
      const code = extractionMarker?.code || extractionError?.code || "UPDATE_EXTRACT_FAILED";
      const error = processError(code, { diagnostics: {
        stage: "extracting",
        detail: redactExtractionText(extractionMarker?.detail || extractionError?.message || "PowerShell 解压未成功", [stage, extracted, zip, process.env.USERPROFILE, process.env.LOCALAPPDATA]),
        extractLogPath: extractionLogPath,
        stderrTail: redactExtractionText(tailFile(extractionLogPath), [stage, extracted, zip, process.env.USERPROFILE, process.env.LOCALAPPDATA]),
      } });
      throw error;
    }
    packageRoot = extracted;
    if (!fs.existsSync(path.join(packageRoot, "install.cmd"))) {
      const roots = fs.readdirSync(extracted).filter(n => fs.existsSync(path.join(extracted, n, "install.cmd")));
      if (roots.length !== 1) throw new Error("UPDATE_INSTALLER_NOT_FOUND");
      packageRoot = path.join(extracted, roots[0]);
    }
    provenance = readJson(path.join(packageRoot, "BUILD-PROVENANCE.json"));
    const targetVersion = readJson(path.join(packageRoot, "extension", "version.json"));
    if (!packageMatchesReleaseTarget(targetVersion, latest, local)) throw new Error("UPDATE_TARGET_CHANGED");
    if (!/^[a-f0-9]{64}$/.test(provenance.nativeExeSha256 || "") || await digest(path.join(packageRoot, "native-helper", "native_host.exe")) !== provenance.nativeExeSha256) throw new Error("UPDATE_PACKAGE_FILE_MISSING");
    writeUpdateLockState(lock, {
      phase: "package_verified",
      workerStartPending: false,
      installerStarted: false,
      installerStartPending: false,
      installerProcess: null,
      installerJournalPath: transactionJournalPath,
      packageRoot,
      recoveryRequired: false,
    });
    progress(80, "installing", "正在安装组件并更新原插件目录…");
    logFd = fs.openSync(installerLogPath, "wx");
    // Chrome may start a native host with cwd=native-helper. Release this directory handle too.
    originalCwd = process.cwd();
    process.chdir(stage);
    // install.cmd retains the normal user's token/ancestry. Its context gate is mandatory.
    const exit = await runProcess("cmd.exe", ["/d", "/s", "/c", "install.cmd"], { cwd: packageRoot, stdio: ["ignore", logFd, logFd], env: {
      ...ordinaryInstallerEnv(),
      TB_UPDATE_NONCE: nonce,
      TB_UPDATE_INSTALL_ROOT: installRoot,
      TB_UPDATE_EXTENSION_PATH: extensionRoot,
      TB_UPDATE_JOURNAL_PATH: transactionJournalPath,
      TB_UPDATE_OWNER_PID: String(lock.ownerPid),
      TB_UPDATE_OWNER_STARTED_AT_UTC: lock.ownerStartedAtUtc,
      TB_UPDATE_LOCK_PATH: lock.lockPath,
      TB_UPDATE_LOCK_STATE_PATH: path.join(lock.lockPath, "transaction.json"),
    } }, 15 * 60 * 1000, spawn, lockProcessLifecycle("installer"));
    fs.closeSync(logFd); logFd = undefined;
    emitInstallerVerificationProgress(exit, progress);
    if (exit !== 0) {
      const failure = findInstallerFailureReport({ installRoot, nonce });
      const failureDiagnostics = installerFailureDiagnostics(failure, installerLogPath);
      if (failure?.report.rollbackVerified === true
        && await previousInstallationVerified({ installRoot, extensionRoot, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256 })) {
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: true, stage: "installer", ...failureDiagnostics } };
      } else {
        try {
          const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256, lock, processLifecycle: recoveryLifecycle("recovery") });
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: true, recoveredAfterInstallerFailure: true, stage: "installer", ...failureDiagnostics, recoveryLog: recovery.recoveryLog || null } };
        } catch (recoveryError) {
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_INSTALLER_ROLLBACK_FAILED", currentVersionUnchanged: null, diagnostics: { installerStarted, installerExitCode: exit, rollbackVerified: false, stage: "installer", ...failureDiagnostics, recoveryLog: recoveryError.recoveryLog || null, detail: diagnosticText(recoveryError.recoveryDetail || recoveryError.code || recoveryError.message || "rollback could not be verified") } };
        }
      }
    }
    if (exit !== 0) {
      // A verified failure/rollback is a finished transaction; do not continue
      // into success verification or overwrite its result.
    } else if (!await candidateInstallationVerified({ installRoot, extensionRoot, nonce, provenance, packageRoot })) {
      progress(98, "rollback", "安装结果缺少有效核验记录，正在恢复并核对旧版本…");
      try {
        const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256, lock, processLifecycle: recoveryLifecycle("recovery") });
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
          const recovery = await recoverTimedOutInstaller({ packageRoot, installRoot, extensionRoot, journalPath: transactionJournalPath, nonce, nativeExeSha256: previousNativeExeSha256, extensionVersionSha256: previousExtensionVersionSha256, lock, processLifecycle: recoveryLifecycle("recovery") });
          result = { ok: false, phase: "failed", percent, reason: "UPDATE_PROCESS_TIMEOUT_ROLLED_BACK", currentVersionUnchanged: true, diagnostics: { installerStarted, rollbackVerified: true, recoveryStatus: recovery.status || "recovered", installerLogPath, recoveryLog: recovery.recoveryLog || null } };
        }
      } catch (recoveryError) {
        result = { ok: false, phase: "failed", percent, reason: "UPDATE_PROCESS_RECOVERY_FAILED", currentVersionUnchanged: null, diagnostics: { installerStarted, rollbackVerified: false, installerLogPath, recoveryLog: recoveryError.recoveryLog || null, detail: String(recoveryError.recoveryDetail || recoveryError.code || recoveryError.message || "recovery failed").replace(/https?:\/\/\S+/g, "[url]").slice(-600) } };
      }
    } else {
      const reason = /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(raw) ? raw : "UPDATE_FAILED";
      result = { ok: false, phase: "failed", percent, reason, diagnostics: { installerStarted, stage: error?.diagnostics?.stage || phase, stagePath: stage || null, installerLogPath: installerLogPath || null, ...error?.diagnostics, detail: error?.diagnostics?.detail || diagnosticText(raw) } };
    }
  } finally {
    clearInterval(heartbeat);
    if (originalCwd) { try { process.chdir(originalCwd); } catch { /* retain external cwd if rollback incomplete */ } }
    if (ownsBusy) updating = false;
    if (logFd !== undefined) fs.closeSync(logFd);
    if (lock) {
      const state = lock.state || {};
      const safeWorkerExit = state.workerStartPending !== true && (!state.workerProcess || state.workerProcess.exitObserved === true);
      const safePreInstall = state.installerStarted === false
        && state.installerStartPending !== true
        && state.recoveryRequired !== true
        && state.recoveryStartPending !== true
        && !state.recoveryProcess
        && safeWorkerExit;
      const terminalOutcome = result?.ok === true
        ? "completed"
        : result?.currentVersionUnchanged === true && ["UPDATE_INSTALLER_ROLLED_BACK", "UPDATE_PROCESS_TIMEOUT_ROLLED_BACK"].includes(result?.reason)
          ? "rolled_back"
          : safePreInstall ? "failed_before_install" : null;
      try {
        if (terminalOutcome) await finishUpdateLock(lock, terminalOutcome);
        else await abandonUpdateLock(lock);
      } catch (lockError) {
        const reason = ["UPDATE_LOCK_RELEASE_FAILED", "UPDATE_LOCK_STATE_WRITE_FAILED", "UPDATE_LOCK_OWNERSHIP_CHANGED", "UPDATE_LOCK_ARBITRATION_FAILED", "UPDATE_RECOVERY_REQUIRED"].includes(lockError?.code)
          ? lockError.code
          : "UPDATE_LOCK_RELEASE_FAILED";
        if (lock.mutex?.active) {
          try { await abandonUpdateLock(lock); }
          catch { /* the arbiter process exits with this host and the journal remains fail-closed */ }
        }
        result = {
          ok: false,
          phase: "failed",
          percent: result?.percent ?? percent,
          reason,
          currentVersionUnchanged: result?.currentVersionUnchanged ?? null,
          diagnostics: { ...(result?.diagnostics || {}), lockPath: lock.lockPath, archivedLockPath: lock.archivedPath || null, lockClassification: lockError?.lockClassification || null },
        };
      }
    }
    writeUpdateState({
      phase: result?.phase || "failed",
      percent: result?.percent ?? percent,
      reason: result?.reason || "",
      currentVersionUnchanged: result?.currentVersionUnchanged ?? null,
      recoveredStaleLock,
    });
  }
  const final = { ...result, event: "complete", action: "download_and_install_update", security: { credentialsReturned: false } };
  emit(final); return final;
}

module.exports = { abandonUpdateLock, acquireGlobalUpdateMutex, acquireUpdateLock, assetUrl, capabilities, classifyUpdateLockOwner, compareSemver, createShortExtractionRoot, downloadAndInstallUpdate, emitInstallerVerificationProgress, finishUpdateLock, findInstallerFailureReport, installerFailureDiagnostics, isUpdating: () => updating, packageMatchesReleaseTarget, readInstallerDiagnosticTail, readWindowsProcessStartTime, recoverTimedOutInstaller, runProcess, updateLockMutexName, writeUpdateLockState };
