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
TASK_QUARANTINE_FIXTURE='0081;67000000;AppraisalToolboxIsolatedTest;00000000-0000-0000-0000-000000000000'
TASK_PYTHON_EXTENSION_COUNT=0
while IFS= read -r -d '' TASK_PYTHON_EXTENSION; do
  TASK_PYTHON_EXTENSION_COUNT=$((TASK_PYTHON_EXTENSION_COUNT + 1))
  /usr/bin/xattr -w com.apple.quarantine "$TASK_QUARANTINE_FIXTURE" "$TASK_PYTHON_EXTENSION"
  /usr/bin/xattr -p com.apple.quarantine "$TASK_PYTHON_EXTENSION" >/dev/null || {
    echo "Quarantine fixture was not applied: $TASK_PYTHON_EXTENSION" >&2
    exit 1
  }
done < <(/usr/bin/find "$APPRAISAL_TOOLBOX_ROOT/python" -type f -name '*.so' -print0)
[[ "$TASK_PYTHON_EXTENSION_COUNT" -gt 0 ]] || { echo 'No Python native-extension fixtures found' >&2; exit 1; }
TASK_OLD_NODE="$APPRAISAL_TOOLBOX_ROOT/runtime/node/bin/node"
[[ -x "$TASK_OLD_NODE" ]] || { echo 'Installed Node fixture not found' >&2; exit 1; }
/usr/bin/xattr -w com.apple.quarantine "$TASK_QUARANTINE_FIXTURE" "$TASK_OLD_NODE"
/usr/bin/xattr -p com.apple.quarantine "$TASK_OLD_NODE" >/dev/null || { echo 'Node quarantine fixture was not applied' >&2; exit 1; }
mkdir -p "$APPRAISAL_TOOLBOX_ROOT/history" "$APPRAISAL_TOOLBOX_ROOT/cache" "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks"
printf 'synthetic-history' > "$APPRAISAL_TOOLBOX_ROOT/history/preserve.txt"
printf 'synthetic-cache' > "$APPRAISAL_TOOLBOX_ROOT/cache/preserve.txt"
printf 'synthetic-workbook' > "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks/preserve.txt"
printf '{"amap":{"enabled":false}}\n' > "$APPRAISAL_TOOLBOX_ROOT/map-config.json"
/usr/bin/xattr -w com.apple.quarantine "$TASK_QUARANTINE_FIXTURE" "$APPRAISAL_TOOLBOX_ROOT/runtime"
/usr/bin/xattr -w com.apple.quarantine "$TASK_QUARANTINE_FIXTURE" "$APPRAISAL_TOOLBOX_ROOT/map-config.json"
TASK_EXTERNAL_TARGET="$TASK_TEST_ROOT/preserved-external-target"
printf 'synthetic-external' > "$TASK_EXTERNAL_TARGET"
/usr/bin/xattr -w com.apple.quarantine "$TASK_QUARANTINE_FIXTURE" "$TASK_EXTERNAL_TARGET"
ln -s "$TASK_EXTERNAL_TARGET" "$APPRAISAL_TOOLBOX_ROOT/runtime/installer-test-external-link"
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
TASK_PYTHON_EXTENSION_AFTER_COUNT=0
while IFS= read -r -d '' TASK_PYTHON_EXTENSION_AFTER; do
  TASK_PYTHON_EXTENSION_AFTER_COUNT=$((TASK_PYTHON_EXTENSION_AFTER_COUNT + 1))
  if /usr/bin/xattr -p com.apple.quarantine "$TASK_PYTHON_EXTENSION_AFTER" >/dev/null 2>&1; then
    echo "Upgrade retained quarantine on a Python native extension: $TASK_PYTHON_EXTENSION_AFTER" >&2
    exit 1
  fi
done < <(/usr/bin/find "$APPRAISAL_TOOLBOX_ROOT/python" -type f -name '*.so' -print0)
[[ "$TASK_PYTHON_EXTENSION_AFTER_COUNT" -eq "$TASK_PYTHON_EXTENSION_COUNT" ]] || {
  echo 'Upgrade changed the Python native-extension inventory' >&2
  exit 1
}
for TASK_PRODUCT_COMPONENT in extension native-helper skills runtime python; do
  if /usr/bin/xattr -lr "$APPRAISAL_TOOLBOX_ROOT/$TASK_PRODUCT_COMPONENT" 2>/dev/null | /usr/bin/grep -q 'com.apple.quarantine:'; then
    echo "Upgrade retained quarantine in managed component: $TASK_PRODUCT_COMPONENT" >&2
    exit 1
  fi
done
/usr/bin/xattr -p com.apple.quarantine "$APPRAISAL_TOOLBOX_ROOT/map-config.json" >/dev/null || {
  echo 'Upgrade changed user configuration metadata outside managed components' >&2
  exit 1
}
[[ -L "$APPRAISAL_TOOLBOX_ROOT/runtime/installer-test-external-link" ]] || {
  echo 'Upgrade changed a symbolic link inside the managed runtime directory' >&2
  exit 1
}
/usr/bin/xattr -p com.apple.quarantine "$TASK_EXTERNAL_TARGET" >/dev/null || {
  echo 'Quarantine cleanup followed a symbolic link outside the install tree' >&2
  exit 1
}
TASK_NODE_AFTER="$APPRAISAL_TOOLBOX_ROOT/runtime/node/bin/node"
/usr/bin/codesign --verify "$TASK_NODE_AFTER" >/dev/null 2>&1 || { echo 'Updated Node signature is invalid' >&2; exit 1; }
"$APPRAISAL_TOOLBOX_ROOT/python/bin/python3" -c 'import charset_normalizer, docx, lxml, openpyxl, requests; from lxml import etree; assert etree.LXML_VERSION'
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
/usr/bin/grep -q '安装前文件、配置、浏览器清单和 Native 自检均已核验恢复' "$TASK_TEST_ROOT/rollback-install.log" || {
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
  freshIsolatedInstall:true,syntheticDataUpgrade:true,oldLxmlQuarantineRebuilt:true,
  updatedLxmlQuarantineAbsent:true,updatedLxmlImportOk:true,oldPythonNativeQuarantineRebuilt:true,
  updatedPythonNativeQuarantineAbsent:true,updatedPythonDependencyImportsOk:true,
  oldNodeQuarantineRebuilt:true,updatedNodeQuarantineAbsent:true,updatedNodeCodeSignatureValid:true,
  edgeWriteFailureRollback:true,
  chromeAndEdgeManifestReadback:true,nativeJsonSelfTest:true,argumentForwardingCovered:true,
  systemFrameworkInstallCovered:false,ordinaryDesktopInstallerCovered:false,
  browserNativeConnectionCovered:false,browserGuiCovered:false,
},null,2)+'\n');
NODE
echo "Isolated installer, upgrade, rollback, Python lock suites, and Native JSON self-test passed."
