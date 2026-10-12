// Native Helper validates the local artifact. The extension opens it in its own window.
export async function openHtmlResultInCurrentBrowser(context, action, targetPath, outputDirectory) {
  const result = await context.sendNativeMessage({
    action,
    path: targetPath,
    ...(outputDirectory ? { outputDirectory } : {}),
    openInCurrentBrowserTab: true,
  }, 15000);
  if (!result?.ok) throw new Error(result?.reason || "结果页路径校验失败，请确认文件仍然存在。");
  if (!result.browserTab || !result.fileUrl) {
    throw new Error("本机助手需要更新，请重新安装当前修复包。");
  }
  let url;
  try { url = new URL(result.fileUrl); } catch { throw new Error("结果页路径无效。"); }
  if (url.protocol !== "file:" || !/\.html?$/i.test(url.pathname)) {
    throw new Error("结果页必须是本机 HTML 文件。");
  }
  const window = await context.chrome.windows.getCurrent();
  if (!Number.isInteger(window?.id)) throw new Error("无法确认当前浏览器窗口，请重新打开工具箱后重试。");
  // No OS-shell fallback: failures must not launch the default browser.
  try {
    const tab = await context.chrome.tabs.create({ windowId: window.id, url: url.href, active: true });
    if (!Number.isInteger(tab?.id)) throw new Error("浏览器未返回结果标签页，请重新加载扩展后重试。");
    return tab;
  } catch (error) {
    const fileAccess = await context.chrome.extension?.isAllowedFileSchemeAccess?.().catch(() => undefined);
    if (fileAccess === false) {
      throw new Error("浏览器未能打开本地结果页。请在扩展管理的“评估工具箱”详情中启用“允许访问文件网址”后重试。");
    }
    throw new Error("浏览器未能创建结果标签页，请重新加载扩展后重试。", { cause: error });
  }
}
