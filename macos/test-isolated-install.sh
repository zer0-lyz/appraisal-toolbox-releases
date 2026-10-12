#!/bin/bash
# Real installer operations in disposable directories; no system Python installation or real Profile.
set -euo pipefail
PACKAGE_ROOT="$1"
TASK_TEST_ROOT="$2"
[[ ! -e "$TASK_TEST_ROOT" ]] || { echo 'Use a new isolated test directory' >&2; exit 1; }
mkdir -p "$TASK_TEST_ROOT/frameworks/Python.framework" "$TASK_TEST_ROOT/browser-home"
/usr/sbin/pkgutil --expand-full "$PACKAGE_ROOT/runtime/python-3.14.6-macos11.pkg" "$TASK_TEST_ROOT/python-pkg"
/usr/bin/ditto "$TASK_TEST_ROOT/python-pkg/Python_Framework.pkg/Payload" "$TASK_TEST_ROOT/frameworks/Python.framework"
export APPRAISAL_TEST_FRAMEWORK_PATH="$TASK_TEST_ROOT/frameworks"
export DYLD_FRAMEWORK_PATH="$APPRAISAL_TEST_FRAMEWORK_PATH"
export APPRAISAL_PYTHON_BOOTSTRAP="$TASK_TEST_ROOT/frameworks/Python.framework/Versions/3.14/bin/python3.14"
export APPRAISAL_TOOLBOX_ROOT="$TASK_TEST_ROOT/installed"
export APPRAISAL_BROWSER_HOME="$TASK_TEST_ROOT/browser-home"
export APPRAISAL_INSTALL_NO_OPEN=1
for task_key in $(env | /usr/bin/sed -n 's/^\(TIANYUAN_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$task_key"; done
unset PYTHON_BIN PYTHONHOME PYTHONPATH
"$APPRAISAL_PYTHON_BOOTSTRAP" --version
/bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/fresh-install.log" 2>&1
mkdir -p "$APPRAISAL_TOOLBOX_ROOT/history" "$APPRAISAL_TOOLBOX_ROOT/cache" "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks"
printf 'synthetic-history' > "$APPRAISAL_TOOLBOX_ROOT/history/preserve.txt"
printf 'synthetic-cache' > "$APPRAISAL_TOOLBOX_ROOT/cache/preserve.txt"
printf 'synthetic-workbook' > "$APPRAISAL_TOOLBOX_ROOT/projects/fixture/workbooks/preserve.txt"
# No actual map key: preserve a key-free user configuration sentinel.
printf '{"amap":{"enabled":false}}\n' > "$APPRAISAL_TOOLBOX_ROOT/map-config.json"
/bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/upgrade-install.log" 2>&1
for task_file in history/preserve.txt cache/preserve.txt projects/fixture/workbooks/preserve.txt map-config.json; do
  [[ -f "$APPRAISAL_TOOLBOX_ROOT/$task_file" ]] || { echo "Upgrade lost $task_file" >&2; exit 1; }
done
# Inject a real Edge write failure in the disposable browser-home only.
TASK_EDGE_ROOT="$APPRAISAL_BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
mv "$TASK_EDGE_ROOT" "$TASK_TEST_ROOT/edge-before"
printf 'synthetic write obstruction' > "$TASK_EDGE_ROOT"
if /bin/bash "$PACKAGE_ROOT/安装.command" > "$TASK_TEST_ROOT/rollback-install.log" 2>&1; then
  echo 'Expected the Edge registration failure to reject installation' >&2; exit 1
fi
[[ "$(cat "$APPRAISAL_TOOLBOX_ROOT/history/preserve.txt")" == 'synthetic-history' ]] || exit 1
rm "$TASK_EDGE_ROOT"
mv "$TASK_TEST_ROOT/edge-before" "$TASK_EDGE_ROOT"
TASK_SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$TASK_SOURCE_ROOT/scripts/release/verify-package.cjs" "$APPRAISAL_TOOLBOX_ROOT" "$TASK_TEST_ROOT/protocol"
node - "$TASK_TEST_ROOT/installer-summary.json" <<'NODE'
const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({ok:true,evidenceType:'actual-installer-in-disposable-directories',python:'3.14.6 extracted from hash-locked official pkg',freshIsolatedInstall:true,syntheticDataUpgrade:true,edgeWriteFailureRollback:true,chromeAndEdgeManifestReadback:true,systemFrameworkInstallCovered:false,ordinaryDesktopInstallerCovered:false,browserNativeConnectionCovered:false,browserGuiCovered:false},null,2)+'\n');
NODE
echo 'Isolated installation/upgrade/Edge-write-failure rollback and packaged host protocol passed.'
