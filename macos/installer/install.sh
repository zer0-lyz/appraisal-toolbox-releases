#!/bin/bash
set -euo pipefail
INSTALLER_BUILD="macos-transactional.1"

PACKAGE_ROOT="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="${APPRAISAL_TOOLBOX_ROOT:-$HOME/.appraisal-toolbox}"
BROWSER_HOME="${APPRAISAL_BROWSER_HOME:-$HOME}"
STAGING_ROOT="${INSTALL_ROOT}.staging-$$"
BACKUP_ROOT="${INSTALL_ROOT}.previous-$$"
MANIFEST_BACKUP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/appraisal-toolbox-manifests.XXXXXX")"
PYTHON_PKG="$PACKAGE_ROOT/runtime/python-3.14.6-macos11.pkg"
PYTHON_BOOTSTRAP="${APPRAISAL_PYTHON_BOOTSTRAP:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
HOST_NAME="com.appraisal.toolbox.helper"
EXTENSION_ID="aamfmhcbjgofhmannejoiilkkpchfkgm"

MOVED_EXISTING_ROOT=0
INSTALLED_NEW_ROOT=0
MANIFESTS_SNAPSHOTTED=0
CHROME_MANIFEST="$BROWSER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
EDGE_MANIFEST="$BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"

cleanup() {
  rm -rf "$STAGING_ROOT"
  rm -rf "$MANIFEST_BACKUP_ROOT"
}
trap cleanup EXIT

rollback() {
  set +e
  if [[ "$INSTALLED_NEW_ROOT" == "1" && -d "$INSTALL_ROOT" ]]; then
    rm -rf "$INSTALL_ROOT"
  fi
  if [[ "$MOVED_EXISTING_ROOT" == "1" && -d "$BACKUP_ROOT" ]]; then
    mv "$BACKUP_ROOT" "$INSTALL_ROOT"
  fi
  if [[ "$MANIFESTS_SNAPSHOTTED" != "1" ]]; then
    return
  fi
  for manifest_name in chrome edge; do
    case "$manifest_name" in
      chrome) manifest_path="$CHROME_MANIFEST" ;;
      edge) manifest_path="$EDGE_MANIFEST" ;;
    esac
    backup_path="$MANIFEST_BACKUP_ROOT/$manifest_name.json"
    if [[ -f "$backup_path" ]]; then
      mkdir -p "$(dirname "$manifest_path")"
      cp -p "$backup_path" "$manifest_path"
    else
      rm -f "$manifest_path"
    fi
  done
}

on_error() {
  code="$1"
  trap - ERR
  rollback
  echo "安装失败，已恢复安装前状态。" >&2
  exit "$code"
}
trap 'on_error $?' ERR

