"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(["starting", "busy", "installing", "recovering"]);
const STAGES = new Set([
  "starting", "snapshotting", "snapshot_complete", "staging", "staging_ready",
  "moving_old", "old_moved", "deploying", "new_root_deployed",
  "preparing_registration", "registering_manifests", "manifests_registered",
  "verifying_success", "report_written", "complete", "recovering",
  "rolled_back", "failed_safe", "unknown",
]);

function normalizeManifestPaths(value) {
  const entries = Array.isArray(value)
    ? value.map((item) => [item.name, item.path || item.manifestPath])
    : Object.entries(value || {});
  const result = {};
  for (const [name, file] of entries.sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (!["chrome", "edge"].includes(name) || typeof file !== "string" || !path.isAbsolute(file)) {
      throw new Error("INSTALLER_MANIFEST_PATHS_INVALID");
    }
    result[name] = path.resolve(file);
  }
  if (Object.keys(result).length !== 2) throw new Error("INSTALLER_MANIFEST_PATHS_INVALID");
  return result;
}
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex"));
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, filePath);
    fsyncDirectory(dir);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error;
  }
}
function canonicalInstallRoot(value) {
  const resolved = path.resolve(String(value || ""));
  if (!path.basename(resolved) || path.basename(resolved) === "." || path.basename(resolved) === "..") {
    throw new Error("INSTALLER_ROOT_INVALID");
  }
  const root = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  try {
    const st = fs.lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("INSTALLER_ROOT_INVALID");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return root;
}
function assertIdentity(value, nonce, root) {
  if (!value || value.schema !== 2 || value.nonce !== nonce || value.canonicalRoot !== root
      || !UUID.test(String(nonce || ""))) throw new Error("INSTALLER_JOURNAL_IDENTITY_INVALID");
}
function readInstallerJournal(journalPath, { nonce, canonicalRoot: root } = {}) {
  if (!fs.existsSync(journalPath)) return null;
  let journal;
  try { journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); }
  catch { throw new Error("INSTALLER_JOURNAL_INVALID"); }
  if (!journal || Array.isArray(journal) || typeof journal !== "object"
      || journal.schema !== 2 || !UUID.test(String(journal.nonce || ""))
      || !STAGES.has(journal.stage) || typeof journal.canonicalRoot !== "string") {
    throw new Error("INSTALLER_JOURNAL_INVALID");
  }
  journal.manifestPaths = normalizeManifestPaths(journal.manifestPaths);
  if (nonce !== undefined || root !== undefined) assertIdentity(journal, nonce, root);
  return journal;
}
function writeInstallerJournal(journalPath, journal) {
  if (!journal || journal.schema !== 2 || !UUID.test(String(journal.nonce || ""))
      || !STAGES.has(journal.stage) || !journal.canonicalRoot) throw new Error("INSTALLER_JOURNAL_INVALID");
  const prior = readInstallerJournal(journalPath, { nonce: journal.nonce, canonicalRoot: journal.canonicalRoot });
  if (prior && ["complete", "rolled_back", "failed_safe"].includes(prior.stage) && prior.stage !== journal.stage
      && !(prior.stage === "complete" && prior.verified === true && journal.stage === "recovering"
        && typeof journal.recoveryReason === "string" && journal.recoveryReason.trim().length > 0
        && /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(journal.recoveryReason))) {
    throw new Error("INSTALLER_JOURNAL_TERMINAL");
  }
  const next = { ...prior, ...journal, updatedAt: new Date().toISOString() };
  if (!next.startedAt) next.startedAt = next.updatedAt;
  atomicWriteJson(journalPath, next);
  return next;
}
function walkTree(root) {
  if (!fs.existsSync(root)) return [{ path: ".", type: "absent" }];
  const entries = [];
  function walk(dir, relative) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.join(relative, name).split(path.sep).join("/");
      const st = fs.lstatSync(abs);
      const item = { path: rel, mode: st.mode & 0o777, type: "other" };
      if (st.isSymbolicLink()) { item.type = "symlink"; item.target = fs.readlinkSync(abs); }
      else if (st.isDirectory()) { item.type = "directory"; walk(abs, rel); }
      else if (st.isFile()) { item.type = "file"; item.sha256 = sha256(fs.readFileSync(abs)); item.size = st.size; }
      else throw new Error("INSTALLER_SNAPSHOT_SPECIAL_FILE");
      entries.push(item);
    }
  }
  const st = fs.lstatSync(root);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("INSTALLER_ROOT_INVALID");
  walk(root, "");
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
function treeFingerprint(root) { return sha256(JSON.stringify(walkTree(root))); }
function parentChain(file) {
  const chain = [];
  let cursor = path.dirname(file);
  for (let count = 0; count < 64; count++) {
    try {
      const st = fs.lstatSync(cursor);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("INSTALLER_MANIFEST_PARENT_INVALID");
      chain.push({ path: cursor, exists: true, mode: st.mode & 0o777 });
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      chain.push({ path: cursor, exists: false, mode: null });
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("INSTALLER_MANIFEST_PARENT_INVALID");
      cursor = parent;
    }
  }
  if (!chain.length || !chain[chain.length - 1].exists) throw new Error("INSTALLER_MANIFEST_PARENT_INVALID");
  return chain;
}
function manifestRecords(manifestPaths) {
  return Object.entries(normalizeManifestPaths(manifestPaths)).sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) => {
    const parents = parentChain(file);
    let st;
    try { st = fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return { name, file, exists: false, parents }; throw error; }
    if (!st.isFile() || st.isSymbolicLink()) throw new Error("INSTALLER_MANIFEST_INVALID");
    return { name, file, exists: true, mode: st.mode & 0o777, sha256: sha256(fs.readFileSync(file)), parents };
  });
}
function stateFingerprint(root, records) { return sha256(JSON.stringify({ tree: treeFingerprint(root), manifests: records })); }

