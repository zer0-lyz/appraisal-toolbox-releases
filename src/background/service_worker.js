// Service worker 只负责让工具栏图标点击时直接打开侧边栏面板。
// 业务逻辑全部在侧边栏外壳（src/shell/shell.js）与功能模块内。
function enableOpenPanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("setPanelBehavior failed", error));
}

enableOpenPanelOnActionClick();
chrome.runtime.onInstalled.addListener(enableOpenPanelOnActionClick);
