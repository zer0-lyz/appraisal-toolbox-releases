#!/bin/bash
set -Eeuo pipefail
INSTALLER_BUILD="macos-transactional.2"
if [[ -n "${APPRAISAL_TEST_FRAMEWORK_PATH:-}" ]]; then
  [[ -n "${APPRAISAL_BROWSER_HOME:-}" && -n "${APPRAISAL_PYTHON_BOOTSTRAP:-}" && -n "${APPRAISAL_TOOLBOX_ROOT:-}" ]] || { echo "隔离测试环境不完整" >&2; exit 1; }
  export DYLD_FRAMEWORK_PATH="$APPRAISAL_TEST_FRAMEWORK_PATH"
fi
PACKAGE_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
INSTALL_ROOT="${APPRAISAL_TOOLBOX_ROOT:-$HOME/.appraisal-toolbox}"
ROOT_PARENT="$(cd "$(dirname "$INSTALL_ROOT")" && pwd -P)"
INSTALL_ROOT="$ROOT_PARENT/$(basename "$INSTALL_ROOT")"
BROWSER_HOME="${APPRAISAL_BROWSER_HOME:-$HOME}"
NODE_BIN="$PACKAGE_ROOT/runtime/node/bin/node"
TRANSACTION_HELPER="$PACKAGE_ROOT/native-helper/macos_installer_transaction.js"
PYTHON_PKG="$PACKAGE_ROOT/runtime/python-3.14.6-macos11.pkg"
PYTHON_BOOTSTRAP="${APPRAISAL_PYTHON_BOOTSTRAP:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
HOST_NAME="com.appraisal.toolbox.helper"
EXTENSION_ID="aamfmhcbjgofhmannejoiilkkpchfkgm"
CHROME_MANIFEST="$BROWSER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
EDGE_MANIFEST="$BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"
MODE="${APPRAISAL_UPDATE_MODE:-manual}"
MANUAL_LOCK=0
JOURNAL_STARTED=0
TRANSACTION_TERMINAL=0
LOCK_PID=""
LOCK_PATH=""
LOCK_STATUS_PATH=""
LOCK_RELEASE_PATH=""

cleanup() {
  if [[ "$JOURNAL_STARTED" == "1" ]]; then
    if "$NODE_BIN" "$TRANSACTION_HELPER" read "$JOURNAL_PATH" 2>/dev/null | "$NODE_BIN" -e \
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(["complete","rolled_back","failed_safe"].includes(j.stage)&&j.verified===true?0:1)}catch{process.exit(1)}})'; then
      TRANSACTION_TERMINAL=1
    fi
  fi
  if [[ "$TRANSACTION_TERMINAL" == "1" && -n "${STAGING_ROOT:-}" ]] && assert_installer_lock >/dev/null 2>&1; then rm -rf "$STAGING_ROOT"; fi
  if [[ "$MANUAL_LOCK" == "1" ]]; then
    "$NODE_BIN" "$TRANSACTION_HELPER" release-lock "$LOCK_RELEASE_PATH" "$NONCE" >/dev/null 2>&1 || true
    wait "$LOCK_PID" 2>/dev/null || true
    MANUAL_LOCK=0
  fi
}
on_error() {
  local code="$1" result="" rollback_code=1
  trap - ERR INT TERM HUP
  set +e
  if [[ "$JOURNAL_STARTED" == "1" ]]; then
    if ! assert_installer_lock >/dev/null 2>&1; then
      echo "安装失败；事务锁持有人已丢失，已停止后续写入并保留未完成 journal 与恢复材料。" >&2
      exit "$code"
    fi
    RECOVERY_RESULT="$JOURNAL_PATH.recovery-result"
    APPRAISAL_INSTALLER_TRAP_RECOVERY=1 "$NODE_BIN" "$TRANSACTION_HELPER" recover "$JOURNAL_PATH" >"$RECOVERY_RESULT" 2>/dev/null
    rollback_code=$?
    result="$(cat "$RECOVERY_RESULT" 2>/dev/null)"
    if [[ "$rollback_code" == "0" && "$result" == *'"verified":true'* ]] && { [[ "$result" == *'"selfTestOk":true'* ]] || [[ "$result" == *'"selfTestSkipped":"NO_PRIOR_INSTALLATION"'* ]]; }; then
      if [[ "$result" == *'"selfTestSkipped":"NO_PRIOR_INSTALLATION"'* ]]; then
        echo "安装失败；已核验恢复到安装前未安装状态（没有旧 Native 可执行自检）。" >&2
      else
        echo "安装失败；安装前文件、配置、浏览器清单和 Native 自检均已核验恢复。" >&2
      fi
    else
      if assert_installer_lock >/dev/null 2>&1; then
        "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" unknown >/dev/null 2>&1 || true
      fi
      echo "安装失败；恢复结果无法核验，事务现场与快照已保留，不能报告为已恢复。" >&2
    fi
  else
    echo "安装失败；事务尚未启动，未更改安装目录。" >&2
  fi
  exit "$code"
}
on_signal() { on_error "$1"; }
fail() { echo "安装失败：$1" >&2; return 1; }
assert_installer_lock() {
  if [[ "$MODE" == "worker" ]]; then
    "$NODE_BIN" "$TRANSACTION_HELPER" assert-worker-lock \
      "$LOCK_PATH" "$WORKER_JOURNAL" "$NONCE" "$INSTALL_ROOT" "$LOCK_PYTHON" >/dev/null
  else
    "$NODE_BIN" "$TRANSACTION_HELPER" assert-lock \
      "$LOCK_PATH" "$LOCK_STATUS_PATH" "$NONCE" "$LOCK_PID" "$LOCK_PYTHON" >/dev/null
  fi
}
guarded_mutation() {
  assert_installer_lock || { echo "事务锁持有人已丢失，停止安装目录写入。" >&2; return 1; }
  "$@"
}