function copyTree(source, destination) {
  fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true, dereference: false, errorOnExist: true });
}
function captureManifestSnapshot(manifestBackupRoot, records) {
  fs.mkdirSync(manifestBackupRoot, { recursive: false, mode: 0o700 });
  const stored = [];
  for (const record of records) {
    const name = "manifest-" + record.name + ".json";
    if (record.exists) {
      const copy = path.join(manifestBackupRoot, name);
      fs.copyFileSync(record.file, copy, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(copy, record.mode);
      const bytes = fs.readFileSync(copy);
      if (sha256(bytes) !== record.sha256) throw new Error("INSTALLER_SNAPSHOT_COPY_MISMATCH");
    }
    stored.push({ ...record, backupName: name });
  }
  atomicWriteJson(path.join(manifestBackupRoot, "snapshot.json"), { schema: 2, manifests: stored });
}
function loadManifestSnapshot(manifestBackupRoot, manifestPaths) {
  let snapshot;
  try { snapshot = JSON.parse(fs.readFileSync(path.join(manifestBackupRoot, "snapshot.json"), "utf8")); }
  catch { throw new Error("INSTALLER_MANIFEST_SNAPSHOT_INVALID"); }
  if (snapshot.schema !== 2 || !Array.isArray(snapshot.manifests)) throw new Error("INSTALLER_MANIFEST_SNAPSHOT_INVALID");
  const expected = Object.entries(normalizeManifestPaths(manifestPaths)).sort(([a], [b]) => a.localeCompare(b));
  if (snapshot.manifests.length !== expected.length) throw new Error("INSTALLER_MANIFEST_SNAPSHOT_INVALID");
  for (let i = 0; i < expected.length; i++) {
    const [name, file] = expected[i], record = snapshot.manifests[i];
    if (record.name !== name || record.file !== file || record.backupName !== "manifest-" + name + ".json") {
      throw new Error("INSTALLER_MANIFEST_SNAPSHOT_INVALID");
    }
    if (record.exists) {
      const bytes = fs.readFileSync(path.join(manifestBackupRoot, record.backupName));
      if (sha256(bytes) !== record.sha256) throw new Error("INSTALLER_MANIFEST_SNAPSHOT_MISMATCH");
    }
  }
  return snapshot.manifests;
}
function snapshotInstallation({ root, snapshotRoot, manifestBackupRoot, manifestPaths, nonce, canonicalRoot: expectedRoot }) {
  const canonical = canonicalInstallRoot(root);
  if (canonical !== expectedRoot || !UUID.test(String(nonce || ""))) throw new Error("INSTALLER_SNAPSHOT_IDENTITY_INVALID");
  if (fs.existsSync(snapshotRoot) || fs.existsSync(manifestBackupRoot)) throw new Error("INSTALLER_SNAPSHOT_ALREADY_EXISTS");
  const present = fs.existsSync(canonical);
  if (present) copyTree(canonical, snapshotRoot);
  const records = manifestRecords(manifestPaths);
  captureManifestSnapshot(manifestBackupRoot, records);
  const fingerprint = stateFingerprint(present ? snapshotRoot : path.join(snapshotRoot, ".absent-root"), records);
  return { schema: 2, nonce, canonicalRoot: canonical, snapshotRoot, manifestBackupRoot, rootExisted: present, originalFingerprint: fingerprint };
}
function verifySnapshot({ root, snapshotRoot, manifestBackupRoot, manifestPaths, expectedFingerprint, nonce, canonicalRoot: expectedRoot }) {
  const canonical = canonicalInstallRoot(root);
  if (canonical !== expectedRoot || !UUID.test(String(nonce || "")) || !/^[a-f0-9]{64}$/.test(String(expectedFingerprint || ""))) {
    return { ok: false, reason: "INSTALLER_SNAPSHOT_IDENTITY_INVALID" };
  }
  try {
    const stored = loadManifestSnapshot(manifestBackupRoot, manifestPaths);
    const snapshotTree = treeFingerprint(snapshotRoot);
    const liveRecords = manifestRecords(manifestPaths);
    const snapshotFingerprint = sha256(JSON.stringify({ tree: snapshotTree, manifests: stored.map(({ backupName, ...record }) => record) }));
    const liveFingerprint = stateFingerprint(canonical, liveRecords);
    return { ok: snapshotFingerprint === expectedFingerprint && liveFingerprint === expectedFingerprint,
      fingerprint: liveFingerprint, snapshotFingerprint,
      reason: snapshotFingerprint === expectedFingerprint && liveFingerprint === expectedFingerprint ? undefined : "INSTALLER_SNAPSHOT_FINGERPRINT_MISMATCH" };
  } catch (error) { return { ok: false, reason: error.message || "INSTALLER_SNAPSHOT_INVALID" }; }
}
function processTable() {
  const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,comm="], { encoding: "utf8", timeout: 5000 });
  return output.trim().split("\n").map((line) => {
    const row = line.trim().split(/\s+/);
    return { pid: Number(row[0]), ppid: Number(row[1]), pgid: Number(row[2]), command: row.slice(3).join(" ") };
  }).filter((row) => [row.pid, row.ppid, row.pgid].every(Number.isFinite) && path.basename(row.command) !== "ps");
}
function processRecord(pid) {
  return processTable().find((row) => row.pid === Number(pid)) || null;
}
function processGroupMembers(groupId) {
  const table = processTable();
  const descendants = new Set([process.pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); grew = true; }
    }
  }
  return table.filter((row) => row.pgid === Number(groupId) && !descendants.has(row.pid) && row.command !== "ps");
}
function controlJson(file, expectedNonce) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) {
    throw new Error("INSTALLER_LOCK_CONTROL_INVALID");
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("INSTALLER_LOCK_CONTROL_INVALID"); }
  if (!value || value.schema !== 1 || value.nonce !== expectedNonce) throw new Error("INSTALLER_LOCK_CONTROL_INVALID");
  return value;
}
function assertFileLockBusy(lockPath, pythonBin) {
  const script = [
    "import fcntl, os, stat, sys",
    "fd = os.open(sys.argv[1], os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))",
    "st = os.fstat(fd)",
    "if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1: sys.exit(4)",
    "try: fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)",
    "except BlockingIOError: print('BUSY'); sys.exit(0)",
    "print('FREE'); sys.exit(4)",
  ].join("\n");
  try {
    const output = execFileSync(pythonBin, ["-c", script, lockPath], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: os.homedir(), ...(process.env.DYLD_FRAMEWORK_PATH ? { DYLD_FRAMEWORK_PATH: process.env.DYLD_FRAMEWORK_PATH } : {}) },
    }).trim();
    if (output !== "BUSY") throw new Error();
  } catch { throw new Error("INSTALLER_LOCK_LOST"); }
  return true;
}
function assertManualLockHeldSync({ lockPath, statusPath, nonce, holderPid, pythonBin }) {
  try {
    const status = controlJson(statusPath, nonce);
    if (status.lockPath !== path.resolve(lockPath) || status.holderPid !== Number(holderPid)
        || status.holderPid < 2 || !pidAlive(status.holderPid)) throw new Error();
    return assertFileLockBusy(lockPath, pythonBin);
  } catch { throw new Error("INSTALLER_LOCK_LOST"); }
}
function assertWorkerLockHeldSync({ lockPath, workerJournalPath, nonce, canonicalRoot, pythonBin }) {
  try {
    const worker = validateWorkerJournal(workerJournalPath, nonce, canonicalRoot);
    if (!pidAlive(Number(worker.workerPid))) throw new Error();
    return assertFileLockBusy(lockPath, pythonBin);
  } catch { throw new Error("INSTALLER_LOCK_LOST"); }
}
async function assertManualLockHeld({ lockPath, statusPath, nonce, holderPid, pythonBin }) {
  try {
    const status = controlJson(statusPath, nonce);
    if (status.lockPath !== path.resolve(lockPath) || status.holderPid !== Number(holderPid)
        || status.holderPid < 2 || !pidAlive(status.holderPid)) throw new Error();
    const { probePosixFileLock } = require("./macos_update_transaction.js");
    const environment = {};
    if (process.env.DYLD_FRAMEWORK_PATH) environment.DYLD_FRAMEWORK_PATH = process.env.DYLD_FRAMEWORK_PATH;
    if (await probePosixFileLock(lockPath, pythonBin, undefined, 3000, environment) !== "busy") throw new Error();
    return true;
  } catch { throw new Error("INSTALLER_LOCK_LOST"); }
}
async function assertWorkerLockHeld({ lockPath, workerJournalPath, nonce, canonicalRoot, pythonBin }) {
  try {
    const worker = validateWorkerJournal(workerJournalPath, nonce, canonicalRoot);
    if (!pidAlive(Number(worker.workerPid))) throw new Error();
    const { probePosixFileLock } = require("./macos_update_transaction.js");
    const environment = {};
    if (process.env.DYLD_FRAMEWORK_PATH) environment.DYLD_FRAMEWORK_PATH = process.env.DYLD_FRAMEWORK_PATH;
    if (await probePosixFileLock(lockPath, pythonBin, undefined, 3000, environment) !== "busy") throw new Error();
    return true;
  } catch { throw new Error("INSTALLER_LOCK_LOST"); }
}
function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; }
}
function assertInstallerStopped({ installerPid, processGroupId, isolatedProcessGroup, allowCurrentInstallerPid, lockHolderPid }) {
  const pid = Number(installerPid);
  if (!Number.isInteger(pid) || pid < 2) throw new Error("INSTALLER_PROCESS_IDENTITY_INVALID");
  const table = processTable();
  if (pidAlive(pid)) {
    if (!allowCurrentInstallerPid) throw new Error("INSTALLER_PROCESS_STILL_RUNNING");
    const parents = new Map(table.map((p) => [p.pid, p.ppid]));
    let cursor = process.pid, found = false;
    for (let count = 0; count < 256 && parents.has(cursor); count++) {
      cursor = parents.get(cursor);
      if (cursor === pid) { found = true; break; }
      if (cursor <= 1) break;
    }
    if (!found) throw new Error("INSTALLER_PROCESS_IDENTITY_INVALID");
    const descendants = new Set([pid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of table) if (p.command !== "ps" && descendants.has(p.ppid) && !descendants.has(p.pid)) { descendants.add(p.pid); grew = true; }
    }
    const ignored = new Set();
    const holder = Number(lockHolderPid);
    if (Number.isInteger(holder) && descendants.has(holder) && holder !== process.pid) {
      ignored.add(holder);
      let ignoredGrew = true;
      while (ignoredGrew) {
        ignoredGrew = false;
        for (const p of table) if (ignored.has(p.ppid) && !ignored.has(p.pid)) { ignored.add(p.pid); ignoredGrew = true; }
      }
    }
    for (const child of descendants) {
      if (child !== pid && child !== process.pid && !ignored.has(child)) throw new Error("INSTALLER_CHILD_PROCESS_STILL_RUNNING");
    }
  }
  if (isolatedProcessGroup) {
    const group = Number(processGroupId);
    if (!Number.isInteger(group) || group < 2) throw new Error("INSTALLER_PROCESS_IDENTITY_INVALID");
    const members = table.filter((p) => p.command !== "ps" && p.pgid === group && p.pid !== process.pid && !(allowCurrentInstallerPid && p.pid === pid));
    if (members.length) throw new Error("INSTALLER_CHILD_PROCESS_STILL_RUNNING");
  } else if (!allowCurrentInstallerPid && pidAlive(pid)) {
    throw new Error("INSTALLER_PROCESS_STILL_RUNNING");
  }
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error("INSTALLER_PRIVATE_PATH_INVALID");
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync(directory);
}
function pinnedPython(value, testFrameworkPath) {
  let real;
  try { real = fs.realpathSync(path.resolve(value)); } catch { throw new Error("INSTALLER_PYTHON_INVALID"); }
  const base = testFrameworkPath
    ? path.join(fs.realpathSync(testFrameworkPath), "Python.framework", "Versions", "3.14")
    : "/Library/Frameworks/Python.framework/Versions/3.14";
  const framework = fs.realpathSync(base);
  const relative = path.relative(framework, real);
  if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) throw new Error("INSTALLER_PYTHON_INVALID");
  const version = execFileSync(real, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
  if (version !== "Python 3.14.6") throw new Error("INSTALLER_PYTHON_INVALID");
  execFileSync(real, ["-c", "import fcntl,sys; assert sys.version_info[:3] == (3,14,6)"], { stdio: "ignore", timeout: 5000 });
  return real;
}
function validateWorkerJournal(file, nonce, root) {
  let value;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) throw new Error();
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { throw new Error("INSTALLER_WORKER_JOURNAL_INVALID"); }
  if (value.schemaVersion !== 2 || value.nonce !== nonce || value.canonicalInstallRoot !== root
      || !ACTIVE.has(value.state) || !Number.isInteger(Number(value.workerPid)) || !pidAlive(Number(value.workerPid))) {
    throw new Error("INSTALLER_WORKER_OWNERSHIP_INVALID");
  }
  return value;
}
function scanUnresolvedInstallers(updatesRoot, root, exclude) {
  if (!fs.existsSync(updatesRoot)) return;
  for (const entry of fs.readdirSync(updatesRoot)) {
    const file = path.join(updatesRoot, entry, "installer-transaction.json");
    if (file === exclude || !fs.existsSync(file)) continue;
    try {
      const j = readInstallerJournal(file);
      if (j.canonicalRoot !== root) continue;
      const safeTerminal = ["complete", "rolled_back", "failed_safe"].includes(j.stage) && j.verified === true;
      if (!safeTerminal) throw new Error("INSTALLER_RECOVERY_REQUIRED");
    } catch (error) {
      if (error.message === "INSTALLER_RECOVERY_REQUIRED") throw error;
      throw new Error("INSTALLER_JOURNAL_INVALID");
    }
  }
}
function beginInstaller({ root, journalPath, nonce, mode, workerJournalPath, lockPython, manifestPaths, stagingRoot, backupRoot, installerPid, processGroupId, lockPath, lockStatusPath, lockHolderPid }) {
  const canonical = canonicalInstallRoot(root);
  if (!UUID.test(String(nonce || ""))) throw new Error("INSTALLER_NONCE_INVALID");
  const workerMode = mode === "worker";
  if (workerMode) {
    if (process.env.APPRAISAL_UPDATE_MODE !== "worker" || process.env.APPRAISAL_UPDATE_NONCE !== nonce
        || process.env.APPRAISAL_UPDATE_WORKER_JOURNAL !== workerJournalPath
        || process.env.APPRAISAL_UPDATE_INSTALLER_JOURNAL !== journalPath
        || process.env.APPRAISAL_UPDATE_LOCK_PYTHON !== lockPython) throw new Error("INSTALLER_WORKER_ENV_INVALID");
  } else if (mode !== "manual" || process.env.APPRAISAL_UPDATE_MODE === "worker") {
    throw new Error("INSTALLER_MODE_INVALID");
  }
  const updatesRoot = workerMode ? path.dirname(workerJournalPath) : path.join(os.homedir(), ".appraisal-toolbox-updates");
  if (path.resolve(journalPath) !== path.join(updatesRoot, nonce, "installer-transaction.json")
      || path.resolve(stagingRoot) !== canonical + ".staging-" + nonce
      || path.resolve(backupRoot) !== canonical + ".previous-" + nonce) throw new Error("INSTALLER_PATH_BINDING_INVALID");
  if (path.dirname(stagingRoot) !== path.dirname(canonical) || path.dirname(backupRoot) !== path.dirname(canonical)) {
    throw new Error("INSTALLER_PATH_BINDING_INVALID");
  }
  pinnedPython(lockPython, process.env.APPRAISAL_TEST_FRAMEWORK_PATH);
  const lockRoot = ensurePrivateDirectory(updatesRoot);
  if (workerMode) {
    assertWorkerLockHeldSync({ lockPath, workerJournalPath, nonce, canonicalRoot: canonical, pythonBin: lockPython });
  } else {
    assertManualLockHeldSync({ lockPath, statusPath: lockStatusPath, nonce, holderPid: lockHolderPid, pythonBin: lockPython });
  }
  if (!workerMode) {
    const workerPath = path.join(lockRoot, "transaction.json");
    if (fs.existsSync(workerPath)) {
      let prior;
      try { prior = JSON.parse(fs.readFileSync(workerPath, "utf8")); } catch { throw new Error("INSTALLER_WORKER_JOURNAL_INVALID"); }
      if (prior.canonicalInstallRoot === canonical
          && (!(["complete", "rolled_back", "failed_safe"].includes(prior.state)) || prior.verified !== true)) {
        throw new Error("INSTALLER_RECOVERY_REQUIRED");
      }
    }
  }
  if (fs.existsSync(stagingRoot) || fs.existsSync(backupRoot)) throw new Error("INSTALLER_STAGING_PATH_EXISTS");
  scanUnresolvedInstallers(lockRoot, canonical, journalPath);
  const dir = path.dirname(journalPath);
  if (fs.existsSync(dir)) {
    ensurePrivateDirectory(dir);
    const allowedWorkerArtifacts = new Set(["extracted", "update.zip", "installer.log"]);
    if (fs.readdirSync(dir).some(name => !workerMode || !allowedWorkerArtifacts.has(name))) {
      throw new Error("INSTALLER_JOURNAL_ALREADY_EXISTS");
    }
  } else ensurePrivateDirectory(dir);
  if (fs.existsSync(journalPath)) throw new Error("INSTALLER_JOURNAL_ALREADY_EXISTS");
  const journal = {
    schema: 2, nonce, canonicalRoot: canonical, stage: "starting", state: "active", verified: false,
    updatesRoot: lockRoot, installerPid: Number(installerPid), installerProcessGroupId: Number(processGroupId),
    isolatedProcessGroup: workerMode, lockHolderPid: workerMode ? null : Number(lockHolderPid), backupRoot, stagingRoot,
    snapshotRoot: path.join(dir, "snapshot"), manifestBackupRoot: path.join(dir, "manifests"),
    manifestPaths: normalizeManifestPaths(manifestPaths), originalFingerprint: null, rootExisted: fs.existsSync(canonical),
    workerJournalPath: workerMode ? workerJournalPath : null,
  };
  return writeInstallerJournal(journalPath, journal);
}
function journalSnapshot(journalPath) {
  const j = readInstallerJournal(journalPath);
  if (!j) throw new Error("INSTALLER_JOURNAL_MISSING");
  return j;
}
function snapshotJournal(journalPath) {
  const j = journalSnapshot(journalPath);
  writeInstallerJournal(journalPath, { ...j, stage: "snapshotting" });
  const snapshot = snapshotInstallation({
    root: j.canonicalRoot, snapshotRoot: j.snapshotRoot, manifestBackupRoot: j.manifestBackupRoot,
    manifestPaths: j.manifestPaths, nonce: j.nonce, canonicalRoot: j.canonicalRoot,
  });
  return writeInstallerJournal(journalPath, { ...j, ...snapshot, stage: "snapshot_complete", state: "active" });
}
function restoreManifestRecords(manifestBackupRoot, manifestPaths) {
  const records = loadManifestSnapshot(manifestBackupRoot, manifestPaths);
  for (const record of records) {
    const parent = path.dirname(record.file);
    const immediate = record.parents[0];
    if (immediate && immediate.exists) {
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      fs.chmodSync(parent, immediate.mode | 0o700);
    } else {
      fs.rmSync(record.file, { force: true });
      for (const directory of record.parents) {
        if (directory.exists) break;
        try { fs.rmdirSync(directory.path); } catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error; }
      }
      continue;
    }
    if (!record.exists) fs.rmSync(record.file, { force: true });
    else {
      const source = path.join(manifestBackupRoot, record.backupName);
      const temp = record.file + ".restore-" + process.pid;
      fs.copyFileSync(source, temp);
      fs.chmodSync(temp, record.mode);
      const fd = fs.openSync(temp, fs.constants.O_RDONLY);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, record.file);
    }
    fs.chmodSync(parent, immediate.mode);
    fsyncDirectory(parent);
  }
}
function runNativeSelfTest(root) {
  const launcher = path.join(root, "native-helper", "native_host_launcher.sh");
  const env = {
    ...process.env,
    APPRAISAL_TOOLBOX_ROOT: root,
    TIANYUAN_NATIVE_RUNTIME_ROOT: path.join(root, "native-helper"),
    TIANYUAN_RUNTIME_CONFIG_PATH: path.join(root, "native-helper", "runtime-config.json"),
  };
  const output = execFileSync("/bin/bash", [launcher, "--self-test"], { encoding: "utf8", env, timeout: 30000 });
  const result = JSON.parse(output);
  if (!result.ok || !result.pythonSkillImportSmoke || result.pythonSkillImportSmoke.ok !== true) {
    throw new Error("INSTALLER_NATIVE_SELF_TEST_FAILED");
  }
  return result;
}
function recoveryIdentityMatches(journal, options) {
  return journal && journal.originalFingerprint === options.expectedFingerprint
    && journal.snapshotRoot === options.snapshotRoot && journal.manifestBackupRoot === options.manifestBackupRoot;
}
function assertJournalInstallerStopped(journal, options) {
  assertInstallerStopped({
    installerPid: options.installerPid, processGroupId: options.processGroupId,
    isolatedProcessGroup: journal.isolatedProcessGroup, allowCurrentInstallerPid: options.allowCurrentInstallerPid === true,
    lockHolderPid: journal.lockHolderPid,
  });
}
function verifyRolledBackInstallation(journal, options) {
  if (journal.verified !== true || typeof journal.rollbackFingerprint !== "string" || !journal.rollbackFingerprint) {
    return { state: "unknown", verified: false, reason: "INSTALLER_ROLLBACK_PROOF_INVALID" };
  }
  try {
    assertJournalInstallerStopped(journal, options);
    const verified = verifySnapshot({
      root: journal.canonicalRoot, snapshotRoot: journal.snapshotRoot, manifestBackupRoot: journal.manifestBackupRoot,
      manifestPaths: journal.manifestPaths, expectedFingerprint: journal.originalFingerprint,
      nonce: journal.nonce, canonicalRoot: journal.canonicalRoot,
    });
    if (!verified.ok || verified.fingerprint !== journal.rollbackFingerprint) {
      throw new Error(verified.reason || "INSTALLER_ROLLBACK_VERIFICATION_FAILED");
    }
    const selfTest = journal.rootExisted ? runNativeSelfTest(journal.canonicalRoot) : null;
    if (journal.rootExisted && (journal.selfTestOk !== true || !selfTest.ok)) throw new Error("INSTALLER_NATIVE_SELF_TEST_FAILED");
    if (!journal.rootExisted && journal.selfTestSkipped !== "NO_PRIOR_INSTALLATION") throw new Error("INSTALLER_ROLLBACK_PROOF_INVALID");
    return { state: "rolled_back", verified: true, fingerprint: verified.fingerprint,
      selfTestOk: selfTest ? selfTest.ok : null, selfTestSkipped: selfTest ? undefined : "NO_PRIOR_INSTALLATION" };
  } catch (error) {
    return { state: "unknown", verified: false, reason: error.message || "INSTALLER_RECOVERY_UNKNOWN" };
  }
}
function recoverInstallation(options) {
  const j = readInstallerJournal(options.journalPath, { nonce: options.nonce, canonicalRoot: options.canonicalRoot });
  if (!recoveryIdentityMatches(j, options)) {
    return { state: "unknown", verified: false, reason: "INSTALLER_RECOVERY_IDENTITY_INVALID" };
  }
  if (j.stage === "rolled_back") return verifyRolledBackInstallation(j, options);
  let recoveryReason = null;
  if (j.stage === "complete") {
    const suppliedReason = typeof options.reason === "string" ? options.reason.trim() : "";
    if (j.verified !== true || options.allowVerifiedCompleteRollback !== true || !suppliedReason) {
      return { state: "unknown", verified: false, reason: "INSTALLER_COMPLETE_RECOVERY_NOT_ALLOWED" };
    }
    recoveryReason = /^(?:UPDATE_[A-Z0-9_]+|PLATFORM_UPDATE_UNSUPPORTED)$/.test(suppliedReason)
      ? suppliedReason : "UPDATE_FAILED";
  }
  try {
    writeInstallerJournal(options.journalPath, { ...j, stage: "recovering", state: "recovering", verified: false,
      ...(recoveryReason ? { recoveryReason } : {}) });
    assertJournalInstallerStopped(j, options);
    const before = verifySnapshot({
      root: j.canonicalRoot, snapshotRoot: j.snapshotRoot, manifestBackupRoot: j.manifestBackupRoot,
      manifestPaths: j.manifestPaths, expectedFingerprint: j.originalFingerprint, nonce: j.nonce, canonicalRoot: j.canonicalRoot,
    });
    if (!before.snapshotFingerprint || before.snapshotFingerprint !== j.originalFingerprint) throw new Error("INSTALLER_SNAPSHOT_FINGERPRINT_MISMATCH");
    const failedRoot = j.canonicalRoot + ".failed-" + j.nonce;
    const restoreRoot = j.canonicalRoot + ".restore-" + j.nonce;
    if (fs.existsSync(failedRoot) || fs.existsSync(restoreRoot)) throw new Error("INSTALLER_RECOVERY_PATH_EXISTS");
    if (fs.existsSync(j.snapshotRoot)) copyTree(j.snapshotRoot, restoreRoot);
    else if (j.rootExisted) throw new Error("INSTALLER_SNAPSHOT_MISSING");
    if (fs.existsSync(j.canonicalRoot)) fs.renameSync(j.canonicalRoot, failedRoot);
    if (j.rootExisted) fs.renameSync(restoreRoot, j.canonicalRoot);
    restoreManifestRecords(j.manifestBackupRoot, j.manifestPaths);
    const verified = verifySnapshot({
      root: j.canonicalRoot, snapshotRoot: j.snapshotRoot, manifestBackupRoot: j.manifestBackupRoot,
      manifestPaths: j.manifestPaths, expectedFingerprint: j.originalFingerprint, nonce: j.nonce, canonicalRoot: j.canonicalRoot,
    });
    if (!verified.ok) throw new Error(verified.reason || "INSTALLER_ROLLBACK_VERIFICATION_FAILED");
    const selfTest = j.rootExisted ? runNativeSelfTest(j.canonicalRoot) : null;
    writeInstallerJournal(options.journalPath, { ...j, stage: "rolled_back", state: "rolled_back", verified: true,
      ...(recoveryReason ? { recoveryReason } : {}), rollbackFingerprint: verified.fingerprint, selfTestOk: selfTest ? true : null,
      selfTestSkipped: selfTest ? null : "NO_PRIOR_INSTALLATION", rolledBackAt: new Date().toISOString() });
    return { state: "rolled_back", verified: true, fingerprint: verified.fingerprint,
      selfTestOk: selfTest ? selfTest.ok : null, selfTestSkipped: selfTest ? undefined : "NO_PRIOR_INSTALLATION" };
  } catch (error) {
    try { writeInstallerJournal(options.journalPath, { ...j, stage: "unknown", state: "unknown", verified: false, reason: error.message }); } catch {}
    return { state: "unknown", verified: false, reason: error.message || "INSTALLER_RECOVERY_UNKNOWN" };
  }
}

