import { mapSettingsTemplate } from "./template.js";

function elementMap(documentRef) {
  const ids = [
    "openMapSettings",
    "mapSettingsStatus",
    "page-map-settings",
    "backFromMapSettings",
    "mapSettingsConfiguredStatus",
    "mapSettingsEnableAmap",
    "mapSettingsAmapKey",
    "mapSettingsAmapSecurityCode",
    "mapSettingsLocalStatus",
    "saveMapSettings",
    "clearMapSettings",
    "mapSettingsMessage",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

export const mapSettingsModule = {
  manifest: {
    id: "map-settings",
    type: "feature",
    stage: "stable",
    route: "map-settings",
    displayName: "地图基础配置",
    messageNamespace: "map-settings",
    entryElementId: "openMapSettings",
    pageElementId: "page-map-settings",
    storageVersion: 1,
    countInModuleBadge: false,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let nativeSummary = null;

    function renderSummary(summary = nativeSummary) {
      const configured = Boolean(summary?.configured);
      elements.mapSettingsConfiguredStatus.textContent = configured ? "已配置" : "未配置";
      elements.mapSettingsConfiguredStatus.dataset.kind = configured ? "ok" : "warn";
      if (elements.mapSettingsStatus) {
        elements.mapSettingsStatus.textContent = configured ? "已配置" : "未配置";
        elements.mapSettingsStatus.className = `conn conn-${configured ? "ok" : "warn"}`;
        elements.mapSettingsStatus.dataset.kind = configured ? "ok" : "warn";
      }
      elements.mapSettingsEnableAmap.checked = Boolean(summary?.enabled);
      elements.mapSettingsLocalStatus.textContent = configured
        ? `本机已配置高德 API（Key：${summary.webKeyMasked || "已隐藏"}）。留空 Key 保存时会保留现有配置。`
        : "当前使用默认公共底图；默认底图全部失败时，地图会提示在此处配置官方 API。";
      elements.mapSettingsLocalStatus.dataset.kind = configured ? "ok" : "warn";
    }

    async function refreshSummary() {
      try {
        const result = await context.sendNativeMessage({ action: "get_map_config" }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "MAP_CONFIG_READ_FAILED");
        nativeSummary = result;
        renderSummary();
      } catch (error) {
        setMessage(elements.mapSettingsMessage, `读取本机地图配置失败：${error?.message || String(error)}`, "error");
        elements.mapSettingsLocalStatus.textContent = "暂时无法读取本机配置，请确认工作台本机运行组件在线。";
        elements.mapSettingsLocalStatus.dataset.kind = "error";
      }
    }

    async function save() {
      const enabled = elements.mapSettingsEnableAmap.checked;
      const webKey = elements.mapSettingsAmapKey.value.trim();
      const securityJsCode = elements.mapSettingsAmapSecurityCode.value.trim();
      if (enabled && !webKey && !nativeSummary?.configured) {
        setMessage(elements.mapSettingsMessage, "启用官方高德底图前，请填写 Web 端（JS API）Key。", "warn");
        return;
      }
      elements.saveMapSettings.disabled = true;
      try {
        const result = await context.sendNativeMessage({
          action: "save_map_config",
          config: { amap: { enabled, webKey, securityJsCode, preserveExisting: nativeSummary?.configured === true } },
        }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "MAP_CONFIG_SAVE_FAILED");
        nativeSummary = result;
        elements.mapSettingsAmapKey.value = "";
        elements.mapSettingsAmapSecurityCode.value = "";
        await context.storage.save({ enabled: result.enabled, configured: result.configured, webKeyMasked: result.webKeyMasked || "" });
        renderSummary();
        setMessage(elements.mapSettingsMessage, result.enabled ? "已保存。请重新生成地图后使官方 API 配置生效。" : "已恢复默认公共底图。", "ok");
        context.setStatus("地图基础配置已保存", "ok");
      } catch (error) {
        setMessage(elements.mapSettingsMessage, `保存地图配置失败：${error?.message || String(error)}`, "error");
      } finally {
        elements.saveMapSettings.disabled = false;
      }
    }

    async function clear() {
      elements.clearMapSettings.disabled = true;
      try {
        const result = await context.sendNativeMessage({ action: "clear_map_config" }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "MAP_CONFIG_CLEAR_FAILED");
        nativeSummary = result;
        elements.mapSettingsAmapKey.value = "";
        elements.mapSettingsAmapSecurityCode.value = "";
        await context.storage.save({ enabled: false, configured: false, webKeyMasked: "" });
        renderSummary();
        setMessage(elements.mapSettingsMessage, "已恢复默认公共底图。", "ok");
        context.setStatus("已恢复默认地图配置", "ok");
      } catch (error) {
        setMessage(elements.mapSettingsMessage, `恢复默认配置失败：${error?.message || String(error)}`, "error");
      } finally {
        elements.clearMapSettings.disabled = false;
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("MAP_SETTINGS_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = mapSettingsTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/map-settings/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        context.scope.on(elements.openMapSettings, "click", () => context.navigate("map-settings"));
        context.scope.on(elements.backFromMapSettings, "click", () => context.navigate("home"));
        context.scope.on(elements.saveMapSettings, "click", save);
        context.scope.on(elements.clearMapSettings, "click", clear);
        renderSummary();
        await refreshSummary();
      },
      activate() { void refreshSummary(); },
      deactivate() {},
      dispose() {},
    };
  },
};
