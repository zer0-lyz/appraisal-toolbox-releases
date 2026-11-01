# v0.2.4 双端更新模块整合基线

## 版本与来源

- 当前正式版：`v0.2.3`，共同源码提交 `9de4d81ca48f4aa4722775e010ba0f7dad2029b8`。
- 本次目标：`v0.2.4`，共同 buildNumber `2026102201`，tag `v0.2.4`。
- 整合来源：Mac 更新恢复 PR #15（head `f6b49210bb7a3e3575aa660127e0f68695aa9bd8`）与 Windows 事务修复 PR #14（head `9f09d1c195232d2c1f1e2c13e6b154281fb672bc`）。两端必须以合并后的同一源码提交分别构建。

## 平台边界

- 共享 `src/modules/updates/module.js` 使用平台能力协商与安全失败提示。Mac 支持持久状态轮询，只有 `complete + verified=true` 才提示成功并请求扩展重载；Windows 保留已部署的 stream 协议并使用 Windows 事务诊断状态。
- Mac adapter 使用 POSIX 文件锁、后台 worker、安装 journal、Python.org runtime 与 Mac 安装回滚流程。
- Windows adapter 保留 Global Mutex/SID ACL、PowerShell guardian、Windows transaction journal、注册表/Native Messaging 核验与 SEA 构建。
- Windows PowerShell/注册表/SEA 与 Mac 文件锁、安装器和 runtime 均不得跨平台替换。

## 构建门禁

主线 PR 检查由 `.github/workflows/dual-platform-candidate.yml` 在 macOS arm64 和 Windows x64 分别执行。合并后使用同一 workflow 的 `workflow_dispatch` 输入 `version=0.2.4`、`build_number=2026102201`、`channel=stable` 生成两个 Actions artifact；该 workflow 只构建和保存产物，不发布 Release、不移动 Latest。正式发布资产必须使用这次主线提交的两份稳定构建结果。

发布前合并的门禁包括共享 source/business regressions、更新 UI fixture、Mac updater 测试、Mac 隔离安装/升级/回滚/Native protocol，以及 Windows SEA 导入/Native protocol 和 Windows updater transaction tests。任何失败都停止发布并修复后重建。

## 验收边界

- fixture、CI、隔离安装、协议回环和 SHA 核验不能代替普通桌面验收。
- Windows 真实桌面安装与一键更新、官方 Release 源完整在线更新、Chrome/Edge 扩展 reload、真实配置保留均保持未覆盖，直至 Windows 实机证据补齐。
- Mac 普通桌面安装、GitHub 官方源完整在线更新、真实浏览器 reload 与 Profile 配置保留仍需实机验收。
- Mac 产品 launcher 未签名、未 notarize；Windows Native SEA 未签名。发布说明必须如实显示此状态。
- 不读取/上传浏览器 Profile、账号凭据或真实地图 Key，不操作天源系统。