[[ "$(uname -s)" == "Darwin" ]] || fail "仅支持 macOS。"
[[ "$(uname -m)" == "arm64" ]] || fail "本安装包仅支持 Apple Silicon。"
[[ "$INSTALL_ROOT" != "/" && "$INSTALL_ROOT" != "$HOME" && "$INSTALL_ROOT" != "$PACKAGE_ROOT" ]] || fail "不安全的安装目录。"
[[ ! -L "$INSTALL_ROOT" ]] || fail "安装目录不能是符号链接。"
[[ -f "$PACKAGE_ROOT/BUILD-PROVENANCE.json" && -f "$PACKAGE_ROOT/SHA256SUMS" ]] || fail "缺少构建来源或清单。"
[[ -x "$NODE_BIN" && -f "$TRANSACTION_HELPER" ]] || fail "缺少安装事务组件。"

echo "[1/7] 校验安装包"
(cd "$PACKAGE_ROOT" && /usr/bin/shasum -a 256 -c SHA256SUMS)
echo "[2/7] 准备 Python 3.14"
if [[ ! -x "$PYTHON_BOOTSTRAP" ]] || [[ "$("$PYTHON_BOOTSTRAP" --version 2>/dev/null || true)" != "Python 3.14.6" ]]; then
  [[ -z "${APPRAISAL_PYTHON_BOOTSTRAP:-}" ]] || fail "指定的测试解释器不是锁定的 Python 3.14.6。"
  [[ -f "$PYTHON_PKG" ]] || fail "缺少 Python 安装包。"
  echo "需要输入当前 macOS 用户密码以安装官方 Python 3.14。"
  /usr/bin/sudo /usr/sbin/installer -pkg "$PYTHON_PKG" -target /
fi
PYTHON_BOOTSTRAP="$("$NODE_BIN" -e 'const h=require(process.argv[1]);process.stdout.write(h.pinnedPython(process.argv[2],process.env.APPRAISAL_TEST_FRAMEWORK_PATH))' \
  "$TRANSACTION_HELPER" "$PYTHON_BOOTSTRAP")"
"$PYTHON_BOOTSTRAP" -c 'import ensurepip, venv, fcntl' >/dev/null || fail "Python 3.14 无法创建虚拟环境或 POSIX 锁。"

