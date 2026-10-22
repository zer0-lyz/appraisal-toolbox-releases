# Mac 更新器实现复审与承接记录（2026-10-21）

本轮范围仅版本更新。工作树 `/Users/lin/Projects/appraisal-toolbox-mac-update-recovery-20261021`，分支 `codex/mac-update-recovery-20261021`，基于正式 `v0.2.3` / `9de4d81ca48f4aa4722775e010ba0f7dad2029b8`。方案见 `MAC_UPDATE_RECOVERY_PLAN_20261021.md`（包含 PR #14 的 33 文件分类）。代码由用户指定的 gpt-6-luna / max 分别执行 backend、installer、UI/protocol；主 agent 独立复审、整合和构建。原 Mac 两个干净工作树及折现率实验均保留，未作为包载荷覆盖来源。

## 天源参考的采用边界

只读参考本机部署的天源工作台 0.14.32 / build 2026100102。其可复用部分是独立后台安装任务、持久状态文件、页面重开查询、完成后扩展 reload。下载地址等配置值不能修复工具箱原有长 Native 连接结束、失去进度或无证据回滚的问题。

记录的参考源码 SHA-256：

| 参考文件（位于 ~/.tianyuan-workbench） | SHA-256 |
|---|---|
| native-helper/update_installer.js | 8a3eeef25f012203bdebdcb6b539a1c1dd7cd96c10514bf8aa14dbf3d325d532 |
| native-helper/update_checker.js | c96f67dfe4c47dc3944c4f572cc963c17498558194f948855e72c0fbe42e5327 |
| native-helper/platform/macos.js | 4044a0853da865be6eaec23e2470aeb94a8c62a683acc96f4ee27ca775d2d783 |
| projects/天源评估系统/extension/src/modules/updates/module.js | bc2fb60431c6fc0cac6e24832b08d0a68e300d52db95a56f702cca202a3c3205 |

未复制其用户配置、凭据、Connector/Bridge 注册；未修改天源源码或部署。工具箱继续使用 `aamfmhcbjgofhmannejoiilkkpchfkgm`、`com.appraisal.toolbox.helper`、`~/.appraisal-toolbox`、工具箱官方仓库与下载校验策略。

## 文件级实现与两端影响

