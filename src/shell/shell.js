import { EventBus } from "../core/event-bus.js";
import { FeatureFlagService } from "../core/feature-flags.js";
import { ModuleRegistry } from "../core/module-registry.js";
import { createModuleStorageFactory } from "../core/module-storage.js";
import { landPublicityModule } from "../modules/land-publicity/module.js";
import { alibabaAuctionModule } from "../modules/alibaba-auction/module.js";
import { alibabaLeaseModule } from "../modules/alibaba-lease/module.js";
import { anjukePropertyModule } from "../modules/anjuke-property/module.js";
import { tableFormatModule } from "../modules/table-format/module.js";
import { mapSettingsModule } from "../modules/map-settings/module.js";
import { updatesModule } from "../modules/updates/module.js";
import { depreciationCapexModule } from "../modules/depreciation-capex-forecast/module.js";

const NATIVE_HOST_NAME = "com.tianyuan.workbench.helper";
const CONNECTOR_PROTOCOL_VERSION = "connector-agent-binding-v3";

const elements = Object.fromEntries(
  ["goHome", "subtitle", "status"].map((id) => [id, document.getElementById(id)]),
);

const extensionManifest = chrome.runtime.getManifest();
const eventBus = new EventBus();
const moduleRegistry = new ModuleRegistry({
  featureFlags: new FeatureFlagService(chrome),
  eventBus,
  storageFactory: createModuleStorageFactory(chrome),
  documentRef: document,
});
moduleRegistry.register(landPublicityModule);
moduleRegistry.register(alibabaAuctionModule);
moduleRegistry.register(alibabaLeaseModule);
moduleRegistry.register(anjukePropertyModule);
moduleRegistry.register(tableFormatModule);
moduleRegistry.register(mapSettingsModule);
moduleRegistry.register(updatesModule);
moduleRegistry.register(depreciationCapexModule);

function setStatus(text, kind = "idle") {
  if (!elements.status) return;
  elements.status.className = `status status-${kind}`;
  elements.status.textContent = text;
}

function routeExists(route) {
  return route === "home" || moduleRegistry.routeExists(route);
}

function routeLabel(route) {
  return route === "home" ? "首页" : moduleRegistry.routeLabel(route);
}

let currentRoute = "home";

function renderRoute(route) {
  const safeRoute = routeExists(route) ? route : "home";
  currentRoute = safeRoute;
  for (const page of document.querySelectorAll(".route-page")) {
    page?.classList.toggle("hidden", page.dataset.route !== safeRoute);
  }
  void moduleRegistry.activateRoute(safeRoute);
  elements.subtitle.textContent = routeLabel(safeRoute);
}

function navigateToRoute(route) {
  if (route === currentRoute) {
    renderRoute(route);
    return;
  }
  window.location.hash = `#${route}`;
}

window.addEventListener("hashchange", () => {
  renderRoute(window.location.hash.slice(1));
});

function sendNativeMessage(message, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("NATIVE_HELPER_TIMEOUT"));
    }, timeoutMs);

    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      window.clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "NATIVE_HOST_UNAVAILABLE"));
        return;
      }
      resolve(response);
    });
  });
}

function streamNativeMessage(message, onProgress) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    let settled = false;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      callback(value);
      try {
        port.disconnect();
      } catch {
        // The native host may already have closed after sending the final message.
      }
    }

    port.onMessage.addListener((payload) => {
      if (payload?.event === "progress") {
        onProgress?.(payload);
        return;
      }
      if (payload?.event === "complete") {
        finish(resolve, payload);
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      const messageText = chrome.runtime.lastError?.message || "NATIVE_EXPORT_CONNECTION_CLOSED";
      finish(reject, new Error(messageText));
    });

    port.postMessage(message);
  });
}

async function bootstrapApplication() {
  const requestedRoute = window.location.hash.slice(1) || "home";
  renderRoute("home");
  setStatus("正在加载功能模块…", "idle");
  try {
    await moduleRegistry.initialize({
      chrome,
      document,
      extensionManifest,
      connectorProtocolVersion: CONNECTOR_PROTOCOL_VERSION,
      isBusy: () => false,
      setConnection: (element, text, kind = "idle") => {
        // 工具箱没有状态胶囊栏；updates 模块会把顶栏元素传进来（当前为空），判空即用。
        if (!element) return;
        element.className = `conn conn-${kind}`;
        element.textContent = text;
      },
      navigate: navigateToRoute,
      setStatus,
      sendNativeMessage,
      streamNativeMessage,
    });
    renderRoute(requestedRoute);
    setStatus("工具箱已就绪", "idle");
  } catch (error) {
    // Keep the shell usable even if a non-core startup task fails.
    renderRoute("home");
    setStatus(`部分模块加载失败：${error?.message || String(error)}`, "error");
    console.error(error);
  }
}

elements.goHome?.addEventListener("click", () => navigateToRoute("home"));

window.addEventListener("beforeunload", () => {
  void moduleRegistry.dispose();
}, { once: true });

bootstrapApplication().catch((error) => {
  console.error(error);
  setStatus(`启动失败：${error?.message || String(error)}`, "error");
});
