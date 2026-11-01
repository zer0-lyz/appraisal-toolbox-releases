# Mac 主开发 agent：接手 Windows .16 修复

请在 GitHub 仓库 `zer0-lyz/appraisal-toolbox-releases` 接手 `codex/windows-auto-update-reviewfix-20261016` 分支。不要只读 main；Windows 本次候选 Release 为 `v0.2.1-windows.20261016.16`。

先读本目录 README、MAC_REVIEW_FIXES_HANDOFF、WINDOWS_REVIEW_FIXES、ACCEPTANCE_STATUS 和 SOURCE_PACKAGE_MAPPING；再读上一级 DUAL_PLATFORM_PLAN、WINDOWS_LESSONS、BUILD_RUNBOOK 及协调 Issue #1 的最新回复。上一级 10-12 文档保留历史，新 Windows 候选以本目录为准。

用户已授权通过分支/PR/Issue 与 Windows agent 交接。先在 Issue #1 回复取得的源码 commit、Mac OS/架构、权威 Mac 源/构建入口及计划；不得直接合并 main 或覆盖 stable/latest。所有修复按本机真实平台验证，不读取/上传账号/Profile/真实地图 Key，不碰天源。

重点：

1. 对比权威 Mac 源与 Windows 恢复源码，保留 Mac adapter；吸收共享地图 .3 和更新 UI/协议修复，不能用旧 main 覆盖 ._pth 自举、统一 Python resolver、stderr 中文诊断、工作簿队列锁、阿里成交/日期判据及历史按钮等已通过修复。
2. 地图保持高德唯一相机、原生双击禁用对策、SDK 实际投影/光标锚点、有限值保护、滚轮单位与小增量、控件过滤、包装监听同引用解绑。旧内嵌 HTML 与新生成运行时分开验收，不改原始坐标/业务数据。
3. Windows update_engine.js 只为 win32/x64 返回自动安装能力。Mac 保留手动入口或实现独立 Mac adapter；不调用 cmd/PowerShell，不把注册表逻辑照搬。共享 UI 必须兼容无 event 的旧宿主拒绝、完整终态和忙态、防同版本 build 降级。
4. 继续统一双端构建入口/输入锁/缓存/平台独立发布清单。当前 Windows builder 从 installer 自动提取 .7，并增加 autoupd suffix；不要再沿用历史硬编码 .5 的结论；PS wrapper 和可复现干净构建仍须核对，不将本次“原字节上传”说成从新 Git commit 重建。
5. 本次包来源是 10-13 dirty Windows 源，sourceSnapshot 与包逐文件映射已提供；现有 repo 中 Mac/CI/发布文档保留为额外文件。核对 source map 后再合并公共源码，禁止谎称原 provenance 的 sourceGitHead 已包含所有修复。
6. Mac 真正完成安装/Chrome与Edge Native连接/无环境变量技能导入及受影响地图、业务 GUI，分层写通过/失败/未覆盖。Windows 本次完整桌面与自动更新链仍待 ZCode；未取得报告前不要替其关闭。
7. 安居客、折旧和三个 Excel 本地工具保持开发中。租赁验证不能绕过，坐标来源不明确时保留未覆盖。Z2/新机回滚/真实受限环境等历史待办按 Issue #2/#3 证据更新，不能默认已解决。

交付：新 PR、各文件修法/平台影响、Mac 包 URL/SHA/签名、输入锁与源码 commit、普通桌面/协议/GUI各自证据范围、后续责任人；在协调 Issue #1 汇总。先形成可复核结果再提出双端正式发布建议。