async function holdLock(lockPath, pythonBin, ownerPid, processGroupId, nonce, statusPath, releasePath) {
  const { acquirePosixFileLock } = require("./macos_update_transaction.js");
  const lock = path.resolve(lockPath);
  const status = path.resolve(statusPath);
  const release = path.resolve(releasePath);
  const root = path.dirname(lock);
  const owner = Number(ownerPid), group = Number(processGroupId);
  if (!UUID.test(String(nonce || "")) || !Number.isInteger(owner) || owner < 2
      || !Number.isInteger(group) || group < 2 || path.dirname(status) !== root || path.dirname(release) !== root
      || status === release || status === lock || release === lock) throw new Error("INSTALLER_LOCK_CONTROL_INVALID");
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {});
  const lockEnvironment = {};
  if (process.env.DYLD_FRAMEWORK_PATH) lockEnvironment.DYLD_FRAMEWORK_PATH = process.env.DYLD_FRAMEWORK_PATH;
  let held;
  let statusWritten = false;
  let released = false;
  try {
    held = await acquirePosixFileLock(lock, pythonBin, undefined, 10000, 3000, lockEnvironment);
    const ownerAtStart = processRecord(owner);
    if (!ownerAtStart || ownerAtStart.pgid !== group) throw new Error("INSTALLER_LOCK_OWNER_INVALID");
    const payload = { schema: 1, nonce, lockPath: lock, holderPid: process.pid, ownerPid: owner, processGroupId: group };
    const fd = fs.openSync(status, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(payload) + "\n", "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    statusWritten = true;
    process.stdout.write("LOCKED\n");
    while (true) {
      let requested = false;
      try { requested = fs.readFileSync(release, "utf8").trim() === nonce; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (requested) break;
      const currentOwner = processRecord(owner);
      const sameOwner = currentOwner && currentOwner.pgid === group && currentOwner.command === ownerAtStart.command;
      if (!sameOwner && processGroupMembers(group).length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    released = await held.release();
    process.exitCode = released ? 0 : 1;
  } finally {
    if (statusWritten && released) {
      try { fs.rmSync(status, { force: true }); } catch {}
      try { fs.rmSync(release, { force: true }); } catch {}
    }
  }
}
function writeLockRelease(releasePath, nonce) {
  if (!UUID.test(String(nonce || ""))) throw new Error("INSTALLER_LOCK_CONTROL_INVALID");
  const file = path.resolve(releasePath);
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(fd, nonce + "\n", "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function cli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "begin") {
    const [root, journalPath, nonce, mode, workerJournalPath, lockPython, chrome, edge, stagingRoot, backupRoot, installerPid, processGroupId, lockPath, lockStatusPath, lockHolderPid] = args;
    const j = beginInstaller({
      root, journalPath, nonce, mode, workerJournalPath: workerJournalPath || null, lockPython,
      manifestPaths: { chrome, edge }, stagingRoot, backupRoot, installerPid, processGroupId,
      lockPath, lockStatusPath: lockStatusPath || null, lockHolderPid,
    });
    process.stdout.write(JSON.stringify({ stage: j.stage, canonicalRoot: j.canonicalRoot, nonce: j.nonce }) + "\n");
    return;
  }
  if (command === "snapshot") {
    const j = snapshotJournal(args[0]);
    process.stdout.write(j.originalFingerprint + "\n");
    return;
  }
  if (command === "stage") {
    const file = args[0], stage = args[1], j = journalSnapshot(file);
    if (!STAGES.has(stage)) throw new Error("INSTALLER_STAGE_INVALID");
    const terminal = stage === "complete" || stage === "rolled_back" || stage === "failed_safe";
    writeInstallerJournal(file, { ...j, stage, state: terminal ? stage : stage === "unknown" ? "unknown" : "active",
      verified: terminal && stage !== "unknown", completedAt: terminal ? new Date().toISOString() : j.completedAt });
    return;
  }
  if (command === "verify-snapshot") {
    const j = journalSnapshot(args[0]);
    const result = verifySnapshot({
      root: j.canonicalRoot, snapshotRoot: j.snapshotRoot, manifestBackupRoot: j.manifestBackupRoot,
      manifestPaths: j.manifestPaths, expectedFingerprint: j.originalFingerprint, nonce: j.nonce, canonicalRoot: j.canonicalRoot,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === "recover") {
    const file = args[0], j = journalSnapshot(file);
    const result = recoverInstallation({
      journalPath: file, root: j.canonicalRoot, snapshotRoot: j.snapshotRoot,
      manifestBackupRoot: j.manifestBackupRoot, manifestPaths: j.manifestPaths,
      expectedFingerprint: j.originalFingerprint, nonce: j.nonce, canonicalRoot: j.canonicalRoot,
      installerPid: j.installerPid, processGroupId: j.installerProcessGroupId,
      allowCurrentInstallerPid: process.env.APPRAISAL_INSTALLER_TRAP_RECOVERY === "1",
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!result.verified) process.exitCode = 2;
    return;
  }
  if (command === "read") {
    const j = readInstallerJournal(args[0]);
    process.stdout.write(JSON.stringify(j) + "\n");
    return;
  }
  if (command === "hold-lock") {
    const [lockPath, pythonBin, ownerPid, processGroupId, nonce, statusPath, releasePath] = args;
    return holdLock(lockPath, pythonBin, ownerPid, processGroupId, nonce, statusPath, releasePath);
  }
  if (command === "release-lock") {
    const [releasePath, nonce] = args;
    writeLockRelease(releasePath, nonce);
    return;
  }
  if (command === "assert-lock") {
    const [lockPath, statusPath, nonce, holderPid, pythonBin] = args;
    return assertManualLockHeld({ lockPath, statusPath, nonce, holderPid, pythonBin }).then(() => process.stdout.write("LOCKED\n"));
  }
  if (command === "assert-worker-lock") {
    const [lockPath, workerJournalPath, nonce, canonicalRoot, pythonBin] = args;
    return assertWorkerLockHeld({ lockPath, workerJournalPath, nonce, canonicalRoot, pythonBin }).then(() => process.stdout.write("LOCKED\n"));
  }
  throw new Error("INSTALLER_TRANSACTION_COMMAND_INVALID");
}
if (require.main === module) {
  try {
    const result = cli();
    if (result && typeof result.then === "function") result.catch((error) => { process.stderr.write((error.message || "INSTALLER_TRANSACTION_FAILED") + "\n"); process.exitCode = 1; });
  } catch (error) { process.stderr.write((error.message || "INSTALLER_TRANSACTION_FAILED") + "\n"); process.exitCode = 1; }
}
module.exports = {
  snapshotInstallation, verifySnapshot, recoverInstallation, readInstallerJournal,
  writeInstallerJournal, beginInstaller, canonicalInstallRoot, treeFingerprint, stateFingerprint,
  manifestRecords, normalizeManifestPaths, pinnedPython, assertInstallerStopped,
  scanUnresolvedInstallers, assertManualLockHeld, assertWorkerLockHeld,
  assertManualLockHeldSync, assertWorkerLockHeldSync, assertFileLockBusy,
};