INSTALLER_PGID="$(/bin/ps -o pgid= -p "$$" | /usr/bin/awk '{print $1}')"
INSTALLER_PGID="${INSTALLER_PGID:-$$}"
if [[ "$MODE" == "worker" ]]; then
  NONCE="${APPRAISAL_UPDATE_NONCE:-}"
  JOURNAL_PATH="${APPRAISAL_UPDATE_INSTALLER_JOURNAL:-}"
  WORKER_JOURNAL="${APPRAISAL_UPDATE_WORKER_JOURNAL:-}"
  LOCK_PYTHON="${APPRAISAL_UPDATE_LOCK_PYTHON:-}"
  [[ -n "$NONCE" && -n "$JOURNAL_PATH" && -n "$WORKER_JOURNAL" && -n "$LOCK_PYTHON" ]] || fail "更新工作进程缺少绑定信息。"
  UPDATES_ROOT="$(cd "$(dirname "$WORKER_JOURNAL")" && pwd -P)"
  LOCK_PATH="$UPDATES_ROOT/transaction.lock"
  LOCK_STATUS_PATH=""
  LOCK_RELEASE_PATH=""
else
  [[ "$MODE" == "manual" ]] || fail "不支持的安装事务模式。"
  NONCE="$("$NODE_BIN" -p 'require("node:crypto").randomUUID()')"
  WORKER_JOURNAL=""
  LOCK_PYTHON="$PYTHON_BOOTSTRAP"
  UPDATES_ROOT="$HOME/.appraisal-toolbox-updates"
  mkdir -p "$UPDATES_ROOT"
  chmod 700 "$UPDATES_ROOT"
  LOCK_PATH="$UPDATES_ROOT/transaction.lock"
  JOURNAL_PATH="$UPDATES_ROOT/$NONCE/installer-transaction.json"
  LOCK_STATUS_PATH="$UPDATES_ROOT/.installer-lock-$NONCE.status"
  LOCK_RELEASE_PATH="$UPDATES_ROOT/.installer-lock-$NONCE.release"
  trap cleanup EXIT
  MANUAL_LOCK=1
  "$NODE_BIN" "$TRANSACTION_HELPER" hold-lock "$LOCK_PATH" "$LOCK_PYTHON" \
    "$$" "$INSTALLER_PGID" "$NONCE" "$LOCK_STATUS_PATH" "$LOCK_RELEASE_PATH" \
    >/dev/null 2>&1 &
  LOCK_PID=$!
  LOCK_READY=0
  lock_wait=0
  while [[ "$lock_wait" -lt 240 ]]; do
    if [[ -f "$LOCK_STATUS_PATH" ]] && "$NODE_BIN" "$TRANSACTION_HELPER" assert-lock \
      "$LOCK_PATH" "$LOCK_STATUS_PATH" "$NONCE" "$LOCK_PID" "$LOCK_PYTHON" >/dev/null 2>&1; then
      LOCK_READY=1
      break
    fi
    if ! kill -0 "$LOCK_PID" 2>/dev/null; then break; fi
    /bin/sleep 0.05
    lock_wait=$((lock_wait + 1))
  done
  [[ "$LOCK_READY" == "1" ]] || fail "无法取得或核验更新事务锁。"
fi
STAGING_ROOT="$INSTALL_ROOT.staging-$NONCE"
BACKUP_ROOT="$INSTALL_ROOT.previous-$NONCE"
trap cleanup EXIT
trap 'on_error $?' ERR
trap 'on_signal 130' INT
trap 'on_signal 143' TERM HUP
assert_installer_lock || fail "更新事务锁已丢失。"
"$NODE_BIN" "$TRANSACTION_HELPER" begin "$INSTALL_ROOT" "$JOURNAL_PATH" "$NONCE" "$MODE" "$WORKER_JOURNAL" "$LOCK_PYTHON" \
  "$CHROME_MANIFEST" "$EDGE_MANIFEST" "$STAGING_ROOT" "$BACKUP_ROOT" "$$" "$INSTALLER_PGID" \
  "$LOCK_PATH" "$LOCK_STATUS_PATH" "$LOCK_PID" >/dev/null
JOURNAL_STARTED=1

