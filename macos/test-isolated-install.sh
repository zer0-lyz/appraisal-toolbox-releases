#!/bin/bash
# Exercise the real installer only in disposable HOME and browser directories.
set -euo pipefail
PACKAGE_ROOT="$(cd "$1" && pwd -P)"
TASK_TEST_ROOT="$2"
[[ ! -e "$TASK_TEST_ROOT" ]] || { echo 'Use a new isolated test directory' >&2; exit 1; }
TASK_SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
mkdir -p "$TASK_TEST_ROOT/frameworks/Python.framework" "$TASK_TEST_ROOT/home"
export HOME="$TASK_TEST_ROOT/home"
export APPRAISAL_BROWSER_HOME="$HOME"
export APPRAISAL_TOOLBOX_ROOT="$HOME/.appraisal-toolbox"
export APPRAISAL_INSTALL_NO_OPEN=1
/usr/sbin/pkgutil --expand-full "$PACKAGE_ROOT/runtime/python-3.14.6-macos11.pkg" "$TASK_TEST_ROOT/python-pkg"
/usr/bin/ditto "$TASK_TEST_ROOT/python-pkg/Python_Framework.pkg/Payload" "$TASK_TEST_ROOT/frameworks/Python.framework"
export APPRAISAL_TEST_FRAMEWORK_PATH="$TASK_TEST_ROOT/frameworks"
export DYLD_FRAMEWORK_PATH="$APPRAISAL_TEST_FRAMEWORK_PATH"
export APPRAISAL_PYTHON_BOOTSTRAP="$TASK_TEST_ROOT/frameworks/Python.framework/Versions/3.14/bin/python3.14"
export APPRAISAL_TEST_LOCK_PYTHON="$APPRAISAL_PYTHON_BOOTSTRAP"
for task_key in $(env | /usr/bin/sed -n 's/^\(TIANYUAN_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$task_key"; done
unset PYTHON_BIN PYTHONHOME PYTHONPATH
"$APPRAISAL_PYTHON_BOOTSTRAP" --version
node --test --test-reporter=tap "$TASK_SOURCE_ROOT"/native-helper/*macos*.test.cjs > "$TASK_TEST_ROOT/macos-unit-tests.log" 2>&1 || {
  /usr/bin/tail -30 "$TASK_TEST_ROOT/macos-unit-tests.log" >&2
  exit 1
}
/usr/bin/grep -q '^# skipped 0$' "$TASK_TEST_ROOT/macos-unit-tests.log" || { echo "Skipped runtime tests are not acceptance" >&2; exit 1; }
/bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/fresh-install.log" 2>&1
mkdir -p "$APPRAISAL_TOOLBOX_ROOT/history" "$APPRAISAL_TOOLBOX_ROOT/cache" "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks"
printf 'synthetic-history' > "$APPRAISAL_TOOLBOX_ROOT/history/preserve.txt"
printf 'synthetic-cache' > "$APPRAISAL_TOOLBOX_ROOT/cache/preserve.txt"
printf 'synthetic-workbook' > "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks/preserve.txt"
printf '{"amap":{"enabled":false}}\n' > "$APPRAISAL_TOOLBOX_ROOT/map-config.json"
"$PACKAGE_ROOT/runtime/node/bin/node" - "$APPRAISAL_TOOLBOX_ROOT/native-helper/runtime-config.json" <<'NODE'
const fs=require('node:fs');
const file=process.argv[2];
const config=JSON.parse(fs.readFileSync(file,'utf8'));
config.syntheticUserSetting={preserve:true,label:'中文与空格'};
config.pythonBin='/stale/managed/python';
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
NODE
/bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/upgrade-install.log" 2>&1
"$PACKAGE_ROOT/runtime/node/bin/node" - "$APPRAISAL_TOOLBOX_ROOT/native-helper/runtime-config.json" "$APPRAISAL_TOOLBOX_ROOT" <<'NODE'
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.deepEqual(config.syntheticUserSetting,{preserve:true,label:'中文与空格'});
assert.equal(config.pythonBin,path.join(process.argv[3],'python/bin/python3'));
NODE
for task_file in history/preserve.txt cache/preserve.txt projects/fixture/workbooks/preserve.txt map-config.json; do
  [[ -f "$APPRAISAL_TOOLBOX_ROOT/$task_file" ]] || { echo "Upgrade lost $task_file" >&2; exit 1; }
done
"$PACKAGE_ROOT/runtime/node/bin/node" "$TASK_SOURCE_ROOT/scripts/release/test-macos-update-e2e.cjs" \
  "$PACKAGE_ROOT" "$APPRAISAL_TOOLBOX_ROOT" "$TASK_TEST_ROOT" "$TASK_SOURCE_ROOT" \
  > "$TASK_TEST_ROOT/one-click-update.json"
TASK_EDGE_ROOT="$APPRAISAL_BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
mv "$TASK_EDGE_ROOT" "$TASK_TEST_ROOT/edge-before"
mkdir -p "$TASK_EDGE_ROOT"
chmod 500 "$TASK_EDGE_ROOT"
if /bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/rollback-install.log" 2>&1; then
  echo 'Expected the Edge registration failure to reject installation' >&2
  exit 1
fi
chmod 700 "$TASK_EDGE_ROOT"
rg -q '安装前文件、配置、浏览器清单和 Native 自检均已核验恢复' "$TASK_TEST_ROOT/rollback-install.log" || {
  echo 'Rollback did not prove restoration and Native self-test' >&2
  /usr/bin/tail -20 "$TASK_TEST_ROOT/rollback-install.log" >&2
  exit 1
}
[[ "$(cat "$APPRAISAL_TOOLBOX_ROOT/history/preserve.txt")" == 'synthetic-history' ]] || exit 1
rm -rf "$TASK_EDGE_ROOT"
mv "$TASK_TEST_ROOT/edge-before" "$TASK_EDGE_ROOT"
node "$TASK_SOURCE_ROOT/scripts/release/verify-package.cjs" "$APPRAISAL_TOOLBOX_ROOT" "$TASK_TEST_ROOT/protocol"
node - "$TASK_TEST_ROOT/installer-summary.json" "$APPRAISAL_TEST_LOCK_PYTHON" <<'NODE'
const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({
  ok:true,evidenceType:'actual-installer-in-disposable-home-and-browser-directories',
  python:'3.14.6 extracted from official package',pythonRealpath:fs.realpathSync(process.argv[3]),
  freshIsolatedInstall:true,syntheticDataUpgrade:true,edgeWriteFailureRollback:true,
  chromeAndEdgeManifestReadback:true,nativeJsonSelfTest:true,argumentForwardingCovered:true,
  systemFrameworkInstallCovered:false,ordinaryDesktopInstallerCovered:false,
  browserNativeConnectionCovered:false,browserGuiCovered:false,
},null,2)+'\n');
NODE
echo "Isolated installer, upgrade, rollback, Python lock suites, and Native JSON self-test passed."
