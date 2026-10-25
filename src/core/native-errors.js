const exactMessages = Object.freeze({
  RESULT_FRONTEND_UPDATE_REQUIRED: "结果页需要新版扩展打开。请在扩展管理中加载安装目录下的 extension 文件夹；已加载该目录时请点击重新加载。",
  FILE_ASSOCIATION_MISSING: "Windows 未配置该文件的打开应用。请安装或选择 Excel/WPS 等应用后重试。",
  NATIVE_PATH_OPEN_FAILED: "Windows 未能打开该文件。请检查文件关联和访问权限后重试。",
  LAND_OPEN_PATH_FAILED: "Windows 未能打开结果文件。请更新本机助手并检查 Excel/WPS 文件关联后重试。",
  RESULT_HTML_REQUIRED: "结果页必须是本机 HTML 文件。请选择结果页或地图后重试。",
  RESULT_HTML_NOT_READABLE: "结果页文件不可读取或内容为空。请重新生成结果后重试。",
  FILE_BUSY: "工作簿正被另一操作占用，请重试。",
  WORKBOOK_OPERATION_TIMEOUT: "等待工作簿操作超时。请确认其他计算已结束，检查本机运行环境后重试。",
  DEPRECIATION_WORKFLOW_TIMEOUT: "折旧测算等待超时。请确认工作簿未被其他操作占用，检查本机运行环境后重试。",
  DEPRECIATION_LEGACY_PATH_REQUIRES_IMPORT: "该位置属于旧项目工作区。原工作簿保持原位；请通过“导入工作簿”复制到评估工具箱工作区。",
  FILE_PICKER_FAILED: "系统文件或文件夹选择窗口未能完成。请关闭异常弹窗后重试；如果持续发生，请修复本机助手。",
  FILE_PICKER_PROCESS_START_FAILED: "系统选择窗口无法启动。请检查本机助手是否被安全软件拦截，再重试或修复安装。",
  FILE_PICKER_TIMEOUT: "等待系统选择窗口超时。请完成或关闭现有选择窗口后重试。",
  FILE_PICKER_PROCESS_FAILED: "系统选择窗口异常退出。请重新选择；如果持续发生，请修复本机助手。",
  FILE_PICKER_PROTOCOL_INVALID: "系统选择窗口没有返回有效结果。请重新选择；如果持续发生，请修复本机助手。",
  FILE_PICKER_EMPTY_RESULT: "系统选择窗口没有返回所选项目。请重新选择并重试。",
  APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED: "当前本机助手版本不支持此操作。请安装当前平台的完整安装包，并重新加载原插件后重试。",
  UNKNOWN_ACTION: "当前本机助手不认识此操作。请安装当前平台的完整安装包，并重新加载原插件后重试。",
  MANAGED_OUTPUT_PERMISSION_DENIED: "无法在所选位置创建或写入专用成果子文件夹。请检查该位置的创建和写入权限，或选择可写的位置后重试。",
  MANAGED_OUTPUT_READ_ONLY: "所选位置为只读，无法写入成果。请改选可写位置后重试。",
  MANAGED_OUTPUT_DISK_FULL: "所选磁盘空间不足，无法验证成果目录的写入能力。请释放空间或选择其他位置后重试。",
  MANAGED_OUTPUT_NAME_CONFLICT: "专用成果文件夹名称已被同名文件占用。请在上级目录中移走或重命名该文件后重试。",
  MANAGED_OUTPUT_PATH_UNAVAILABLE: "所选上级目录或成果文件夹当前不可访问。请确认磁盘、网络位置或移动设备已连接，再重试。",
  MANAGED_OUTPUT_CREATE_FAILED: "无法创建或验证专用成果子文件夹。请检查所选位置后重试。",
  EXPORT_DIRECTORY_CREATE_FAILED: "无法创建或验证专用导出子文件夹。请检查所选位置后重试。",
  PRINT_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证专用成果子文件夹。请检查所选位置后重试。",
  TABLE_FORMAT_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证表格设置成果文件夹。请检查所选位置后重试。",
  LAND_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证土地公示成果文件夹。请检查所选位置后重试。",
  ALIBABA_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证司法拍卖成果文件夹。请检查所选位置后重试。",
  ANJUKE_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证安居客成果文件夹。请检查所选位置后重试。",
  ALIBABA_LEASE_OUTPUT_DIRECTORY_CREATE_FAILED: "无法创建或验证资产租赁成果文件夹。请检查所选位置后重试。",
  LAND_PUBLICITY_RUN_FAILED: "土地公示抓取失败。请检查筛选条件和浙江土地市场网连接后重试。",
  LAND_RUNNER_FAILED: "土地公示处理失败。请查看诊断信息，并检查本机运行环境后重试。",
  LAND_REGION_CATALOG_UNAVAILABLE: "行政区目录暂不可用。请检查浙江土地市场网连接后刷新行政区。",
  LAND_HISTORY_LIST_FAILED: "土地历史清单读取失败。请检查历史目录和文件权限后重试。",
  LAND_HISTORY_LOAD_FAILED: "土地历史数据读取失败。请检查所选文件后重试。",
  NATIVE_HELPER_TIMEOUT: "本机助手响应超时。请确认前一项任务已经结束后重试；若持续发生，请重新加载扩展或修复本机安装。",
  NATIVE_HOST_UNAVAILABLE: "未找到本机助手。请在解压后的安装目录运行 install.cmd 安装，再重新加载扩展。",
  NATIVE_HOST_START_FAILED: "本机助手清单或程序无法启动。请运行 install.cmd 修复安装，并检查安全软件是否拦截。",
  NATIVE_STREAM_IDLE_TIMEOUT: "本机任务长时间没有进展。请检查网络或本机运行环境后重试。",
});

