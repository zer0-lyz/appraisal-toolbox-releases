"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ACTIVE_STATES = new Set(["starting", "busy", "installing", "recovering"]);
const FINALIZATION_GRACE_MS = 30000;
const TERMINAL_STATES = new Set(["complete", "rolled_back", "failed_safe"]);
const JOURNAL_STATES = new Set([...ACTIVE_STATES, ...TERMINAL_STATES, "unknown"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FRAMEWORK_ROOT = "/Library/Frameworks/Python.framework/Versions/3.14";
const PROBE_LOCK_PROGRAM = [
  "import fcntl, os, stat, sys",
  "p = sys.argv[1]",
  "flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)",
  "try: fd = os.open(p, flags)",
  "except FileNotFoundError: print('MISSING', flush=True); sys.exit(4)",
  "st = os.fstat(fd)",
  "if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1: sys.exit(4)",
  "try: fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)",
  "except BlockingIOError: print('BUSY', flush=True); sys.exit(3)",
  "print('FREE', flush=True)",
].join("\n");
const LOCK_PROGRAM = [
  "import fcntl, os, stat, sys",
  "p = sys.argv[1]",
  "flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)",
  "fd = os.open(p, flags, 0o600)",
  "st = os.fstat(fd)",
  "if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1: sys.exit(4)",
  "os.fchmod(fd, 0o600)",
  "try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)",
  "except BlockingIOError: print('BUSY', flush=True); sys.exit(3)",
  "print('LOCKED', flush=True)",
  "sys.stdin.readline()",
  "os.close(fd)",
].join("\n");

function resolveLockPython(installRoot, pythonBootstrap, runFileSync, frameworkRoot = FRAMEWORK_ROOT) {
  try {
    const root = fs.realpathSync(path.resolve(installRoot));
    const expected = path.join(root, "python", "bin", "python3");
    const supplied = path.resolve(pythonBootstrap || expected);
    const canonicalSupplied = path.join(fs.realpathSync(path.dirname(supplied)), path.basename(supplied));
    if (canonicalSupplied !== expected || typeof runFileSync !== "function") {
      throw new Error("bootstrap");
    }
    const resolved = fs.realpathSync(expected);
    let frameworkCandidate = path.resolve(frameworkRoot || FRAMEWORK_ROOT);
    const nestedFramework = path.join(frameworkCandidate, "Python.framework", "Versions", "3.14");
    if (frameworkRoot && fs.existsSync(nestedFramework)) frameworkCandidate = nestedFramework;
    const canonicalFrameworkRoot = fs.realpathSync(frameworkCandidate);
    const relative = path.relative(canonicalFrameworkRoot, resolved);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || (stat.mode & 0o111) === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("framework");
    }
    const version = String(runFileSync(resolved, ["--version"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    }) || "").trim();
    if (version !== "Python 3.14.6") throw new Error("version");
    runFileSync(resolved, ["-c", "import fcntl,sys; assert sys.version_info[:3] == (3,14,6)"], {
      stdio: ["ignore", "ignore", "ignore"], timeout: 5000,
    });
    return resolved;
  } catch {
    throw new Error("UPDATE_LOCK_RUNTIME_UNAVAILABLE");
  }
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
    throw new Error("UPDATE_STAGING_PATH_INVALID");
  }
  fs.chmodSync(directory, 0o700);
  const canonical = fs.realpathSync(directory);
  return canonical;
}

function fsyncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  let fd;
  try {
    fd = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncDirectory(directory);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* preserve the write failure */ }
    throw error;
  }
}

