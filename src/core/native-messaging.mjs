export const DEPRECIATION_QUEUE_PORT = "APPRAISAL_TOOLBOX_DEPRECIATION_QUEUE";

export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(operation) {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function sendQueuedDepreciationNativeMessage(chromeApi, message, operationTimeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let started = false;
    let port;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      try { port?.disconnect(); } catch { /* The service worker may already have closed the port. */ }
      callback(value);
    };

    try {
      port = chromeApi.runtime.connect({ name: DEPRECIATION_QUEUE_PORT });
      port.onMessage.addListener((response) => {
        if (settled || !response) return;
        if (response.type === "started") {
          if (started) return;
          started = true;
          timer = globalThis.setTimeout(() => {
            finish(reject, new Error("NATIVE_HELPER_TIMEOUT"));
          }, operationTimeoutMs);
          return;
        }
        if (response.type === "result") {
          finish(resolve, response.payload);
          return;
        }
        if (response.type === "error") {
          finish(reject, new Error(response.reason || "NATIVE_HOST_UNAVAILABLE"));
        }
      });
      port.onDisconnect.addListener(() => {
        const lastError = chromeApi.runtime.lastError;
        if (!settled) finish(reject, new Error(lastError?.message || (started ? "NATIVE_HOST_START_FAILED" : "NATIVE_HOST_UNAVAILABLE")));
      });
      port.postMessage({ message, operationTimeoutMs });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function redactDiagnosticLine(value) {
  return String(value || "")
    .replace(/(["']?\b(?:proxy-)?(?:authorization|set-cookie|cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\r\n]+)(?=\s*(?:,|$))/gi, "$1[REDACTED]")
    .replace(/(["']?\b(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|web[_-]?key|securityJsCode|amap[_-]?key|client[_-]?secret|token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|api_key|apikey|token|client_secret|secret)=)[^&#\s"'<>]*/gi, "$1[REDACTED]")
    .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z]:\\Users\\[^\r\n"'<>)]*/gi, "[用户路径]")
    .replace(/\/(?:Users|home)\/[^\r\n"'<>)]*/gi, "[用户路径]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]");
}

export function showNativeDiagnostics(payloadOrDiagnostics, documentRef = globalThis.document) {
  if (!documentRef) return;
  const diagnostics = payloadOrDiagnostics?.diagnostics
    || payloadOrDiagnostics?.results?.find((item) => item?.diagnostics)?.diagnostics
    || payloadOrDiagnostics;
  if (!diagnostics || !Array.isArray(diagnostics.stderrTail)) return;
  const stderrTail = diagnostics.stderrTail.slice(-20).map((line) => {
    const text = redactDiagnosticLine(line);
    return text.length > 512 ? `…${text.slice(-511)}` : text;
  });
  let totalLength = stderrTail.reduce((sum, line) => sum + line.length, 0);
  while (totalLength > 6000 && stderrTail.length > 1) totalLength -= stderrTail.shift().length;
  if (totalLength > 6000 && stderrTail.length) stderrTail[0] = `…${stderrTail[0].slice(-5999)}`;
  const sanitized = {
    exitCode: Number.isInteger(diagnostics.exitCode) ? diagnostics.exitCode : null,
    stderrTail,
  };
  let panel = documentRef.getElementById("nativeDiagnosticsPanel");
  if (!panel) {
    panel = documentRef.createElement("details");
    panel.id = "nativeDiagnosticsPanel";
    panel.className = "native-diagnostics";
    const summary = documentRef.createElement("summary");
    summary.className = "native-diagnostics-summary";
    const label = documentRef.createElement("span");
    label.dataset.role = "summary";
    const copy = documentRef.createElement("button");
    copy.type = "button";
    copy.className = "native-diagnostics-copy";
    copy.textContent = "复制诊断详情";
    const output = documentRef.createElement("pre");
    output.className = "native-diagnostics-output";
    output.dataset.role = "output";
    copy.addEventListener("click", async () => {
      const original = copy.textContent;
      try {
        await documentRef.defaultView.navigator.clipboard.writeText(output.textContent || "");
        copy.textContent = "已复制";
      } catch {
        copy.textContent = "复制失败，可手动选择";
      }
      documentRef.defaultView.setTimeout(() => { copy.textContent = original; }, 1600);
    });
    summary.append(label, copy);
    panel.append(summary, output);
    (documentRef.querySelector("main.app") || documentRef.body).append(panel);
  }
  const lineCount = sanitized.stderrTail.length;
  const exitLabel = sanitized.exitCode === null ? "未知" : String(sanitized.exitCode);
  panel.querySelector('[data-role="summary"]').textContent = `诊断信息（退出码 ${exitLabel}，${lineCount} 行）`;
  panel.querySelector('[data-role="output"]').textContent = JSON.stringify(sanitized, null, 2);
  panel.hidden = false;
  panel.open = false;
}
