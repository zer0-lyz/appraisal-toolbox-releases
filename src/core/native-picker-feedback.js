import { showUserErrorDiagnostics, userErrorMessage } from "./user-errors.js";

const buttonStates = new WeakMap();

function ensureGuard(guard) {
  guard.generation = Number(guard.generation || 0);
  guard.activeButtons ||= new Set();
  guard.busy = Boolean(guard.busy);
  return guard;
}

function feedbackElement(button, documentRef) {
  const existing = buttonStates.get(button)?.feedback;
  if (existing?.isConnected) return existing;
  const row = button.closest?.(".directory-row, .button-row, .land-publicity-output-row, .alibaba-auction-output-row, .alibaba-lease-output-row, .anjuke-property-output-row")
    || button.parentElement;
  if (!row) return null;
  const feedback = documentRef.createElement("p");
  feedback.className = "inline-feedback native-picker-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  row.insertAdjacentElement("afterend", feedback);
  return feedback;
}

function writeFeedback(feedback, text, kind, setStatus) {
  if (!feedback) return;
  feedback.textContent = text || "";
  feedback.dataset.kind = kind || "";
  if (typeof setStatus === "function") {
    setStatus(text || "", kind === "error" ? "error" : kind === "warn" ? "warn" : kind === "ok" ? "ok" : "idle");
  }
}

function responseError(result, fallbackCode = "FILE_PICKER_FAILED") {
  const reason = String(result?.reason || result?.errorCode || fallbackCode);
  const error = new Error(reason);
  error.code = String(result?.errorCode || reason);
  error.diagnostics = result?.diagnostics || {
    exitCode: null,
    stderrTail: [`阶段: native_response`, `错误码: ${error.code}`],
  };
  return error;
}

function emptyResultError() {
  const error = new Error("FILE_PICKER_EMPTY_RESULT");
  error.code = "FILE_PICKER_EMPTY_RESULT";
  error.diagnostics = {
    exitCode: null,
    stderrTail: ["阶段: response_validation", "错误码: FILE_PICKER_EMPTY_RESULT"],
  };
  return error;
}

function errorText(error, callback) {
  try {
    if (typeof callback === "function") return String(callback(error) || "");
  } catch { /* Use the safe shared mapping if a caller formatter fails. */ }
  return userErrorMessage(error);
}

export function invalidatePickerFeedback(guard) {
  if (!guard || typeof guard !== "object") return;
  ensureGuard(guard);
  if (guard.phase === "applying" || guard.phase === "saving") {
    guard.discardResult = true;
    for (const state of guard.activeButtons) {
      if (state.feedback?.isConnected) writeFeedback(state.feedback, "", "", null);
    }
    if (typeof guard.onBusyChange === "function") guard.onBusyChange(true);
    return;
  }
  guard.generation += 1;
  guard.busy = false;
  guard.phase = "idle";
  guard.discardResult = false;
  for (const state of guard.activeButtons) {
    if (state.feedback?.isConnected) writeFeedback(state.feedback, "", "", null);
    state.button.disabled = state.wasDisabled;
    state.active = false;
    state.guard = null;
  }
  guard.activeButtons.clear();
  if (typeof guard.onBusyChange === "function") guard.onBusyChange(false);
}

export async function runNativePickerFeedback(options = {}) {
  const button = options.button;
  const documentRef = options.documentRef || button?.ownerDocument || globalThis.document;
  if (!button || !documentRef || button.disabled) return { started: false };
  const guard = ensureGuard(options.guard || {});
  if (guard.busy) return { started: false };

  const feedback = feedbackElement(button, documentRef);
  const token = ++guard.generation;
  guard.discardResult = false;
  const state = { button, feedback, wasDisabled: button.disabled, active: true, guard };
  buttonStates.set(button, state);
  guard.activeButtons.add(state);
  guard.busy = true;
  guard.phase = "opening";
  if (typeof options.onBusyChange === "function") guard.onBusyChange = options.onBusyChange;
  button.disabled = true;
  if (typeof guard.onBusyChange === "function") guard.onBusyChange(true);
  writeFeedback(feedback, options.busyText || "正在打开系统选择窗口，请完成选择…", "", options.setStatus);

  const isCurrent = () => state.active
    && guard.generation === token
    && guard.busy
    && !guard.discardResult
    && button.isConnected !== false;
  const finish = () => {
    if (guard.generation !== token) return;
    guard.busy = false;
    guard.phase = "idle";
    guard.discardResult = false;
    guard.activeButtons.delete(state);
    button.disabled = state.wasDisabled;
    state.active = false;
    state.guard = null;
    if (typeof guard.onBusyChange === "function") guard.onBusyChange(false);
  };

  try {
    const result = await options.request();
    if (!isCurrent()) return { started: true, stale: true };
    if (result?.cancelled === true || result?.canceled === true) {
      const text = options.cancelText || "已取消选择，原选择保留。";
      writeFeedback(feedback, text, "warn", options.setStatus);
      return { started: true, cancelled: true, result };
    }
    if (result?.ok !== true) throw responseError(result, options.fallbackCode);

    const selected = typeof options.resolveSelection === "function"
      ? options.resolveSelection(result)
      : result.outputDirectory || result.path || result.paths?.[0] || result.sourcePath || "";
    const hasSelection = Array.isArray(selected)
      ? selected.some((item) => String(item || "").trim())
      : Boolean(String(selected || "").trim());
    if (!hasSelection) throw emptyResultError();

    guard.phase = "applying";
    const outcome = typeof options.onSelected === "function"
      ? await options.onSelected(result, selected)
      : null;
    if (!isCurrent()) return { started: true, stale: true };
    if (outcome?.handled === true) {
      writeFeedback(feedback, outcome.text || "操作未完成。", outcome.kind || "", options.setStatus);
      if (outcome.error) (options.showDiagnostics || showUserErrorDiagnostics)(outcome.error, documentRef);
      return { started: true, result, selected, ...outcome };
    }

    const success = typeof options.successText === "function"
      ? String(options.successText(result, selected) || "")
      : `已选择：${Array.isArray(selected) ? `${selected.length} 项` : String(selected)}`;
    if (typeof options.persist === "function") {
      guard.phase = "saving";
      try {
        await options.persist(result, selected);
      } catch (error) {
        if (!isCurrent()) return { started: true, stale: true };
        const message = errorText(error, options.errorMessage);
        const text = `${success}；目录已选择，但设置保存失败：${message}。本次会话仍使用该目录，请稍后重试保存。`;
        writeFeedback(feedback, text, "error", options.setStatus);
        (options.showDiagnostics || showUserErrorDiagnostics)(error, documentRef);
        return { started: true, result, selected, persisted: false, error };
      }
      if (!isCurrent()) return { started: true, stale: true };
    }
    writeFeedback(feedback, success, options.successKind || "ok", options.setStatus);
    return { started: true, result, selected, persisted: true };
  } catch (error) {
    if (!isCurrent()) return { started: true, stale: true };
    const message = errorText(error, options.errorMessage);
    const prefix = options.failurePrefix || "选择失败";
    const text = `${prefix}：${message} 原选择保留，可复制诊断详情后重试。`;
    writeFeedback(feedback, text, "error", options.setStatus);
    (options.showDiagnostics || showUserErrorDiagnostics)(error, documentRef);
    return { started: true, error };
  } finally {
    finish();
  }
}
