"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const {
  assertManualLockHeldSync,
  recoverInstallation,
  scanUnresolvedInstallers,
  snapshotInstallation,
  treeFingerprint,
  readInstallerJournal,
  writeInstallerJournal,
} = require("./macos_installer_transaction.js");

const PYTHON = process.env.APPRAISAL_TEST_LOCK_PYTHON || "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14";
const PYTHON_OK = (() => {
  try { execFileSync(PYTHON, ["-c", "import fcntl"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();
const HELPER = path.join(__dirname, "macos_installer_transaction.js");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "评估 工具箱 安装事务测试-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homePath = path.join(root, "home");
  fs.mkdirSync(homePath, { recursive: true });
  const home = fs.realpathSync(homePath);
  const updatesRoot = path.join(home, ".appraisal-toolbox-updates");
  const installRoot = path.join(home, ".appraisal-toolbox");
  fs.mkdirSync(updatesRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(installRoot, { recursive: true });
  return { root, home, updatesRoot, installRoot: fs.realpathSync(installRoot), lockPath: path.join(updatesRoot, "transaction.lock") };
}
function processGroupId(pid) {
  return Number(execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function until(predicate, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
}
function unresolvedJournal(updatesRoot, installRoot) {
  const nonce = crypto.randomUUID();
  const directory = path.join(updatesRoot, nonce);
  fs.mkdirSync(directory, { mode: 0o700 });
  const file = path.join(directory, "installer-transaction.json");
  writeInstallerJournal(file, {
    schema: 2, nonce, canonicalRoot: installRoot, stage: "starting", state: "active", verified: false,
    manifestPaths: {
      chrome: path.join(updatesRoot, "chrome.json"), edge: path.join(updatesRoot, "edge.json"),
    },
  });
  return { nonce, file };
}

test("installer shell parses with Bash 3.2 and runs the nonce command from a Chinese path with spaces", (t) => {
  const source = path.join(__dirname, "../macos/installer/install.sh");
  const text = fs.readFileSync(source, "utf8");
  assert.equal(text.includes("coproc"), false, "macOS system Bash does not support coproc");
  assert.match(text, /NONCE="\$\(\"\$NODE_BIN\" -p/);
  execFileSync("/bin/bash", ["-n", source], { stdio: "ignore" });
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "安装 包含 空格 "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const nodePath = path.join(fixtureRoot, "Node runtime");
  fs.symlinkSync(process.execPath, nodePath);
  const script = "NODE_BIN=\"$1\"; NONCE=\"$(\"$NODE_BIN\" -p 'require(\"node:crypto\").randomUUID()')\"; "
    + "case \"$NONCE\" in ????????-????-4???-????-????????????) ;; *) exit 2 ;; esac; printf '%s\\n' \"$NONCE\"";
  const nonce = execFileSync("/bin/bash", ["-c", script, "installer fixture", nodePath], { encoding: "utf8" }).trim();
  assert.match(nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("unresolved installer journals block every new installer even without a worker transaction journal", (t) => {
  const { updatesRoot, installRoot } = fixture(t);
  const { file } = unresolvedJournal(updatesRoot, installRoot);
  assert.equal(fs.existsSync(path.join(updatesRoot, "transaction.json")), false);
  assert.throws(() => scanUnresolvedInstallers(updatesRoot, installRoot), { message: "INSTALLER_RECOVERY_REQUIRED" });
  const journal = readInstallerJournal(file);
  assert.equal(journal.stage, "starting");
  assert.equal(journal.verified, false);
  journal.stage = "complete";
  journal.state = "complete";
  journal.verified = true;
  writeInstallerJournal(file, journal);
  assert.doesNotThrow(() => scanUnresolvedInstallers(updatesRoot, installRoot));
});


function recoveryFixture(t) {
  const base = fixture(t);
  const nonce = crypto.randomUUID();
  const journalDirectory = path.join(base.updatesRoot, nonce);
  fs.mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  const journalPath = path.join(journalDirectory, "installer-transaction.json");
  const snapshotRoot = path.join(journalDirectory, "snapshot");
  const manifestBackupRoot = path.join(journalDirectory, "manifests");
  const manifestPaths = {
    chrome: path.join(base.home, "Library/Application Support/Google/Chrome/NativeMessagingHosts/host.json"),
    edge: path.join(base.home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts/host.json"),
  };
  const versionPath = path.join(base.installRoot, "extension/version.json");
  const runtimeConfigPath = path.join(base.installRoot, "native-helper/runtime-config.json");
  const selfTestCountPath = path.join(base.root, "self-test-count.txt");
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({ productVersion: "0.2.1", buildNumber: 1 }));
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({ preservedSetting: "baseline" }));
  const selfTestResult = JSON.stringify({ ok: true, pythonSkillImportSmoke: { ok: true } });
  const launcher = path.join(base.installRoot, "native-helper/native_host_launcher.sh");
  fs.writeFileSync(launcher, `#!/bin/bash\nprintf x >> '${selfTestCountPath}'\nprintf '%s\\n' '${selfTestResult}'\n`, { mode: 0o755 });
  fs.chmodSync(launcher, 0o755);
  for (const file of Object.values(manifestPaths)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ path: "baseline" }));
  }
  const snapshot = snapshotInstallation({
    root: base.installRoot, snapshotRoot, manifestBackupRoot, manifestPaths, nonce, canonicalRoot: base.installRoot,
  });
  writeInstallerJournal(journalPath, {
    schema: 2, nonce, canonicalRoot: base.installRoot, stage: "complete", state: "complete", verified: true,
    installerPid: 99999999, installerProcessGroupId: 99999999, isolatedProcessGroup: false, lockHolderPid: null,
    updatesRoot: base.updatesRoot, backupRoot: `${base.installRoot}.previous-${nonce}`,
    stagingRoot: `${base.installRoot}.staging-${nonce}`, manifestPaths, ...snapshot,
  });
  fs.writeFileSync(versionPath, JSON.stringify({ productVersion: "0.2.2", buildNumber: 2 }));
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({ preservedSetting: "candidate" }));
  for (const file of Object.values(manifestPaths)) fs.writeFileSync(file, JSON.stringify({ path: "candidate" }));
  fs.writeFileSync(path.join(base.installRoot, "candidate-marker.txt"), "candidate\n");
  return { ...base, nonce, journalPath, snapshot, manifestPaths, versionPath, runtimeConfigPath, selfTestCountPath };
}
function recoveryOptions(fixture, extra = {}) {
  return {
    journalPath: fixture.journalPath, root: fixture.installRoot, snapshotRoot: fixture.snapshot.snapshotRoot,
    manifestBackupRoot: fixture.snapshot.manifestBackupRoot, manifestPaths: fixture.manifestPaths,
    expectedFingerprint: fixture.snapshot.originalFingerprint, nonce: fixture.nonce, canonicalRoot: fixture.installRoot,
    installerPid: 99999999, processGroupId: 99999999, ...extra,
  };
}
test("verified completed install rolls back after external verification failure", (t) => {
  const f = recoveryFixture(t);
  const denied = recoverInstallation(recoveryOptions(f));
  assert.equal(denied.state, "unknown");
  assert.equal(denied.reason, "INSTALLER_COMPLETE_RECOVERY_NOT_ALLOWED");
  assert.equal(readInstallerJournal(f.journalPath).stage, "complete");
  assert.equal(JSON.parse(fs.readFileSync(f.versionPath, "utf8")).productVersion, "0.2.2");
  assert.equal(fs.existsSync(f.selfTestCountPath), false, "a refused rollback must not run recovery checks");

  const result = recoverInstallation(recoveryOptions(f, {
    allowVerifiedCompleteRollback: true, reason: "UPDATE_POSTINSTALL_VERIFICATION_FAILED",
  }));
  assert.equal(result.state, "rolled_back", JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(result.selfTestOk, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.versionPath, "utf8")), { productVersion: "0.2.1", buildNumber: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.runtimeConfigPath, "utf8")), { preservedSetting: "baseline" });
  for (const file of Object.values(f.manifestPaths)) assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { path: "baseline" });
  const journal = readInstallerJournal(f.journalPath);
  assert.equal(journal.stage, "rolled_back");
  assert.equal(journal.verified, true);
  assert.equal(journal.recoveryReason, "UPDATE_POSTINSTALL_VERIFICATION_FAILED");
  assert.equal(fs.readFileSync(f.selfTestCountPath, "utf8"), "x");
});
test("already rolled-back journal re-verifies snapshot and self-test without rewriting the installation", (t) => {
  const f = recoveryFixture(t);
  const first = recoverInstallation(recoveryOptions(f, {
    allowVerifiedCompleteRollback: true, reason: "UPDATE_POSTINSTALL_VERIFICATION_FAILED",
  }));
  assert.equal(first.state, "rolled_back", JSON.stringify(first));
  const rootFingerprint = treeFingerprint(f.installRoot);
  const chromeBytes = fs.readFileSync(f.manifestPaths.chrome);
  const edgeBytes = fs.readFileSync(f.manifestPaths.edge);
  const journalBytes = fs.readFileSync(f.journalPath);

  const repeated = recoverInstallation(recoveryOptions(f));
  assert.equal(repeated.state, "rolled_back", JSON.stringify(repeated));
  assert.equal(repeated.verified, true);
  assert.equal(repeated.fingerprint, first.fingerprint);
  assert.equal(repeated.selfTestOk, true);
  assert.equal(treeFingerprint(f.installRoot), rootFingerprint);
  assert.deepEqual(fs.readFileSync(f.manifestPaths.chrome), chromeBytes);
  assert.deepEqual(fs.readFileSync(f.manifestPaths.edge), edgeBytes);
  assert.deepEqual(fs.readFileSync(f.journalPath), journalBytes, "idempotent proof must not rewrite the journal");
  assert.equal(fs.readFileSync(f.selfTestCountPath, "utf8"), "xx", "the repeated proof reruns the native self-test");
});

test("a lost lock holder blocks the next installer write", { skip: !PYTHON_OK }, async (t) => {
  const { updatesRoot, installRoot, lockPath } = fixture(t);
  const nonce = crypto.randomUUID();
  const statusPath = path.join(updatesRoot, `.installer-lock-${nonce}.status`);
  const releasePath = path.join(updatesRoot, `.installer-lock-${nonce}.release`);
  const holder = spawn(process.execPath, [HELPER, "hold-lock", lockPath, PYTHON,
    String(process.pid), String(processGroupId(process.pid)), nonce, statusPath, releasePath], { stdio: "ignore" });
  t.after(() => { try { holder.kill("SIGKILL"); } catch {} });
  assert.equal(await until(() => fs.existsSync(statusPath)), true, "lock holder did not publish its status");
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  process.kill(status.holderPid, "SIGKILL");
  await until(() => { try { process.kill(status.holderPid, 0); return false; } catch { return true; } });
  const target = path.join(installRoot, "must-not-write.txt");
  assert.throws(() => {
    assertManualLockHeldSync({ lockPath, statusPath, nonce, holderPid: status.holderPid, pythonBin: PYTHON });
    fs.writeFileSync(target, "unsafe");
  }, { message: "INSTALLER_LOCK_LOST" });
  assert.equal(fs.existsSync(target), false);
});

test("manual rollback permits only the known lock-helper descendants", { skip: !PYTHON_OK }, async (t) => {
  const { root, home, updatesRoot, installRoot, lockPath } = fixture(t);
  fs.rmSync(installRoot, { recursive: true, force: true });
  const nonce = crypto.randomUUID();
  const journalPath = path.join(updatesRoot, nonce, "installer-transaction.json");
  const statusPath = path.join(updatesRoot, `.installer-lock-${nonce}.status`);
  const releasePath = path.join(updatesRoot, `.installer-lock-${nonce}.release`);
  const ownerScript = path.join(root, "rollback owner.js");
  fs.writeFileSync(ownerScript, `
    const fs = require("node:fs");
    const path = require("node:path");
    const { spawn, execFileSync } = require("node:child_process");
    const [helper, python, home, root, updatesRoot, nonce, journalPath, lockPath, statusPath, releasePath] = process.argv.slice(2);
    const holder = spawn(process.execPath, [helper, "hold-lock", lockPath, python,
      String(process.pid), String(process.pid), nonce, statusPath, releasePath], { stdio: "ignore" });
    holder.unref();
    const deadline = Date.now() + 10000;
    const wait = () => {
      if (!fs.existsSync(statusPath)) {
        if (Date.now() > deadline) process.exit(8);
        return setTimeout(wait, 20);
      }
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      const chrome = path.join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts/host.json");
      const edge = path.join(home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts/host.json");
      const args = [helper, "begin", root, journalPath, nonce, "manual", "", python, chrome, edge,
        root + ".staging-" + nonce, root + ".previous-" + nonce,
        String(process.pid), String(process.pid), lockPath, statusPath, String(status.holderPid)];
      const env = { ...process.env, HOME: home };
      execFileSync(process.execPath, args, { env, stdio: ["ignore", "ignore", "pipe"] });
      execFileSync(process.execPath, [helper, "snapshot", journalPath], { env, stdio: "ignore" });
      const result = execFileSync(process.execPath, [helper, "recover", journalPath], {
        env: { ...env, APPRAISAL_INSTALLER_TRAP_RECOVERY: "1" }, encoding: "utf8",
      });
      process.stdout.write(result);
    };
    wait();
  `);
  const env = { ...process.env, HOME: home };
  if (process.env.APPRAISAL_TEST_FRAMEWORK_PATH) env.APPRAISAL_TEST_FRAMEWORK_PATH = process.env.APPRAISAL_TEST_FRAMEWORK_PATH;
  const owner = spawn(process.execPath, [ownerScript, HELPER, PYTHON, home, installRoot, updatesRoot, nonce, journalPath, lockPath, statusPath, releasePath], {
    detached: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  let stdout = "", stderr = "";
  owner.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  owner.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  t.after(() => { try { process.kill(-owner.pid, "SIGKILL"); } catch {} });
  const code = await new Promise((resolve) => owner.once("close", resolve));
  assert.equal(code, 0, stderr || stdout);
  const result = JSON.parse(stdout);
  assert.equal(result.state, "rolled_back", JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(result.selfTestSkipped, "NO_PRIOR_INSTALLATION");
  assert.equal(readInstallerJournal(journalPath).stage, "rolled_back");
});

test("SIGKILL interruption keeps the lock through a surviving writer, then blocks re-entry on its journal", { skip: !PYTHON_OK }, async (t) => {
  const { root, updatesRoot, installRoot, lockPath } = fixture(t);
  const { nonce, file: journalPath } = unresolvedJournal(updatesRoot, installRoot);
  const statusPath = path.join(updatesRoot, `.installer-lock-${nonce}.status`);
  const releasePath = path.join(updatesRoot, `.installer-lock-${nonce}.release`);
  const startedPath = path.join(root, "writer-started");
  const completedPath = path.join(root, "writer-completed");
  const target = path.join(installRoot, "interrupted-write.log");
  const ownerSource = [
    "const fs=require('node:fs');",
    "const {spawn}=require('node:child_process');",
    "const [helper,lock,python,nonce,status,release,started,completed,target]=process.argv.slice(1);",
    "const holder=spawn(process.execPath,[helper,'hold-lock',lock,python,String(process.pid),String(process.pid),nonce,status,release],{stdio:'ignore'});",
    "const deadline=Date.now()+10000;",
    "const wait=()=>{if(fs.existsSync(status)){const writer=spawn(process.execPath,['-e',\"const fs=require('node:fs');const [started,completed,target]=process.argv.slice(1);fs.writeFileSync(started,'started');setTimeout(()=>{fs.appendFileSync(target,'surviving-writer\\\\n');fs.writeFileSync(completed,'done');},900);\",started,completed,target],{stdio:'ignore'});process.stdout.write('READY\\n');setInterval(()=>{},1000);return;}if(Date.now()>deadline)process.exit(8);setTimeout(wait,20);};",
    "wait();",
  ].join("\n");
  const owner = spawn(process.execPath, ["-e", ownerSource, HELPER, lockPath, PYTHON, nonce, statusPath, releasePath, startedPath, completedPath, target], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  owner.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  t.after(() => {
    try { process.kill(-owner.pid, "SIGKILL"); } catch {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  });
  assert.equal(await until(() => stdout.includes("READY\n") && fs.existsSync(startedPath)), true, "interrupted installer fixture did not start its writer");
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  owner.kill("SIGKILL");
  await new Promise((resolve) => owner.once("close", resolve));
  await sleep(150);
  assert.equal(fs.existsSync(completedPath), false, "writer should still be active after the installer is killed");
  assert.throws(() => scanUnresolvedInstallers(updatesRoot, installRoot), { message: "INSTALLER_RECOVERY_REQUIRED" });
  assert.equal(assertFileLockBusyForTest(lockPath), true, "surviving writer must keep the transaction lock");
  assert.equal(await until(() => fs.existsSync(completedPath)), true, "surviving writer did not finish");
  assert.equal(await until(() => !fs.existsSync(statusPath)), true, "orphaned lock helper did not release after the process group drained");
  assert.throws(() => assertFileLockBusyForTest(lockPath), { message: "INSTALLER_LOCK_LOST" });
  assert.throws(() => {
    scanUnresolvedInstallers(updatesRoot, installRoot);
    fs.writeFileSync(path.join(installRoot, "second-installer-write.log"), "must not happen");
  }, { message: "INSTALLER_RECOVERY_REQUIRED" });
  assert.equal(fs.readFileSync(target, "utf8"), "surviving-writer\n");
  assert.equal(fs.existsSync(path.join(installRoot, "second-installer-write.log")), false);
  assert.equal(readInstallerJournal(journalPath).stage, "starting");
  assert.equal(fs.existsSync(installRoot + ".restore-" + nonce), false, "interruption must not be reported as automatic recovery");
});

function assertFileLockBusyForTest(lockPath) {
  const script = "import fcntl,os,sys; fd=os.open(sys.argv[1],os.O_RDONLY); fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)";
  try {
    execFileSync(PYTHON, ["-c", script, lockPath], { stdio: "ignore", timeout: 3000 });
    throw new Error("INSTALLER_LOCK_LOST");
  } catch (error) {
    if (error.message === "INSTALLER_LOCK_LOST") throw error;
    return true;
  }
}
test('delegated installer accepts its worker staging artifacts but never overwrites an installer journal', async t => {
  const f=fixture(t), nonce=crypto.randomUUID();
  const {MacUpdateTransactionStore}=require('./macos_update_transaction.js');
  const store=new MacUpdateTransactionStore({homeDir:f.home,installRoot:f.installRoot,updatesRoot:f.updatesRoot,pythonBin:PYTHON,
    lockEnvironment:process.env.DYLD_FRAMEWORK_PATH?{DYLD_FRAMEWORK_PATH:process.env.DYLD_FRAMEWORK_PATH}:{}});
  const lock=await store.acquire();
  try {
    store.write(nonce,{state:'starting',phase:'installing',verified:false},{create:true});
    const directory=path.join(f.updatesRoot,nonce), journalPath=path.join(directory,'installer-transaction.json');
    fs.mkdirSync(path.join(directory,'extracted'),{recursive:true});
    fs.writeFileSync(path.join(directory,'update.zip'),'synthetic archive');
    fs.writeFileSync(path.join(directory,'installer.log'),'synthetic log');
    const env={...process.env,HOME:f.home,APPRAISAL_UPDATE_MODE:'worker',APPRAISAL_UPDATE_NONCE:nonce,
      APPRAISAL_UPDATE_WORKER_JOURNAL:store.journalPath,APPRAISAL_UPDATE_INSTALLER_JOURNAL:journalPath,APPRAISAL_UPDATE_LOCK_PYTHON:PYTHON};
    const args=[HELPER,'begin',f.installRoot,journalPath,nonce,'worker',store.journalPath,PYTHON,
      path.join(f.home,'chrome.json'),path.join(f.home,'edge.json'),f.installRoot+'.staging-'+nonce,f.installRoot+'.previous-'+nonce,
      String(process.pid),String(process.pid),f.lockPath,'',''];
    execFileSync(process.execPath,args,{env,stdio:'ignore'});
    const original=fs.readFileSync(journalPath);
    assert.equal(readInstallerJournal(journalPath).stage,'starting');
    assert.throws(()=>execFileSync(process.execPath,args,{env,stdio:'ignore'}));
    assert.deepEqual(fs.readFileSync(journalPath),original);
  } finally {await lock.release();}
});
test('installer ERR trap is inherited by guarded mutation functions on system Bash', t => {
  const f=fixture(t), source=fs.readFileSync(path.join(__dirname,'../macos/installer/install.sh'),'utf8');
  const options=source.match(/^set ([-A-Za-z ]+)$/m)[1], marker=path.join(f.root,'rollback-trap-ran');
  const script=`set ${options}\nMARKER="$1"\ntrap 'printf recovered > "$MARKER"; exit 7' ERR\nguarded_mutation() { "$@"; }\nguarded_mutation /usr/bin/false\n`;
  assert.throws(()=>execFileSync('/bin/bash',['-c',script,'installer trap fixture',marker],{stdio:'ignore'}),error=>error.status===7);
  assert.equal(fs.readFileSync(marker,'utf8'),'recovered');
});
test('snapshot retains relative symlink bytes and proves equality with the live baseline', t => {
  const f=fixture(t), nonce=crypto.randomUUID();
  fs.writeFileSync(path.join(f.installRoot,'data.txt'),'original bytes');
  fs.symlinkSync('data.txt',path.join(f.installRoot,'relative-link'));
  const helper=require('./macos_installer_transaction.js');
  const snapshotRoot=path.join(f.root,'snapshot'), manifestBackupRoot=path.join(f.root,'manifests');
  const manifestPaths={chrome:path.join(f.home,'chrome.json'),edge:path.join(f.home,'edge.json')};
  const saved=helper.snapshotInstallation({root:f.installRoot,snapshotRoot,manifestBackupRoot,manifestPaths,nonce,canonicalRoot:f.installRoot});
  assert.equal(fs.readlinkSync(path.join(snapshotRoot,'relative-link')),'data.txt');
  assert.equal(helper.verifySnapshot({root:f.installRoot,snapshotRoot,manifestBackupRoot,manifestPaths,nonce,canonicalRoot:f.installRoot,expectedFingerprint:saved.originalFingerprint}).ok,true);
});