echo "[3/7] 建立独立安装目录"
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" snapshot "$JOURNAL_PATH" >/dev/null
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" staging
guarded_mutation mkdir -p "$STAGING_ROOT"
if [[ -d "$INSTALL_ROOT" ]]; then guarded_mutation /usr/bin/ditto "$INSTALL_ROOT" "$STAGING_ROOT"; fi
for component in extension native-helper skills runtime/node; do guarded_mutation rm -rf "$STAGING_ROOT/$component"; done
guarded_mutation /usr/bin/ditto "$PACKAGE_ROOT/extension" "$STAGING_ROOT/extension"
guarded_mutation /usr/bin/ditto "$PACKAGE_ROOT/native-helper" "$STAGING_ROOT/native-helper"
guarded_mutation /usr/bin/ditto "$PACKAGE_ROOT/skills" "$STAGING_ROOT/skills"
guarded_mutation /usr/bin/ditto "$PACKAGE_ROOT/runtime/node" "$STAGING_ROOT/runtime/node"
for metadata in BUILD-PROVENANCE.json release-inputs.lock.json SOURCE-INVENTORY.json VERSION.txt; do
  guarded_mutation cp -p "$PACKAGE_ROOT/$metadata" "$STAGING_ROOT/$metadata"
done
guarded_mutation "$PYTHON_BOOTSTRAP" -m venv "$STAGING_ROOT/python"
guarded_mutation "$STAGING_ROOT/python/bin/python3" -m pip install \
  --disable-pip-version-check --no-index --find-links "$PACKAGE_ROOT/runtime/python-wheels" \
  openpyxl==3.1.5 et_xmlfile==2.0.0 python-docx==1.2.0 typing_extensions==4.16.0 \
  lxml==6.1.0 requests==2.32.5
if [[ -f "$INSTALL_ROOT/native-helper/native_host.log" ]]; then
  guarded_mutation cp -p "$INSTALL_ROOT/native-helper/native_host.log" "$STAGING_ROOT/native-helper/native_host.log"
fi
if [[ -f "$INSTALL_ROOT/native-helper/depreciation-capex-forecast-state.json" ]]; then
  guarded_mutation cp -p "$INSTALL_ROOT/native-helper/depreciation-capex-forecast-state.json" \
    "$STAGING_ROOT/native-helper/depreciation-capex-forecast-state.json"
fi
assert_installer_lock || fail "更新事务锁已丢失。"
"$NODE_BIN" - "$STAGING_ROOT/native-helper/runtime-config.json" "$INSTALL_ROOT" "$EXTENSION_ID" "$HOST_NAME" \
  "$INSTALL_ROOT/native-helper/runtime-config.json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [file, root, extensionId, host, oldFile] = process.argv.slice(2);
