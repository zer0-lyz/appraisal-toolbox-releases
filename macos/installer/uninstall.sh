#!/bin/bash
set -euo pipefail

INSTALL_ROOT="${APPRAISAL_TOOLBOX_ROOT:-$HOME/.appraisal-toolbox}"
BROWSER_HOME="${APPRAISAL_BROWSER_HOME:-$HOME}"
HOST_NAME="com.appraisal.toolbox.helper"
mkdir -p "$HOME/.Trash"
[[ "$INSTALL_ROOT" != "/" && "$INSTALL_ROOT" != "$HOME" && ! -L "$INSTALL_ROOT" ]] || { echo "不安全的安装目录" >&2; exit 1; }
TRASH_TARGET="$HOME/.Trash/AppraisalToolbox-$(date +%Y%m%d-%H%M%S)"

for manifest_path in \
  "$BROWSER_HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" \
  "$BROWSER_HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"; do
  if [[ -f "$manifest_path" ]]; then
    mv "$manifest_path" "$HOME/.Trash/$(basename "$manifest_path").$(date +%s)"
  fi
done

if [[ -d "$INSTALL_ROOT" ]]; then
  mv "$INSTALL_ROOT" "$TRASH_TARGET"
  echo "运行目录已移到废纸篓：$TRASH_TARGET"
else
  echo "未发现已安装的评估工具箱运行目录。"
fi

echo "请在 chrome://extensions 中移除“评估工具箱”。"
