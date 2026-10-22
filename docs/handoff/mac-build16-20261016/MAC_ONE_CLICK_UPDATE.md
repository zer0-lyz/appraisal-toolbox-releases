# Mac 一键更新设计与验收边界

本次先完成 macOS Apple Silicon 更新链，再由 Windows x64 在同一源码提交上使用独立适配器构建。产品版本与全局 `buildNumber` 两端一致；`buildId`、Native 进程和安装器按平台区分。候选包只作审查与分层验收，不替换 stable/shared latest，也不合并 `main`。

## 更新流程

版本页先由现有官方发布检查器给出平台能力、正式版本、包大小与 SHA-256。用户点击“一键下载并更新”后，Mac Native Helper 再向 `zer0-lyz/appraisal-toolbox-releases` 复查目标；只接受当前 Apple Silicon 正式包和官方下载域名/允许的 GitHub CDN 跳转，要求用户界面提交的 SHA 与复查结果完全相同，并阻止版本或 buildNumber 降级。

更新器下载到 `$HOME/.appraisal-toolbox-updates`，限制网络重试和下载时长，校验文件大小/SHA-256、包内 `SHA256SUMS`、来源清单、输入锁、干净源码 provenance、扩展 ID 和安装器版本。随后调用原有 `安装.command`：保留安装目录中的地图配置、缓存、历史、用户文件和工作簿，离线配置锁定 Python 依赖，原位更新扩展/Native/技能目录，写回 Chrome 与 Edge Native Host 注册，并运行包内 Native/Python 自检。安装器用 staging + 旧目录备份进行替换；错误或可捕获中断会恢复原目录及注册清单。更新器再核对安装报告、版本、ID、两个浏览器清单和 Native 自检，成功后自动重新加载扩展。

长安装阶段会周期性发送进度；若 Mac 浏览器面板提前断开，Native Host 仍等当前事务结束并释放自己的锁。意外终止留下的锁会在确认其 PID 已不存在后回收；活动锁与符号链接不删除。失败保留安装日志并回报当前版本状态。不会读取账号凭据、浏览器 Profile、令牌、地图 Key 或天源数据。

## 两端边界

`native-helper/update_engine_macos.js` 只负责 macOS；`native-helper/update_engine.js` 保持 Windows x64 的独立安装器、PowerShell、注册表和 SEA 路径。Mac 不加载 Windows 引擎。共享更新页只负责能力协商、阶段显示和安装完成后重载扩展；不把 Windows 安装逻辑搬入 Mac。Windows 需要从同一源码提交构建，使用相同产品版本和 buildNumber、Windows 专属 buildId，并在真实 Windows 桌面复验安装成功/失败与 Chrome/Edge 链路。

## 支持范围与失败回退

- 当前 Mac 自动更新能力限 Apple Silicon。Intel Mac 继续显示正式下载页。
- 更新前要求现有安装中的 Python 3.14.6 runtime 可运行且包含 `ensurepip`/`venv`。若 runtime 已损坏，自动链会在替换前停止；使用完整安装包修复。
- 更新源当前只接受正式发布。Prerelease 候选不会被默认更新检查器安装。
- 更新包与 launcher 仍为未签名候选，未提交产品 notarization。源摘要及包内清单校验不能代替 Apple 产品签名。

## 可复现验证入口

- `node scripts/release/source-checks.cjs`：业务/Native/构建回归与更新引擎协议单测。
- `npm ci --ignore-scripts --no-audit --no-fund --prefix scripts/release/test-tools` 后运行 `node scripts/release/update-ui-fixtures.cjs scripts/release/test-tools/node_modules <summary.json>`：真实更新模块的合成 DOM，检查手动回退和两端重载；不代表 GUI 验收。
- `bash macos/test-isolated-install.sh <package-root> <new-test-directory>`：隔离初装/升级/用户数据保留/Edge 注册失败回滚/Native 协议，并通过真实 Mac 更新器驱动包内安装器完成一键更新回归；只使用临时 Python framework 和模拟浏览器目录。
- 普通桌面更新、Chrome/Edge 扩展重载、真实 Native Messaging 浏览器链和 macOS Gatekeeper/notarization 均需另外记录实机证据。

## 2026-10-21 更新：后台任务与可核验恢复（PR #15）

上文长 Native 流及按 PID 回收目录锁的描述是 `macos-transactional.1` 历史实现，已在本轮候选替换。新实现沿用天源工作台的后台 worker、持久状态查询与页面轮询模式；不复制工作台配置或身份。Mac 用固定 inode 的 POSIX flock 和两个分工明确的 journal，保留快照；PID 消失不授权删锁或覆盖恢复现场。

`get_update_status` 是能力协商后的只读动作；启动回执只表示 accepted/starting，不能当成安装成功。完整安装、自检与身份/配置/manifest 核验后，`complete+verified=true` 才触发当前浏览器扩展重载。已核验回滚允许重试，unknown 保留现场并阻止重复安装；页面重开和流断开仍查询状态。最终成功的扩展 reload 请求与真实重载后握手分开验收。

锁 runtime 必须解析到外部 Python.org 3.14.6，不借用系统 PATH；独立测试显式使用锁定包提取的 Python.framework 和对应 DYLD_FRAMEWORK_PATH。手动完整安装与 UI 后台安装使用同一锁，Mac 自带 Bash 3.2 兼容。candidate 构建仍为 0.2.3 / 2026102101，无 Release/latest 切换。完整分类、构建和分层证据见 `../MAC_UPDATE_RECOVERY_REVIEW_20261021.md`。
