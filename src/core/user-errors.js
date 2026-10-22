import { nativeErrorMessage } from "./native-errors.js";
import { showNativeDiagnostics } from "./native-messaging.mjs";

export function userErrorMessage(error, fallback = "操作未完成，请检查本机助手、文件和网络后重试。") {
  const mapped = nativeErrorMessage(error);
  const raw = String(error?.message || error || "");
  if (mapped && mapped !== raw) return mapped;
  // Only short, already human-readable Chinese messages can reach the UI.
  if (raw.length <= 240 && /[\u4e00-\u9fff]/.test(raw)
      && !/[A-Z][A-Z0-9_]{3,}|Command failed|Traceback|is not defined|python|execFile|\b(?:Error|Exception)\b|\n|[{}]/i.test(raw)) return raw;
  return fallback;
}

export function nativeResponseError(result, fallbackCode) {
  const error = new Error(result?.reason || result?.errorCode || fallbackCode);
  error.code = result?.errorCode || fallbackCode;
  error.diagnostics = result?.diagnostics;
  return error;
}

export function showUserErrorDiagnostics(error, documentRef = globalThis.document) {
  // JS/transport errors carry no command or page body; keep type and code only.
  showNativeDiagnostics(error?.diagnostics || {
    exitCode: null,
    stderrTail: [`类型: ${String(error?.name || "Error").slice(0, 60)}`, `错误码: ${/^[A-Z][A-Z0-9_]{2,}$/.test(error?.code || "") ? error.code : "UI_OPERATION_FAILED"}`],
  }, documentRef);
}

export function localizeHistoryLabel(item) {
  return String(item.label || item.name || item.path || "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
}