export function classifyNativeMessagingError(value) {
  const text = String(value?.message || value || "");
  const errorCode = String(value?.code || "").toUpperCase();
  const explicitCode = text.match(/\b(?:NATIVE_HELPER_TIMEOUT|NATIVE_HOST_UNAVAILABLE|NATIVE_HOST_START_FAILED|FILE_BUSY)\b/)?.[0];
  if (explicitCode) return explicitCode;
  if (["NATIVE_HELPER_TIMEOUT", "NATIVE_HOST_UNAVAILABLE", "NATIVE_HOST_START_FAILED", "FILE_BUSY"].includes(errorCode)) return errorCode;
  const winError = text.match(/\bWinError\s*(\d+)\b/i)?.[1];
  if (["EACCES", "EPERM", "EBUSY"].includes(errorCode)
      || ["5", "32", "33"].includes(winError)
      || /\b(?:EACCES|EPERM|EBUSY)\b|ERROR_SHARING_VIOLATION|ERROR_ACCESS_DENIED/i.test(text)) {
    return "FILE_BUSY";
  }
  if (/specified native messaging host not found|native messaging host.*not found|host not found/i.test(text)) {
    return "NATIVE_HOST_UNAVAILABLE";
  }
  if (/failed to start native messaging host|native host has exited|native host.*closed the connection|error when communicating with the native messaging host|native messaging host.*terminated/i.test(text)) {
    return "NATIVE_HOST_START_FAILED";
  }
  return "";
}

function extractNativeErrorCode(value) {
  const text = String(value?.message || value || "");
  return text.match(/\b(?:RESULT_HTML_[A-Z0-9_]+|RESULT_FRONTEND_UPDATE_REQUIRED|FILE_ASSOCIATION_MISSING|NATIVE_PATH_OPEN_FAILED|FILE_PICKER_[A-Z0-9_]+|APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED|UNKNOWN_ACTION|MANAGED_OUTPUT_[A-Z0-9_]+|EXPORT_DIRECTORY_CREATE_FAILED|(?:EXPORT|PRINT|TABLE_FORMAT|LAND|ALIBABA|ANJUKE|ALIBABA_LEASE)_OUTPUT_DIRECTORY_CREATE_FAILED|LAND_HISTORY_[A-Z0-9_]+|LAND_[A-Z0-9_]+|NATIVE_HELPER_TIMEOUT|NATIVE_HOST_UNAVAILABLE|NATIVE_HOST_START_FAILED|NATIVE_STREAM_IDLE_TIMEOUT|FILE_BUSY|WORKBOOK_OPERATION_TIMEOUT|DEPRECIATION_WORKFLOW_TIMEOUT|DEPRECIATION_LEGACY_PATH_REQUIRES_IMPORT)\b/)?.[0]
    || classifyNativeMessagingError(value);
}

export function nativeErrorMessage(value) {
  const text = String(value?.message || value || "");
  if (/\bANJUKE_(?:RUNNER_FAILED|SCRIPT_NOT_FOUND|RESULT_INVALID|RESULT_MISSING|CAPTURE_FAILED)\b/.test(text)) return "安居客结果处理失败。请查看诊断摘要，检查本机助手与便携 Python 安装后重试。";
  if (/\bTABLE_FORMAT_(?:SCRIPT_FAILED|SCRIPT_NOT_FOUND|BATCH_PARTIAL_FAILURE)\b/.test(text)) return "Word 表格处理失败。请关闭占用文档的应用，查看诊断摘要后重试。";
  const code = extractNativeErrorCode(value);
  if (code && exactMessages[code]) return exactMessages[code];
  if (/\bWinError\s*(?:5|32|33)\b|\b(?:EACCES|EPERM|EBUSY)\b/i.test(text)) return exactMessages.FILE_BUSY;
  if (code?.startsWith("LAND_HISTORY_")) return "土地历史数据操作失败。请检查所选历史目录和文件后重试。";
  if (code?.startsWith("LAND_")) return "土地公示操作失败。请查看行政区目录或抓取诊断后重试。";
  if (text.length <= 240 && /[\u4e00-\u9fff]/.test(text)
      && !/Command failed|Traceback|is not defined|[A-Z][A-Z0-9_]{3,}|python.exe|\n|[{}]/.test(text)) return text;
  return "操作未完成，请检查本机助手、文件和网络后重试；可复制诊断详情供排查。";
}