fail() {
  echo "安装失败：$1" >&2
  return 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "仅支持 macOS。"
[[ "$(uname -m)" == "arm64" ]] || fail "本安装包仅支持 Apple Silicon。"

[[ "$INSTALL_ROOT" != "/" && "$INSTALL_ROOT" != "$HOME" && "$INSTALL_ROOT" != "$PACKAGE_ROOT" ]] || fail "不安全的安装目录。"
[[ ! -L "$INSTALL_ROOT" ]] || fail "安装目录不能是符号链接。"
[[ -f "$PACKAGE_ROOT/BUILD-PROVENANCE.json" && -f "$PACKAGE_ROOT/SHA256SUMS" ]] || fail "缺少构建来源或清单。"

echo "[1/7] 校验安装包"
if [[ -f "$PACKAGE_ROOT/SHA256SUMS" ]]; then
  (cd "$PACKAGE_ROOT" && /usr/bin/shasum -a 256 -c SHA256SUMS)
fi

echo "[2/7] 准备 Python 3.14"
if [[ ! -x "$PYTHON_BOOTSTRAP" ]] || [[ "$("$PYTHON_BOOTSTRAP" --version 2>/dev/null || true)" != "Python 3.14.6" ]]; then
  [[ -z "${APPRAISAL_PYTHON_BOOTSTRAP:-}" ]] || fail "指定的测试解释器不是锁定的 Python 3.14.6。"
  [[ -f "$PYTHON_PKG" ]] || fail "缺少 Python 安装包。"
  echo "需要输入当前 macOS 用户密码以安装官方 Python 3.14。"
  /usr/bin/sudo /usr/sbin/installer -pkg "$PYTHON_PKG" -target /
fi
[[ "$("$PYTHON_BOOTSTRAP" --version)" == "Python 3.14.6" ]] || fail "Python 版本与输入锁不符。"
"$PYTHON_BOOTSTRAP" -c 'import ensurepip, venv' >/dev/null \
  || fail "Python 3.14 无法创建虚拟环境。"

echo "[3/7] 组装独立运行目录"
rm -rf "$STAGING_ROOT"
mkdir -p "$STAGING_ROOT"
# Preserve local configuration, history, caches and workbooks during an upgrade.
# These bytes are never read by the build or uploaded as evidence.
if [[ -d "$INSTALL_ROOT" ]]; then /usr/bin/ditto "$INSTALL_ROOT" "$STAGING_ROOT"; fi
for component in extension native-helper skills runtime/node; do
  rm -rf "$STAGING_ROOT/$component"
done
/usr/bin/ditto "$PACKAGE_ROOT/extension" "$STAGING_ROOT/extension"
/usr/bin/ditto "$PACKAGE_ROOT/native-helper" "$STAGING_ROOT/native-helper"
/usr/bin/ditto "$PACKAGE_ROOT/skills" "$STAGING_ROOT/skills"
/usr/bin/ditto "$PACKAGE_ROOT/runtime/node" "$STAGING_ROOT/runtime/node"
"$PYTHON_BOOTSTRAP" -m venv "$STAGING_ROOT/python"
"$STAGING_ROOT/python/bin/python3" -m pip install \
  --disable-pip-version-check \
  --no-index \
  --find-links "$PACKAGE_ROOT/runtime/python-wheels" \
  openpyxl==3.1.5 \
  et_xmlfile==2.0.0 \
  python-docx==1.2.0 \
  typing_extensions==4.16.0 \
  lxml==6.1.0 \
  requests==2.32.5

if [[ -f "$INSTALL_ROOT/map-config.json" ]]; then
  cp -p "$INSTALL_ROOT/map-config.json" "$STAGING_ROOT/map-config.json"
fi
if [[ -f "$INSTALL_ROOT/native-helper/native_host.log" ]]; then
  cp -p "$INSTALL_ROOT/native-helper/native_host.log" "$STAGING_ROOT/native-helper/native_host.log"
fi
if [[ -f "$INSTALL_ROOT/native-helper/depreciation-capex-forecast-state.json" ]]; then
  cp -p "$INSTALL_ROOT/native-helper/depreciation-capex-forecast-state.json" \
    "$STAGING_ROOT/native-helper/depreciation-capex-forecast-state.json"
fi

cat > "$STAGING_ROOT/native-helper/runtime-config.json" <<EOF
{
  "pythonBin": "$INSTALL_ROOT/python/bin/python3",
  "printSkillsDir": "$INSTALL_ROOT/skills",
  "depreciationSkillDir": "$INSTALL_ROOT/skills/depreciation-capex-forecast",
  "toolboxExtensionId": "$EXTENSION_ID",
  "nativeHostName": "$HOST_NAME"
}
EOF

cat > "$STAGING_ROOT/native-helper/native_host_launcher.sh" <<EOF
#!/bin/bash
export APPRAISAL_TOOLBOX_ROOT="$INSTALL_ROOT"
export TIANYUAN_NATIVE_RUNTIME_ROOT="$INSTALL_ROOT/native-helper"
export TIANYUAN_RUNTIME_CONFIG_PATH="$INSTALL_ROOT/native-helper/runtime-config.json"
export TIANYUAN_MAP_CONFIG_PATH="$INSTALL_ROOT/map-config.json"
export TIANYUAN_ALIBABA_LEASE_GEOCODE_CACHE_PATH="$INSTALL_ROOT/cache/alibaba-lease-geocode.json"
exec "$INSTALL_ROOT/runtime/node/bin/node" "$INSTALL_ROOT/native-helper/native_host.js" 2>> "$INSTALL_ROOT/native-helper/native_host.log"
EOF
chmod +x "$STAGING_ROOT/native-helper/native_host_launcher.sh"

echo "[4/7] 原子安装"
mkdir -p "$MANIFEST_BACKUP_ROOT"
[[ ! -f "$CHROME_MANIFEST" ]] || cp -p "$CHROME_MANIFEST" "$MANIFEST_BACKUP_ROOT/chrome.json"
[[ ! -f "$EDGE_MANIFEST" ]] || cp -p "$EDGE_MANIFEST" "$MANIFEST_BACKUP_ROOT/edge.json"
MANIFESTS_SNAPSHOTTED=1
if [[ -d "$INSTALL_ROOT" ]]; then
  mv "$INSTALL_ROOT" "$BACKUP_ROOT"
  MOVED_EXISTING_ROOT=1
fi
mv "$STAGING_ROOT" "$INSTALL_ROOT"
INSTALLED_NEW_ROOT=1

echo "[5/7] 运行依赖与 Native Helper 自检"
if ! "$INSTALL_ROOT/python/bin/python3" -c \
  'import docx, et_xmlfile, lxml, openpyxl, requests, typing_extensions'; then
  fail "Python 依赖自检失败，已恢复旧版本。"
fi
SELF_TEST="$(
  TIANYUAN_NATIVE_RUNTIME_ROOT="$INSTALL_ROOT/native-helper" \
  TIANYUAN_RUNTIME_CONFIG_PATH="$INSTALL_ROOT/native-helper/runtime-config.json" \
  "$INSTALL_ROOT/runtime/node/bin/node" \
  "$INSTALL_ROOT/native-helper/native_host.js" --self-test
)" || {
  fail "Native Helper 自检失败，已恢复旧版本。"
}
echo "$SELF_TEST" | "$INSTALL_ROOT/python/bin/python3" -c \
  'import json,sys; data=json.load(sys.stdin); raise SystemExit(0 if data.get("ok") and data.get("pythonSkillImportSmoke",{}).get("ok") else 1)' || {
  fail "Native Helper 自检未通过，已恢复旧版本。"
}

