# Mac 更新模块审查与执行方案（2026-10-21）

## 已授权范围与来源

用户要求先审查、制定方案，再交由 gpt-6-luna / max 执行；仅更新模块、Mac 适配器、安装器、相关协议/构建与回归。可创建独立草稿 PR，并在 Issue #1 / PR #14 回报；不合并 main、不发布 Release、不更新 stable/latest、不修改本机正式安装或浏览器 Profile。

- 原 Mac 权威接收树：`/Users/lin/.codex/.chatgpt-projects/g-p-6ac741e8cbd88191a769c18faf282675/mac-handoff-20261012`，分支 `codex/mac-main-handoff-20261012`，HEAD `76584a3410732cea93a26dd923a1a373619f7a0d`，干净。
- 原 Mac 功能树：`/Users/lin/Projects/appraisal-toolbox-mac-build16-20261016`，分支 `codex/mac-one-click-update-20261016-pr`，本地 HEAD `026822cf9d167876f6477d540fb737597ba8eaa6`，干净，保留原位。fetch 后远端 PR #12 head 为 `f5c594de3bb7081b14ddda6131808251a468101a`；本地提交是其祖先。
- 更新后的正式产品源码基线：tag `v0.2.3` / `9de4d81ca48f4aa4722775e010ba0f7dad2029b8`，继承 PR #12。以此建立独立树 `/Users/lin/Projects/appraisal-toolbox-mac-update-recovery-20261021`，分支 `codex/mac-update-recovery-20261021`。不以折现率实验目录或已安装目录组包。
- Windows PR #14：base `f5c594d`，head `9f09d1c195232d2c1f1e2c13e6b154281fb672bc`，33 个变更文件；完整 diff 和三份交接文档须逐文件读完。
- Mac `update_engine_macos.js`、`platform/macos.js`、`macos/installer/` 在 PR #12、v0.2.3、PR #14 间无差异。
- 环境：macOS 27.0.1 / 26A434、arm64、Node v24.14.0、Git 2.50.1、python.org Python 3.14.6。本机直接执行已安装的 Node + native_host.js --self-test 返回有效 JSON，ok / pythonSkillImportSmoke.ok 均 true；不构成 GUI 验收。
- 证据根：`/Users/lin/Projects/appraisal-toolbox-update-evidence-20261021`。修改前 Mac engine 2/2 通过：`baseline-macos-engine.txt`；直接 Native 自检：`installed-host-self-test.json`。

## 新读取的 CI 状态

PR #14 Actions run 20 = `39563782597` 已 completed/success，两个平台 job 均成功，包含构建与 artifact 上传步骤。当前列有两个 exact-head artifact：Mac `12328283359`、Windows `12329121918`。交接时“没有最终 head 新包”属于当时状态；本次在下载核对清单/ZIP SHA/sourceCommit 前，只记录 artifact 存在，不把它当作新 Release 或实机验收。
https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/39563782597
PR #12 / #14 review bodies 当前为空；PR #14 discussion comments 当前为空。Issue #1 最新交接评论 `6310700567` 已读。

## 初审问题（由执行 agent 增加复现，不能直接称为实机根因）

| 优先级 | 文件/位置（v0.2.3） | 问题与需要证明的性质 |
|---|---|---|
| P1 | update_engine_macos.js:155-179 | 旧 owner/installer PID 消失即递归移除锁，未证明安装子进程树终止或事务已恢复；两个回收者也可能相互删除新锁。 |
| P1 | update_engine_macos.js:517-740 | 同实例第二次 busy 请求也经过 finally 设置 updating=false，可能破坏首个事务 busy/Native 生命周期。 |
| P1 | update_engine_macos.js::runProcess | 子进程启动后才写 owner PID；启动写入失败、SIGKILL、进程组后代、close 事件都没有持久事务证明。 |
| P1 | install.sh:28-64 / updater:680-729 | rollback set +e 后无 readback，却无条件称恢复；EXIT 删除 manifest 快照；日志推断 rollback 仅比版本，结果被忽略，大多失败仍清锁。 |
| P1 | module.js / Mac engine | recoveryBlocked 仅页面内存；重新打开页面不能读回事务；失败文案说状态已核验但可能 unknown。 |
| P2 | install.sh:152-160 | launcher 不转发参数，launcher --self-test 的 exit=0 实际可能是 EOF 退出。此前此项证据更正；必须断言真实 JSON，不只检查退出码。 |

## 天源工作台参考（用户追加要求）

只读参考实际部署的 `~/.tianyuan-workbench/native-helper/update_installer.js`、`update_checker.js`、`platform/macos.js` 和 `projects/天源评估系统/extension/src/modules/updates/module.js` / version.json。观察到产品 0.14.32，buildNumber 2026100102，channel stable。执行时先记录这些源码 SHA，源版本可能变化。`/Users/lin/Projects/tianyuan-browser-workbench` 有未提交工作并与 origin/main 分叉；不修改、checkout、fetch 或把它当工具箱构建源。