let prior = {};
try {
  const value = JSON.parse(fs.readFileSync(oldFile, "utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("RUNTIME_CONFIG_INVALID");
  prior = value;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const config = {
  ...prior,
  pythonBin: path.join(root, "python/bin/python3"),
  printSkillsDir: path.join(root, "skills"),
  depreciationSkillDir: path.join(root, "skills/depreciation-capex-forecast"),
  toolboxExtensionId: extensionId,
  nativeHostName: host,
};
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
NODE
assert_installer_lock || fail "更新事务锁已丢失。"
"$NODE_BIN" - "$STAGING_ROOT/native-helper/native_host_launcher.sh" "$INSTALL_ROOT" <<'NODE'
const fs = require("node:fs");
const [file, root] = process.argv.slice(2);
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
const node = quote(root + "/runtime/node/bin/node");
const host = quote(root + "/native-helper/native_host.js");
const log = quote(root + "/native-helper/native_host.log");
const lines = [
  "#!/bin/bash", "set -euo pipefail",
  "export APPRAISAL_TOOLBOX_ROOT=" + quote(root),
  "export TIANYUAN_NATIVE_RUNTIME_ROOT=" + quote(root + "/native-helper"),
  "export TIANYUAN_RUNTIME_CONFIG_PATH=" + quote(root + "/native-helper/runtime-config.json"),
  "export TIANYUAN_MAP_CONFIG_PATH=" + quote(root + "/map-config.json"),
  "export TIANYUAN_ALIBABA_LEASE_GEOCODE_CACHE_PATH=" + quote(root + "/cache/alibaba-lease-geocode.json"),
  "exec " + node + " " + host + " \"$@\" 2>> " + log,
  "",
];
fs.writeFileSync(file, lines.join("\n"), { mode: 0o755 });
fs.chmodSync(file, 0o755);
NODE
SNAPSHOT_ROOT="$(dirname "$JOURNAL_PATH")/snapshot"
if [[ -f "$SNAPSHOT_ROOT/map-config.json" ]]; then
  cmp -s "$SNAPSHOT_ROOT/map-config.json" "$STAGING_ROOT/map-config.json" || fail "本机地图配置未完整保留。"
fi
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" staging_ready

echo "[4/7] 原子部署"
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" moving_old
if [[ -d "$INSTALL_ROOT" ]]; then guarded_mutation mv "$INSTALL_ROOT" "$BACKUP_ROOT"; fi
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" old_moved
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" deploying
guarded_mutation mv "$STAGING_ROOT" "$INSTALL_ROOT"
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" new_root_deployed

echo "[5/7] 核验新文件、版本与 Native 自检"
"$INSTALL_ROOT/python/bin/python3" -c 'import docx, et_xmlfile, lxml, openpyxl, requests, typing_extensions'
"$INSTALL_ROOT/native-helper/native_host_launcher.sh" --self-test > "$INSTALL_ROOT/native-helper/self-test-result.json"
"$INSTALL_ROOT/runtime/node/bin/node" - "$INSTALL_ROOT" "$PACKAGE_ROOT" <<'NODE'
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [root, pkg] = process.argv.slice(2);
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const excluded = new Set(["native-helper/native_host_launcher.sh", "native-helper/runtime-config.json", "native-helper/native_host.log"]);
for (const line of fs.readFileSync(path.join(pkg, "SHA256SUMS"), "utf8").trim().split("\n")) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error("PACKAGE_HASH_MANIFEST_INVALID");
  const relative = match[2];
  if (!(relative.startsWith("extension/") || relative.startsWith("native-helper/") ||
        relative.startsWith("skills/") || relative.startsWith("runtime/node/") ||
        ["BUILD-PROVENANCE.json", "release-inputs.lock.json", "SOURCE-INVENTORY.json", "VERSION.txt"].includes(relative))) continue;
  if (excluded.has(relative)) continue;
  assert.equal(hash(path.join(root, relative)), match[1], "installed file " + relative);
}
const pkgMeta = JSON.parse(fs.readFileSync(path.join(pkg, "BUILD-PROVENANCE.json"), "utf8"));
const liveMeta = JSON.parse(fs.readFileSync(path.join(root, "BUILD-PROVENANCE.json"), "utf8"));
assert.deepEqual(liveMeta, pkgMeta);
const version = JSON.parse(fs.readFileSync(path.join(root, "extension/version.json"), "utf8"));
assert.equal(version.productVersion, pkgMeta.productVersion);
assert.equal(Number(version.buildNumber), Number(pkgMeta.buildNumber));
const text = fs.readFileSync(path.join(root, "VERSION.txt"), "utf8");
assert(text.includes("version=" + pkgMeta.productVersion + "\n"));
assert(text.includes("buildNumber=" + pkgMeta.buildNumber + "\n"));
const host = JSON.parse(fs.readFileSync(path.join(root, "native-helper/self-test-result.json"), "utf8"));
assert.equal(host.ok, true);
assert.equal(host.pythonSkillImportSmoke.ok, true);
const launcher = fs.readFileSync(path.join(root, "native-helper/native_host_launcher.sh"), "utf8");
assert(launcher.includes('"$@"'));
NODE
guarded_mutation rm -f "$INSTALL_ROOT/native-helper/self-test-result.json"
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" preparing_registration
MANIFEST_PATH="$INSTALL_ROOT/native-helper/$HOST_NAME.json"
assert_installer_lock || fail "更新事务锁已丢失。"
"$INSTALL_ROOT/runtime/node/bin/node" - "$MANIFEST_PATH" "$INSTALL_ROOT/native-helper/native_host_launcher.sh" "$HOST_NAME" "$EXTENSION_ID" <<'NODE'
const fs = require("node:fs");
const [file, launcher, host, extension] = process.argv.slice(2);
fs.writeFileSync(file, JSON.stringify({
  name: host, description: "Appraisal Toolbox Native Helper", path: launcher,
  type: "stdio", allowed_origins: ["chrome-extension://" + extension + "/"],
}, null, 2) + "\n", { mode: 0o600 });
NODE
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" registering_manifests
for browser_root in \
  "$BROWSER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"; do
  guarded_mutation mkdir -p "$browser_root"
  guarded_mutation cp -p "$MANIFEST_PATH" "$browser_root/$HOST_NAME.json"
done
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" manifests_registered
"$NODE_BIN" - "$CHROME_MANIFEST" "$EDGE_MANIFEST" "$INSTALL_ROOT/native-helper/native_host_launcher.sh" "$HOST_NAME" "$EXTENSION_ID" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const [chrome, edge, launcher, host, extension] = process.argv.slice(2);
for (const file of [chrome, edge]) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(manifest.name, host);
  assert.equal(manifest.path, launcher);
  assert.equal(manifest.type, "stdio");
  assert.deepEqual(manifest.allowed_origins, ["chrome-extension://" + extension + "/"]);
}
fs.accessSync(launcher, fs.constants.X_OK);
NODE
"$INSTALL_ROOT/native-helper/native_host_launcher.sh" --self-test | "$INSTALL_ROOT/runtime/node/bin/node" -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.ok!==true||j.pythonSkillImportSmoke?.ok!==true)process.exit(1)}catch{process.exit(1)}})'