function parseJournal(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function acquirePosixFileLock(lockPath, pythonBin, spawnProcess = spawn, timeoutMs = 10000, releaseTimeoutMs = 3000, lockEnvironment = {}) {
  return new Promise((resolve, reject) => {
    if (!pythonBin) { reject(new Error("UPDATE_LOCK_RUNTIME_UNAVAILABLE")); return; }
    let child;
    try {
      child = spawnProcess(pythonBin, ["-c", LOCK_PROGRAM, lockPath], {
        stdio: ["pipe", "pipe", "ignore"],
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: os.homedir(), ...lockEnvironment },
      });
    } catch {
      reject(new Error("UPDATE_LOCK_ARBITRATION_FAILED"));
      return;
    }
    let buffered = "";
    let settled = false;
    let exited = false;
    let exitCode = null;
    let exitSignal = null;
    let releasePromise = null;
    const finish = (error, lock) => {
      if (settled) return;
      settled = true;
      clearTimeout(arbitrationTimer);
      if (error) {
        try { child.kill("SIGKILL"); } catch { /* process may already have exited */ }
        reject(error);
      } else resolve(lock);
    };
    const arbitrationTimer = setTimeout(() => finish(new Error("UPDATE_LOCK_ARBITRATION_FAILED")), timeoutMs);
    child.once("error", () => finish(new Error("UPDATE_LOCK_ARBITRATION_FAILED")));
    child.once("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      if (!settled) finish(new Error(code === 3 ? "UPDATE_ALREADY_RUNNING" : "UPDATE_LOCK_ARBITRATION_FAILED"));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      const lineEnd = buffered.indexOf("\n");
      if (lineEnd < 0) return;
      const line = buffered.slice(0, lineEnd).trim();
      if (line === "BUSY") finish(new Error("UPDATE_ALREADY_RUNNING"));
      else if (line !== "LOCKED" || exited) finish(new Error("UPDATE_LOCK_ARBITRATION_FAILED"));
      else finish(null, {
        pid: child.pid,
        assertHeld() {
          if (exited) throw new Error("UPDATE_LOCK_LOST");
          return true;
        },
        release() {
          if (releasePromise) return releasePromise;
          releasePromise = new Promise((releaseResolve) => {
            if (exited) { releaseResolve(false); return; }
            let done = false;
            const settle = (ok) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              child.removeListener("exit", onExit);
              child.stdin.removeListener("error", onStdinError);
              releaseResolve(ok);
            };
            const onExit = (code, signal) => settle(code === 0 && !signal);
            const onStdinError = () => settle(false);
            const timer = setTimeout(() => {
              try { child.kill("SIGKILL"); } catch { /* already gone */ }
              settle(false);
            }, releaseTimeoutMs);
            child.once("exit", onExit);
            child.stdin.once("error", onStdinError);
            if (exited) settle(exitCode === 0 && !exitSignal);
            else {
              try { child.stdin.end("release\n"); }
              catch { settle(false); }
            }
          });
          return releasePromise;
        },
      });
    });
  });
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function probePosixFileLock(lockPath, pythonBin, spawnProcess = spawn, timeoutMs = 3000, lockEnvironment = {}) {
  return new Promise((resolve) => {
    if (!pythonBin || !fs.existsSync(lockPath)) { resolve("unknown"); return; }
    let child;
    try {
      child = spawnProcess(pythonBin, ["-c", PROBE_LOCK_PROGRAM, lockPath], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: os.homedir(), ...lockEnvironment },
      });
    } catch { resolve("unknown"); return; }
    let output = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* child may have exited */ }
      finish("unknown");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", () => finish("unknown"));
    child.once("close", (code) => {
      if (code === 0 && output.trim() === "FREE") finish("free");
      else if (code === 3 && output.trim() === "BUSY") finish("busy");
      else finish("unknown");
    });
  });
}

function canonicalInstallRoot(value) {
  const resolved = path.resolve(String(value || ""));
  const parent = fs.realpathSync(path.dirname(resolved));
  const identity = path.join(parent, path.basename(resolved));
  try {
    const stat = fs.lstatSync(identity);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("UPDATE_STAGING_PATH_INVALID");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return identity;
}

function unresolvedInstallerReason(updatesRoot, installRoot) {
  const directory = path.resolve(updatesRoot);
  if (!fs.existsSync(directory)) return "";
  let helper;
  try { helper = require("./macos_installer_transaction.js"); }
  catch { return "UPDATE_INSTALLER_JOURNAL_UNAVAILABLE"; }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const journalPath = path.join(directory, entry.name, "installer-transaction.json");
    if (!fs.existsSync(journalPath)) continue;
    try {
      const stat = fs.lstatSync(journalPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
        return "UPDATE_INSTALLER_JOURNAL_INVALID";
      }
      const journal = helper.readInstallerJournal(journalPath);
      if (journal.canonicalRoot !== installRoot) continue;
      if (!TERMINAL_STATES.has(journal.stage) || journal.verified !== true) return "UPDATE_INSTALLER_RECOVERY_REQUIRED";
    } catch {
      return "UPDATE_INSTALLER_JOURNAL_INVALID";
    }
  }
  return "";
}