已查到可参考的流程：持久状态文件、getStatus 读取、独立后台安装 runner、安装启动回执、页面轮询阶段、完成后 reload、local runtime fingerprint 避免重复修复。工具箱目前把整个安装绑定在长 Native 流内，缺少可靠重连和恢复状态。

复用这些生命周期和状态协议模式，保留工具箱官方下载源/URL/SHA/包清单/ID/Host/路径验证。不得复制天源 runtime-config、tokens、Connector/Bridge 注册、凭据代码、Profile、真实地图 Key；不调用天源服务、不更新工作台。天源原实现中无条件 currentVersionUnchanged 或靠状态超时推断失败的部分也应按证据改进，不直接沿用。

## PR #14 逐文件归类与处理计划

“已在 v0.2.3”只表示源码已有该字节/修复，不能重复声明成新修复。完成后另外更新实际采用表和最终 SHA。

| 文件 | 分类 | Mac 处理 |
|---|---|---|
| .github/workflows/dual-platform-candidate.yml | 共享构建 | 新分支改为 candidate/local、显式递增 buildNumber；同 commit 双端构建，仅 artifacts。 |
| docs/handoff/PLATFORM_UPDATE_COMPATIBILITY.md | 共享协议文档 | 更新 Mac 的状态/锁/恢复兼容与未覆盖。 |
| docs/handoff/WINDOWS_FIX_ADOPTION.md | 承接文档 | 选择性补充本轮实际采用/拒绝及证据。 |
| docs/handoff/WINDOWS_UPDATE_LOCK_REVIEW_20261021.md | Windows 交接 | 作为参考，不伪造 Mac 实现或 Windows 验收。 |
| manifest.json | 共享版本 | v0.2.3 已有；不照抄旧版本/发布状态。 |
| native-helper/process_launcher.js | 共享启动器 | 默认 args 修复在 v0.2.3 已有，保留。 |
| native-helper/update_engine.js | Windows adapter | 不移植；Mac 独立实现对应安全性质。 |
| scripts/release/audit-existing-package.py | 共享构建核验 | 评估精确 inventory/SHA readback 的通用部分，按需要最小采用。 |
| scripts/release/build.cjs | 共享构建 | 保留 v0.2.3 元数据支持；不引入不相关 Windows 变更。 |
| scripts/release/build.test.cjs | 共享构建回归 | 只增加采用的打包检查与 Mac 源覆盖。 |
| scripts/release/package-macos.py | 实际为共享 ZIP 工具 | 评估最终 ZIP 精确 inventory/内容核验；Windows MAX_PATH 不能冒充 Mac 修复。 |
| scripts/release/source-checks.cjs | 共享测试入口 | 接入平台相符的 Mac 回归；Windows 测试维持平台隔离。 |
| scripts/release/update-engine-timeout.test.cjs | Windows 回归 | 不复制成 Mac 通过证据，独立 Mac 故障注入。 |
| scripts/release/update-lock-process.test.cjs | Windows 回归 | 仅参考测试性质，Mac 真实进程竞争另建。 |
| scripts/release/update-recovery-context.fixture.ps1 | Windows 回归 | 排除。 |
| scripts/release/update-recovery-context.test.cjs | Windows 回归 | 排除。 |
| scripts/release/update-transaction-identity.test.cjs | Windows 回归 | 排除，Mac nonce/root 绑定独立验证。 |
| scripts/release/update-ui-fixtures.cjs | 共享 UI 回归 | 选择吸收文案诊断，扩展 Mac busy/recovery/reload 场景。 |
| src/modules/updates/module.js | 共享 UI/协议 | 选择吸收 recovery 中文提示；按能力增加 Mac 状态回读，兼容 Windows。 |
| version.json | 共享版本 | 保留 0.2.3，候选 buildNumber 使用 2026102101，不伪装 stable。 |
| windows/build-windows-fix2.cjs | Windows 构建 | 排除本轮适配。 |
| windows/diagnose-update-lock.cjs | Windows 诊断 | 不复制；需要时新增 Mac 本地只读脱敏诊断。 |
| windows/finalize-alibaba-module-package.cjs | Windows 构建 | 排除。 |
| windows/finalize-windows-fix2.cjs | Windows 构建 | 排除。 |
| windows/installer/INSTALL.md | Windows 文档 | 仅参考边界。 |
| windows/installer/extension-deployment.ps1 | Windows 安装 | 排除。 |
| windows/installer/install.ps1 | Windows 安装/恢复 | 排除，不把 Windows guardian/Mutex/SID/registry 移植到 Mac。 |
| windows/installer/registration-context.ps1 | Windows 上下文 | 排除。 |
| windows/installer/verify-desktop-registration.ps1 | Windows 验收 | 排除。 |
| windows/installer/verify-registration.ps1 | Windows 验收 | 排除。 |
| windows/tests/final-artifact-check.cjs | Windows 验收 | 排除。 |
| windows/tests/update-transaction-identity.test.ps1 | Windows 回归 | 排除。 |
| windows/tests/verify-registration-boundary-fixture.ps1 | Windows 回归 | 排除。 |