echo "[6/7] 核对产品版本与安装报告"
PRODUCT_VERSION="$("$INSTALL_ROOT/runtime/node/bin/node" -p "require(process.argv[1]).productVersion" "$INSTALL_ROOT/BUILD-PROVENANCE.json")"
BUILD_NUMBER="$("$INSTALL_ROOT/runtime/node/bin/node" -p "require(process.argv[1]).buildNumber" "$INSTALL_ROOT/BUILD-PROVENANCE.json")"
SOURCE_COMMIT="$("$INSTALL_ROOT/runtime/node/bin/node" -p "require(process.argv[1]).sourceCommit" "$INSTALL_ROOT/BUILD-PROVENANCE.json")"
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" verifying_success
assert_installer_lock || fail "更新事务锁已丢失。"
cat > "$INSTALL_ROOT/安装检查结果.txt" <<REPORT
安装状态：成功
产品：评估工具箱
版本：$PRODUCT_VERSION
构建号：$BUILD_NUMBER
源码：$SOURCE_COMMIT
安装器：$INSTALLER_BUILD
扩展 ID：$EXTENSION_ID
Native Host：$HOST_NAME
Chrome / Edge Native 清单：通过
Native JSON 自检：通过
Python 依赖：通过
安装时间：$(date '+%Y-%m-%d %H:%M:%S %z')
REPORT
"$INSTALL_ROOT/runtime/node/bin/node" - "$INSTALL_ROOT/安装检查结果.txt" "$PRODUCT_VERSION" "$BUILD_NUMBER" "$SOURCE_COMMIT" "$EXTENSION_ID" "$HOST_NAME" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const [file, version, build, commit, extension, host] = process.argv.slice(2);
const report = fs.readFileSync(file, "utf8");
for (const expected of [
  "安装状态：成功", "版本：" + version, "构建号：" + build, "源码：" + commit,
  "扩展 ID：" + extension, "Native Host：" + host,
  "Chrome / Edge Native 清单：通过", "Native JSON 自检：通过", "Python 依赖：通过",
]) assert(report.includes(expected), "install report missing " + expected);
NODE
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" report_written
guarded_mutation "$NODE_BIN" "$TRANSACTION_HELPER" stage "$JOURNAL_PATH" complete
echo "[7/7] 安装成功，回滚材料保留"
if [[ -d "$BACKUP_ROOT" ]]; then echo "旧运行目录备份：$BACKUP_ROOT"; fi
echo "事务快照和浏览器清单备份：$(dirname "$JOURNAL_PATH")"
if [[ "\${APPRAISAL_INSTALL_NO_OPEN:-0}" != "1" ]]; then
  open "$INSTALL_ROOT/extension" >/dev/null 2>&1 || true
fi
echo
echo "安装完成。Chrome 最后一步：打开 chrome://extensions，加载："
echo "$INSTALL_ROOT/extension"
echo "确认扩展 ID：$EXTENSION_ID"