function pendingRequest(updatesRoot, installRoot, ignoreNonce = "") {
  const directory = path.join(updatesRoot, "requests");
  if (!fs.existsSync(directory)) return null;
  try {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || directoryStat.uid !== process.getuid() || (directoryStat.mode & 0o077) !== 0) {
      return { reason: "UPDATE_REQUEST_STATE_INVALID" };
    }
  } catch { return { reason: "UPDATE_REQUEST_STATE_INVALID" }; }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.endsWith(".ack.json")) continue;
    const requestPath = path.join(directory, entry.name);
    try {
      const stat = fs.lstatSync(requestPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
        return { reason: "UPDATE_REQUEST_STATE_INVALID" };
      }
      if (!entry.name.endsWith(".request.json")) return { reason: "UPDATE_REQUEST_STATE_INVALID" };
      const requestNonce = entry.name.slice(0, -".request.json".length);
      if (!UUID_PATTERN.test(requestNonce)) return { reason: "UPDATE_REQUEST_STATE_INVALID" };
      if (requestNonce === ignoreNonce) continue;
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
      if (request?.schemaVersion !== 1 || request.nonce !== requestNonce) return { reason: "UPDATE_REQUEST_STATE_INVALID" };
      if (path.resolve(String(request.installRoot || "")) === installRoot) {
        return { reason: "UPDATE_WORKER_START_UNCONFIRMED", transactionId: requestNonce };
      }
    } catch {
      return { reason: "UPDATE_REQUEST_STATE_INVALID" };
    }
  }
  return null;
}

const ALLOWED_TRANSITIONS = {
  starting: new Set(["starting", "busy", "installing", "recovering", ...TERMINAL_STATES, "unknown"]),
  busy: new Set(["busy", "installing", "recovering", ...TERMINAL_STATES, "unknown"]),
  installing: new Set(["installing", "recovering", ...TERMINAL_STATES, "unknown"]),
  recovering: new Set(["recovering", ...TERMINAL_STATES, "unknown"]),
  complete: new Set(["complete", "unknown"]),
  rolled_back: new Set(["rolled_back", "unknown"]),
  failed_safe: new Set(["failed_safe", "unknown"]),
  unknown: new Set(["unknown", "recovering"]),
};