| 文件 | 分类与决定 | 两端影响 |
|---|---|---|
| src/modules/updates/module.js | 共享 UI/协议：依据能力回读后台状态；启动回执与安装成功分开；只有 complete + verified 才 reload，unknown 禁止重装，已核验回滚允许重试。 | Mac 新协议；Windows 未支持状态能力时保留流式协议。共享行为须 Windows 复验。 |
| native-helper/platform/update.js | 共享协议分发：保留 Mac capability，状态白名单，未知状态 fail closed；Windows 不装载 Mac engine。 | 新只读接口在不支持平台返回 capability=false。 |
| native-helper/update_checker.js | 共享协议导出：透传本地状态能力和状态动作。 | 官方检查、平台资产与同版本防降级规则保持。 |
| native-helper/native_host.js | 共享 Native：只新增 get_update_status 白名单和 busy 只读例外。 | 不开放 install_workbench_update、Connector 等继承动作。 |
| native-helper/update_engine_macos.js | Mac 专属：从长连接安装改为后台 worker 启动、持久查询。 | 不修改 Windows update_engine.js。 |
| native-helper/macos_update_worker.js | Mac 专属：后台持锁、重新核对官方目标、下载/SHA/清单校验、真实安装与核验。 | 不移植 Windows guardian/SEA。 |
| native-helper/macos_update_transaction.js | Mac 专属：固定 inode 的 POSIX flock、nonce/root 事务身份、持久状态；外部精确 Python.org 3.14.6。 | 不引入 Global Mutex、SID ACL 或注册表。 |
| native-helper/macos_installer_transaction.js | Mac 专属：独立 installer journal、文件/manifest 快照、恢复后逐项指纹及 Native JSON 自检。 | 与 worker journal 分离，避免并发覆盖阶段。 |
| macos/installer/install.sh | Mac 专属：手动与后台入口串行、阶段写入、保留备份和失败现场、launcher 转发参数。 | 保留 Mac 路径策略与 Chrome/Edge host 标识；不改变 Windows 安装器。 |
| native-helper/*macos*.test.cjs | Mac 回归：真实进程竞争与中断，加故障注入。 | 仅 Mac runner，使用锁定提取 runtime；不将 skip 计为通过。 |
| native-helper/update_status_protocol.test.cjs、scripts/release/update-ui-fixtures.cjs | 共享协议/合成页面回归。 | 两端 Node 执行；不能替代桌面 GUI。 |
| macos/test-isolated-install.sh、scripts/release/test-macos-update-e2e.cjs、verify-package.cjs | 真实包的隔离初装/升级/失败恢复、状态协议和核心导入。 | 全部使用一次性 HOME/浏览器目录和合成数据；不是正式 Profile 验收。 |
| scripts/release/source-checks.cjs、build.test.cjs、.github/workflows/dual-platform-candidate.yml | 共享构建门禁：安装协议标识、跨端协议检查、非发布双端 candidate 构建。 | 不更新 Release/stable/latest；Windows 包需其平台 runner 全量构建。 |

`native-helper/platform/macos.js`、Windows adapter/installer、业务模块不在本轮修改范围。保留 PR #14 的 Windows 实现供 Windows 独立适配，不将其 .ps1、install.cmd、注册表或 SEA 文件当作 Mac 修复。

## 复审中发现并交回执行者的问题

修改前已复现第二次 busy 请求清除首次请求 busy 标志。原 launcher 不转发 --self-test，exit=0 曾只表示 EOF；本轮以真实 JSON 的 ok 和 pythonSkillImportSmoke.ok 为依据。

整合复审还要求修正：Mac /bin/bash 3.2 不支持 coproc；busy 早退也必须发请求终态；启动确认超时不可称安全失败；持锁进程丢失必须停止继续写入；回滚与成功不能只比较版本；未知旧事务和未终态手动安装不能绕过。最终通过数、源码 commit、包摘要、产物链接与未覆盖项在构建完成后追加。

## 回滚与部署边界

本 PR 未部署到正式用户目录。源码回退使用独立后续 revert commit（不得 reset 原工作），重新从干净源码构建；候选安装器保留原安装快照与 manifest 快照，失败恢复须先证明安装进程不再写入，再核验字节/路径/Native 自检。unknown 保留现场并阻止重复安装，不能删 journal 或锁文件伪装 idle。

产品候选仍为 0.2.3 / buildNumber 2026102101，channel=candidate、runtimeBuildKind=local。产品未签名、未 notarize；供应商 Node/Python 的签名不代表产品签名。官方源完整更新、普通桌面安装、真实 Chrome/Edge 重载与 Gatekeeper 未获实测证据前保持“未覆盖”。

## 2026-10-22 整合复核（构建前）

主 agent 已独立跑完整 Mac suite：38/38、0 skipped；其中包括安装根临时 rename 时只读状态继续借助受信的外置 Python 查询 flock，锁释放/worker 消失仍返回 unknown。外置 Python 只取固定受信 framework（隔离测试用明确注入的提取框架），不执行 journal 提供的路径。Luna 原任务已交付 UI/协议、安装器、后台及其 focused 回归；最后的状态查询边界由主 agent 补齐并验证。

共享 source-checks 16 项通过，更新页 22 个 synthetic DOM 场景通过；这些不作为真实 GUI 证明。新 worker 13 项使用合成包/安装故障注入，真实安装和恢复 helper 有独立 7 项（包含 SIGKILL 存活子进程、complete 后恢复、已回滚结果重放）；engine 8 项包含真实父进程退出后的后台继续运行。此前 37 项还曾用原始锁定基础包提取的 Python 3.14.6 跑完且 0 skipped。最终真实包安装/升级/回滚和源码提交、ZIP SHA 将在构建后补充。

首次真实包隔离运行发现 worker 已创建下载/解压/log 目录，而安装器仍要求该目录完全为空，导致委托安装在改动安装树前以 INSTALLER_JOURNAL_ALREADY_EXISTS 停止。该候选未通过且不作为交付包。已将 worker 模式的既有文件限制为 extracted/update.zip/installer.log，保留 nonce/root/锁验证和不覆盖既有 installer journal 的门禁；手动入口仍要求空目录。补充真实 begin-helper 回归，最终 Mac suite 39/39、0 skipped；使用新干净 commit 重新构建 r2。

随后整组运行中的一个手动回滚 fixture 读到了尚未写完的 lock-status JSON，首次为 38/39；该轮不是 39/39。锁控制状态已改为 fsync 后原子发布，重新完整运行实际为 39/39、0 skipped（root-macos-tests-final.log）。最后交付采用包含此修复的更新源码重建，先前候选 SHA 不沿用。
