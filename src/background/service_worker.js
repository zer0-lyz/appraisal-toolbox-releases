// Service worker 只负责让工具栏图标点击时直接打开侧边栏面板。
// 业务逻辑全部在侧边栏外壳（src/shell/shell.js）与功能模块内。
import { classifyNativeMessagingError } from "../core/native-errors.js";
import { createSerialQueue, DEPRECIATION_QUEUE_PORT } from "../core/native-messaging.mjs";

function enableOpenPanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("setPanelBehavior failed", error));
}

enableOpenPanelOnActionClick();
chrome.runtime.onInstalled.addListener(enableOpenPanelOnActionClick);

const depreciationNativeQueue = createSerialQueue();

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let port;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      try { port?.disconnect(); } catch { /* The host may already have closed its port. */ }
      callback(value);
    };

    try {
      // A connected Native Messaging port keeps this MV3 worker alive during long depreciation runs.
      port = chrome.runtime.connectNative("com.appraisal.toolbox.helper");
      port.onMessage.addListener((payload) => {
        if (settled || payload?.event === "progress") return;
        finish(resolve, payload);
      });
      port.onDisconnect.addListener(() => {
        if (settled) return;
        const error = chrome.runtime.lastError;
        finish(reject, new Error(classifyNativeMessagingError(error?.message) || "NATIVE_HOST_START_FAILED"));
      });
      port.postMessage(message);
    } catch (error) {
      finish(reject, new Error(classifyNativeMessagingError(error) || "NATIVE_HOST_START_FAILED"));
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DEPRECIATION_QUEUE_PORT) return;
  if (port.sender?.id !== chrome.runtime.id) {
    try { port.postMessage({ type: "error", reason: "NATIVE_HOST_UNAVAILABLE" }); } catch { /* Ignore a closed port. */ }
    port.disconnect();
    return;
  }

  let requestAccepted = false;
  port.onMessage.addListener((request) => {
    if (requestAccepted) return;
    requestAccepted = true;
    depreciationNativeQueue(async () => {
      try {
        port.postMessage({ type: "started" });
      } catch {
        return;
      }
      const payload = await sendNativeMessage(request?.message);
      try { port.postMessage({ type: "result", payload }); } catch { /* The caller may have closed its page. */ }
    }).catch((error) => {
      try { port.postMessage({ type: "error", reason: error?.message || "NATIVE_HOST_UNAVAILABLE" }); } catch { /* Ignore a closed port. */ }
    });
  });
});