class MacUpdateTransactionStore {
  constructor({
    homeDir = os.homedir(),
    installRoot = path.join(homeDir, ".appraisal-toolbox"),
    updatesRoot = path.join(homeDir, ".appraisal-toolbox-updates"),
    pythonBin,
    spawnProcess = spawn,
    writeState = atomicWriteJson,
    lockTimeoutMs = 10000,
    releaseTimeoutMs = 3000,
    lockEnvironment = {},
    finalizationGraceMs = FINALIZATION_GRACE_MS,
    isProcessAlive = processIsAlive,
  } = {}) {
    this.homeDir = fs.realpathSync(path.resolve(homeDir));
    this.installRoot = canonicalInstallRoot(installRoot);
    this.updatesRoot = ensurePrivateDirectory(path.resolve(updatesRoot));
    this.journalPath = path.join(this.updatesRoot, "transaction.json");
    this.lockPath = path.join(this.updatesRoot, "transaction.lock");
    this.legacyLockPath = path.join(this.homeDir, ".appraisal-toolbox-update.lock");
    this.pythonBin = pythonBin ? path.resolve(pythonBin) : "";
    this.spawnProcess = spawnProcess;
    this.writeStateFile = writeState;
    this.lockTimeoutMs = lockTimeoutMs;
    this.releaseTimeoutMs = releaseTimeoutMs;
    this.finalizationGraceMs = Number.isFinite(finalizationGraceMs) && finalizationGraceMs > 0 ? finalizationGraceMs : 0;
    this.isProcessAlive = typeof isProcessAlive === "function" ? isProcessAlive : () => false;
    this.lockEnvironment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: this.homeDir, ...lockEnvironment };
  }

  async acquire() {
    if (!this.pythonBin) throw new Error("UPDATE_LOCK_RUNTIME_UNAVAILABLE");
    return acquirePosixFileLock(
      this.lockPath, this.pythonBin, this.spawnProcess, this.lockTimeoutMs, this.releaseTimeoutMs, this.lockEnvironment,
    );
  }

  readJournal() {
    if (!fs.existsSync(this.journalPath)) return null;
    const value = parseJournal(this.journalPath);
    if (!value
      || value.schemaVersion !== 2
      || !UUID_PATTERN.test(String(value.nonce || ""))
      || value.canonicalInstallRoot !== this.installRoot
      || !JOURNAL_STATES.has(value.state)) {
      return { invalid: true };
    }
    return value;
  }

  write(nonce, patch, { create = false } = {}) {
    if (!UUID_PATTERN.test(String(nonce || "")) || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("UPDATE_LOCK_STATE_INVALID");
    }
    const current = this.readJournal();
    if (current?.invalid) throw new Error("UPDATE_LOCK_STATE_INVALID");
    if (create) {
      if (current && (!TERMINAL_STATES.has(current.state) || current.verified !== true)) throw new Error("UPDATE_LOCK_OWNERSHIP_CHANGED");
    } else if (!current || current.nonce !== nonce) {
      throw new Error(current ? "UPDATE_LOCK_OWNERSHIP_CHANGED" : "UPDATE_LOCK_STATE_INVALID");
    }
    const state = create ? "starting" : String(patch.state || current.state);
    const previousState = current?.state;
    if (!JOURNAL_STATES.has(state)
      || (!create && !ALLOWED_TRANSITIONS[previousState]?.has(state))
      || (!create && TERMINAL_STATES.has(previousState) && current.verified === true
        && (state !== previousState || patch.verified === false))) {
      throw new Error("UPDATE_LOCK_STATE_INVALID");
    }
    const now = new Date().toISOString();
    const prior = current && !create ? current : {};
    const { schemaVersion, nonce: oldNonce, canonicalInstallRoot: oldRoot, updatedAt: oldTime, workerPid: oldPid, ...existing } = prior;
    const { state: ignoredState, ...patchData } = patch;
    const value = {
      ...existing,
      ...patchData,
      schemaVersion: 2,
      nonce,
      canonicalInstallRoot: this.installRoot,
      state,
      phase: create ? (patch.phase || "preflight") : (patch.phase || current.phase),
      startedAt: create ? now : current.startedAt,
      updatedAt: now,
      workerPid: process.pid,
    };
    this.writeStateFile(this.journalPath, value);
    return value;
  }

  isFinalizationPending(journal) {
    if (!journal || !TERMINAL_STATES.has(journal.state) || journal.phase !== "finalizing" || journal.verified === true) return false;
    const pid = journal.workerPid;
    const updatedAt = Date.parse(journal.updatedAt);
    const age = Date.now() - updatedAt;
    if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isFinite(updatedAt) || age < 0 || age > this.finalizationGraceMs) return false;
    try { return this.isProcessAlive(pid) === true; } catch { return false; }
  }

  async getStatus({ probeLock = true, ignoreRequestNonce = "" } = {}) {
    if (fs.existsSync(this.legacyLockPath)) {
      return { ok: false, state: "unknown", phase: "recovery", reason: "UPDATE_LOCK_OWNER_UNVERIFIED", recoveryBlocked: true, verified: false };
    }
    const journal = this.readJournal();
    const installerReason = unresolvedInstallerReason(this.updatesRoot, this.installRoot);
    if (!journal) {
      if (installerReason) return { ok: false, state: "unknown", phase: "recovery", reason: installerReason, recoveryBlocked: true, verified: false };
      const pending = pendingRequest(this.updatesRoot, this.installRoot, ignoreRequestNonce);
      if (pending) return { ok: false, state: "unknown", phase: "recovery", ...pending, recoveryBlocked: true, verified: false };
      return { ok: true, state: "idle", phase: "idle", recoveryBlocked: false, verified: false };
    }
    if (journal.invalid) {
      return { ok: false, state: "unknown", phase: "recovery", reason: "UPDATE_LOCK_STATE_INVALID", recoveryBlocked: true, verified: false };
    }
    if (this.isFinalizationPending(journal)) {
      if (installerReason) return this.unknown(journal, installerReason);
      if (probeLock) {
        const lockState = await probePosixFileLock(this.lockPath, this.pythonBin, this.spawnProcess, 3000, this.lockEnvironment);
        if (lockState === "unknown") return this.unknown(journal, this.pythonBin ? "UPDATE_LOCK_ARBITRATION_FAILED" : "UPDATE_LOCK_RUNTIME_UNAVAILABLE");
      }
      return {
        ...journal, ok: true, state: "busy", phase: "finalizing", transactionId: journal.nonce,
        recoveryBlocked: false, verified: false,
      };
    }
    if (TERMINAL_STATES.has(journal.state) && journal.phase === "finalizing" && journal.verified !== true) {
      return this.unknown(journal, "UPDATE_FINALIZATION_ABANDONED");
    }
    if (ACTIVE_STATES.has(journal.state)) {
      if (!probeLock) return {
        ok: true, state: "busy", phase: journal.phase, percent: journal.percent || 0,
        message: journal.message || "正在处理更新事务…", transactionId: journal.nonce,
        recoveryBlocked: false, verified: false,
      };
      const lockState = await probePosixFileLock(this.lockPath, this.pythonBin, this.spawnProcess, 3000, this.lockEnvironment);
      if (lockState === "busy") {
        return { ...journal, ok: true, state: "busy", transactionId: journal.nonce, recoveryBlocked: false, verified: false };
      }
      if (lockState === "free") return this.unknown(journal, "UPDATE_LOCK_ARBITRATION_ABANDONED");
      return this.unknown(journal, this.pythonBin ? "UPDATE_LOCK_ARBITRATION_FAILED" : "UPDATE_LOCK_RUNTIME_UNAVAILABLE");
    }
    if (journal.state === "unknown") return { ...journal, ok: false, recoveryBlocked: true, verified: false };
    if (installerReason) return this.unknown(journal, installerReason);
    const pending = pendingRequest(this.updatesRoot, this.installRoot, ignoreRequestNonce);
    if (pending) return this.unknown(journal, pending.reason);
    const verified = journal.verified === true;
    return {
      ...journal,
      ok: (journal.state === "complete" || journal.state === "rolled_back") && verified,
      recoveryBlocked: !verified,
      verified,
    };
  }

  unknown(journal, reason) {
    return {
      ...journal, ok: false, state: "unknown", phase: "recovery", reason,
      recoveryBlocked: true, verified: false,
    };
  }

  isBusySync(execFileSync) {
    if (fs.existsSync(this.legacyLockPath)) return true;
    if (unresolvedInstallerReason(this.updatesRoot, this.installRoot)
      || pendingRequest(this.updatesRoot, this.installRoot)) return true;
    const journal = this.readJournal();
    if (journal?.invalid || journal?.state === "unknown" || (journal && ACTIVE_STATES.has(journal.state))
      || this.isFinalizationPending(journal)) return true;
    if (!this.pythonBin) return true;
    try {
      execFileSync(this.pythonBin, ["-c", LOCK_PROGRAM, this.lockPath], {
        stdio: ["ignore", "ignore", "ignore"], timeout: 3000, env: this.lockEnvironment,
      });
      return false;
    } catch {
      return true;
    }
  }
}

module.exports = {
  ACTIVE_STATES,
  TERMINAL_STATES,
  MacUpdateTransactionStore,
  acquirePosixFileLock,
  atomicWriteJson,
  canonicalInstallRoot,
  ensurePrivateDirectory,
  pendingRequest,
  unresolvedInstallerReason,
  probePosixFileLock,
  resolveLockPython,
};
