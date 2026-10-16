# Mac 接收 Windows build 16：开发基线与防回归

日期：2026-10-16。关联 Issue #1 与 PR #4/#5/#9/#10。PR #5 的 Mac 基线分支 `codex/mac-main-handoff-20261012` / HEAD `76584a3410732cea93a26dd923a1a373619f7a0d`；新的独立分支 `codex/mac-build16-baseline-20261016` 对应 draft PR #11；Mac 候选包的干净构建源码为 `fe41e9f5cbc53265f662a3f9dc75788aadd33dc9`。原 Mac checkout 保持干净，折现率实验工作树 322 个文件状态保持原样。main 仍为 `46a67bc48766703e13a182f57a1ca5375a2a1aef`；#4/#5/#9/#10 均未合并 main。

## Windows build 16 接收状态

Windows source snapshot `65840987d9aea80586817ca63684f4df2953d5c2` 的 168 个文件与 Release `SOURCE_PACKAGE_MAPPING.json` 逐项匹配。ZIP SHA-256 `7a2cd2f7a79aeee0e4509152ef857d01fcbd038d65f211c5c333347b9b4093f4`，EXE SHA-256 `aa2c39a96f3168862cb867be187041499aa771f1e18e418d41485a9cbafdb824`。来源是 dirty source，原 HEAD `46a67bc48766703e13a182f57a1ca5375a2a1aef`；不声称从 snapshot commit 干净重建。

用户曾口头确认安装测试及业务模块验证通过；随后指定的 Issue 评论 #6211914310/#6211971083 和 Release `ACCEPTANCE_STATUS.json` 明确说明 build 16 没有真实桌面/GUI报告，`fullAcceptancePassed=false`。因此该口头信息不绑定 build 16 的完整桌面验收结论。10 月 11 日 `windows-e2e-round2.1` 是旧包，含 Edge 手工补键条件，不计入 .16。该状态保持“未覆盖”，不阻塞 Mac 基线。三个 Excel 工具的阶段仍为 `development`。

## 逐文件分类与采用决定

`file-classification.csv` 列出 221 个文件的分类、是否变化、采用理由及哈希；79 个文件有差异。分类计数：共享业务/core 与构建证据 177、平台无关 Native 协议 15、Windows 专属 24、Mac 专属 5。每项决策：保留 Mac 权威实现 40、历史资料留在运行载荷外 2、按平台隔离采用 Windows 文件 29、选择性合并且保留 Mac 构建/协议 8。

已选择性采用：高德单 SDK 相机、投影光标锚点、滚轮单位与合并、事件解绑/有限值保护；更新 UI 能力协商、阶段/终态、忙态、错误诊断和同版本防降级；共享 Native 错误与 Python/工作簿入口修复；三工具 allowlist/import 与报告不覆盖修复；严格构建门禁。Native Mac 适配器只回报不支持自动更新并继续手动下载。Windows `update_engine.js` 只由 Windows x64 dispatcher 加载。

保留 Mac adapter/common/launcher、runtime resolver、路径与锁策略、扩展 ID `aamfmhcbjgofhmannejoiilkkpchfkgm`、Native Host `com.appraisal.toolbox.helper`、手动更新方式、土地/拍卖/租赁业务判据与人工验证。排除 Windows PowerShell、注册表、`install.cmd`、SEA 和自动安装链；不放宽验证码、日期、成交判据或坐标来源。

## 构建与验收

平台：macOS 27.0.1 (26A434) / arm64。目标只验证 Apple Silicon；Intel Mac 和其他 macOS 版本未覆盖。构建入口 `scripts/release/build.cjs`，修改前后都要求 `scripts/release/source-checks.cjs`。构建工具 Node v24.14.0、Python 3.9.6；交付 runtime 为锁定 Node v24.14.0、官方 Python 3.14.6。Python 测试使用锁定的 3.14.6；系统 PATH 的 Python 不作为产品 runtime。

最终候选：版本 `0.2.1`，buildId `mac-build16-20261016.3`，buildNumber `2026101601`，源码 `fe41e9f5cbc53265f662a3f9dc75788aadd33dc9`。ZIP SHA-256 `6816b2c8ddaf8b597fcb41bb7a99062c0c1817f229b25d224abd5e5dc855d0df`。源码、144 个载荷文件、ZIP 完整性和 launcher 执行位均已回读。完整结果与下载地址见 `RESULT.md`。

构建命令、隔离安装命令、逐层通过/失败/未覆盖及摘要证据见 `RESULT.md` 和 `evidence/`。真实 GUI/网络和 Windows 防回归关卡见 `WINDOWS_BUILD_GUARDRAILS.md`。

## 签名与边界

产品 ZIP/launcher 未签名，产品未提交 notarization。随包 Node 的代码签名验证 exit 0；官方 Python 3.14.6 pkg 的 Apple 发行者签名及 notary trust 检查 exit 0。它们不能替代产品签名。未覆盖项不因 hash、模拟 DOM 或隔离安装而改记通过。

未触碰正式 Profile、真实地图 Key、凭据或天源系统；未更新 stable/latest、未合并 main。当前没有具体的新功能规格；基线交付后请用户确认首个功能范围。

逐项采用/排除的文件、Mac与Windows影响、回滚和证据映射见 `CHANGE_REVIEW.md`。