Mac 新修改范围主要为 `native-helper/update_engine_macos.js`、其测试、新的 Mac 锁/事务辅助模块、`macos/installer/install.sh`、`macos/test-isolated-install.sh`；共享协议必要时涉及 platform/update.js、update_checker.js、native_host.js 与 updates UI。逐项说明，不修改业务模块。

## 分阶段实施与验收门槛

1. 首先固定参考源码 SHA、完整读完 PR #14 差异；补充修改前失败复现。保持下载安装 URL/SHA/provenance、同版本防降级和 Apple Silicon 能力边界。
2. 借鉴天源的后台安装 + 持久状态回读。Mac 用自己的 POSIX 文件锁/进程生命周期模型串行化同一 canonical root；优先使用已锁定 Python 的 fcntl 或可证无回收竞态的原生机制。持久 nonce/root/阶段 journal 位于安装树外，启动安装/恢复前先持久记录，不能靠 PID 消失、kill 返回或父进程 close 推断终态。结果未知保留现场、拒绝重复安装，提供只读状态/诊断；同实例 busy 请求不得清除原事务 busy。
3. 安装器在移旧目录、部署、注册、提交与回滚边界写 journal；快照和旧版备份在确认恢复前保留。恢复必须绑定 nonce/根/原版指纹并核验旧文件、Native manifest、配置/合成用户数据和实际自检。回滚失败不能显示“已恢复”；清锁必须证明本事务终态并校验 ownership。保留对旧包的明确兼容门禁，不能宣称旧 installer 已有新协议。
4. UI 能力协商后回读 busy/recovery/unknown/rolled_back/complete，页面关闭重开和 Native 流断开能恢复状态。只有已核验成功才请求当前浏览器 extension reload；请求 reload 和重载后版本握手分开，未获握手不称 GUI 通过。Windows 未支持新状态动作时保持原行为。
5. 回归必须覆盖：同实例并发、至少 4 个真实进程锁竞争、父/子进程中断、启动前 journal 写失败、安装超时和 TERM/KILL、不确定结果拒绝重入、错误 nonce/root、旧 PID/无 owner、安全回滚和回滚失败、页面重开、流丢失、success-only reload、launcher 参数转发及 JSON 自检。故障注入只在临时 home/browser/runtime；不得作用于真实安装或 Profile。
6. 先测试并提交干净源码，再用统一入口构建，运行真实包隔离初装/升级/回滚与 Native 协议。产品版本仍 0.2.3，候选 buildNumber 2026102101、channel candidate、runtimeBuildKind local；后续 Windows 适配沿用共同 commit/版本，adapter 单独审查。

建议构建命令（输出必须新目录）：

```bash
node scripts/release/build.cjs --target macos-arm64 --version 0.2.3 --build-id mac-update-recovery-20261021 --build-number 2026102101 --channel candidate --runtime-build-kind local --output /Users/lin/Projects/appraisal-toolbox-update-evidence-20261021/candidate-build --cache /tmp/toolbox-build-cache
bash macos/test-isolated-install.sh <package-root> /Users/lin/Projects/appraisal-toolbox-update-evidence-20261021/candidate-validation
```

构建须记录 sourceCommit/dirty、运行时/工具版本、Native JS SHA、ZIP SHA 和签名状态。现有产品 launcher/ZIP 未签名、未 notarize；不得通过移除 quarantine 或修改签名策略声称通过。候选 URL 由非发布 Actions artifacts 提供；无 artifact 时只报告本地产物，不能伪造 URL。

执行由 Luna max 完成代码、回归、干净源码提交、本机候选构建、分层报告；主 agent 独立复审并重跑关键检查后推送 Mac 草稿 PR（建议 base `codex/release-v023-20261018`），回报 Issue #1 与 PR #14。两端共享源码最终合流需单独 review，本轮不合并。

真实 Chrome/Edge GUI、官方发布源完整一键更新、macOS Gatekeeper/notarization、Windows 桌面与配置保留若未实际完成，一律未覆盖。当前官方最新与本机同为 0.2.3，不能强行降低/改写发布清单制造“在线升级成功”。浏览器工具此前阻止 chrome:// 内部页面且禁止绕过，继续遵守。