echo "[6/7] 注册 Chrome / Edge Native Messaging"
MANIFEST_PATH="$INSTALL_ROOT/native-helper/$HOST_NAME.json"
"$INSTALL_ROOT/runtime/node/bin/node" - "$MANIFEST_PATH" \
  "$INSTALL_ROOT/native-helper/native_host_launcher.sh" "$HOST_NAME" "$EXTENSION_ID" <<'NODE'
const fs = require("node:fs");
const [manifestPath, launcherPath, hostName, extensionId] = process.argv.slice(2);
fs.writeFileSync(manifestPath, `${JSON.stringify({
  name: hostName,
  description: "Appraisal Toolbox Native Helper",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2)}\n`, { mode: 0o600 });
NODE

for browser_root in \
  "$BROWSER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"; do
  mkdir -p "$browser_root"
  cp -p "$MANIFEST_PATH" "$browser_root/$HOST_NAME.json"
done

# Verify Chrome and Edge independently, including launcher execution permission.
"$INSTALL_ROOT/runtime/node/bin/node" - "$CHROME_MANIFEST" "$EDGE_MANIFEST" "$INSTALL_ROOT/native-helper/native_host_launcher.sh" "$HOST_NAME" "$EXTENSION_ID" <<'NODE'
const fs=require('node:fs'), assert=require('node:assert/strict');
const [chrome,edge,launcher,host,id]=process.argv.slice(2);
for(const file of [chrome,edge]){const m=JSON.parse(fs.readFileSync(file));assert.equal(m.name,host);assert.equal(m.path,launcher);assert.equal(m.type,'stdio');assert.deepEqual(m.allowed_origins,[`chrome-extension://${id}/`]);fs.accessSync(launcher,fs.constants.X_OK);}
NODE
PRODUCT_VERSION="$("$INSTALL_ROOT/runtime/node/bin/node" -p "require(process.argv[1]).productVersion" "$PACKAGE_ROOT/BUILD-PROVENANCE.json")"
SOURCE_COMMIT="$("$INSTALL_ROOT/runtime/node/bin/node" -p "require(process.argv[1]).sourceCommit" "$PACKAGE_ROOT/BUILD-PROVENANCE.json")"
echo "[7/7] 写入安装报告"
cat > "$INSTALL_ROOT/安装检查结果.txt" <<EOF
安装状态：成功
产品：评估工具箱
版本：$PRODUCT_VERSION
源码：$SOURCE_COMMIT
安装器：$INSTALLER_BUILD
扩展 ID：$EXTENSION_ID
Native Host：$HOST_NAME
扩展目录：$INSTALL_ROOT/extension
Native Helper：通过
Python 依赖：通过
安装时间：$(date '+%Y-%m-%d %H:%M:%S %z')
EOF
echo "旧运行目录备份保留：$BACKUP_ROOT"

if [[ "${APPRAISAL_INSTALL_NO_OPEN:-0}" != "1" ]]; then
  open "$INSTALL_ROOT/extension" >/dev/null 2>&1 || true
  open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1 || true
fi

echo
echo "安装完成。"
echo "Chrome 最后一步：打开 chrome://extensions，开启开发者模式，加载："
echo "$INSTALL_ROOT/extension"
echo "确认扩展 ID：$EXTENSION_ID"
