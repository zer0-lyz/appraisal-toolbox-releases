> 2026-10-12 Mac接收增补：统一入口/根两目标锁/缓存/manifest/双平台CI已落地；当前结果以 [MAC_EXECUTION_STATUS_20261012.md](MAC_EXECUTION_STATUS_20261012.md) 和 [UNIFIED_BUILD_RUNBOOK.md](UNIFIED_BUILD_RUNBOOK.md) 为准。以下内容保留Windows历史交接的时间边界；不得把旧“待实施”状态当成当前状态，也不得把新CI通过等同GUI/完整安装全面通过。

# 双端开发和发布方案

目标：公共业务修复只做一次；Windows/Mac 在同一源码 commit 上各自产出；每轮可以复用可证明未变化的 runtime；首次安装、升级和 GUI 证据先于正式发布。

## 1. 单一源码与责任

- main：经过双方审查的共享代码；feature/<issue>：一个问题或可解释的一组问题；release/<version>：冻结候选；禁止在发布包上改完不回写 Git。
- Mac agent 负责共享业务实现、macOS arm64 runtime/installer/signing；Windows agent 负责 Windows x64 adapter/SEA/installer/安装实机；公共 core/native/skills 变更双方审查。
- 恢复源码先通过本次 PR 对比 Mac 权威源，不能覆盖 Mac 特有实现。shared: src/core、modules、skills、Native protocol；platform: native-helper/platform 和各自安装器。产品 ID、host name、协议 schema 保持一致。
- 原加载目录就是原插件，升级前全量备份和逐文件清单。无需另建“fix插件”或更换扩展 ID。

## 2. 确定构建输入

- 每候选一个 productVersion、buildId、sourceCommit；installerBuild 独立，自动从安装器读取；protocol version 独立协商，不随打包 suffix 随意变更。
- release-inputs.lock.json 锁 Node/工具/runtime基础资产摘要；目标平台分别锁 portable Python 版本、离线 wheel 版本和每文件摘要，不靠系统 PATH。
- 同一 sourceCommit 构建 Windows x64 和 Mac arm64。manifest 记录 target、源码 commit、inventory、Node/Python/工具摘要、Native bundle/二进制/ZIP摘要、签名状态和 evidence 引用。
- 本次历史包是例外：新 commit 承接旧包的源码 inventory，原 provenance 保留未提交修复事实，不能改写成“新 commit 构建”。以后禁止 dirty tree 正式构建。

## 3. 构建入口与缓存（首批实施任务）

提供 build 命令或 npm script 的统一参数：target/version/buildId/output/reuse-runtime/reuse-native；统一 installerBuild解析、干净tree检查、相对路径manifest。目前是方案待落地，已有入口见 BUILD_RUNBOOK。

缓存分层：下载资产按SHA、Node工具按lock、Python/wheel按target+lock、Native按target+Node+bundle SHA。缓存命中仍验摘要；Native业务未改只重封装安装器，Python依赖未改不重装wheel；HTML/前端变化不能偷复用旧extension。

输出目录必须新建；构建从仓库与锁资产组成，不从已安装用户目录拷贝，不夹带 runtime-config、Key、history、Profile、installation-report。临时输出/SEA/工具不进源码仓库。

## 4. CI 与实机验收分工

| 层 | 所属环境 | 发布门槛 |
|---|---|---|
| 源码审查/锁/inventory/静态接口 | PR，Windows/Mac job | 无秘密、协议兼容、模块依赖、变更影响列表 |
| build+offline self-test | Windows x64 runner / Mac arm64 runner | 无env4入口导入、打包EXE实际启动、中文/空格/方括号路径、Excel回读 |
| disposable安装/升级/失败回滚 | 可回滚 VM / 专用测试账号 | Chrome/Edge独立注册、缺键退出失败、旧版本/用户文件保留、受限上下文拒绝 |
| GUI/真实网络 | 两平台隔离真实浏览器 | 业务4模块、当前窗口结果页、高德、历史/清空/console；验证码由人完成 |
| 签名/发布 | 受控release流程 | Windows Authenticode、Mac codesign/notarization状态明确；未签名不可标已签名 |

GitHub托管 runner不能替代真实MSIX/桌面/登录态。机器无隔离环境时写未覆盖，正式发布门槛不降低。自然expired路径与表格GUI确认继续补证，不为验收写测试后门。Anjuke/折旧转正另开验收任务。

建议CI先手动 workflow_dispatch，审查完成后接 pull_request（只读权限）；发布单独受控 workflow+environment approval。外部PR不运行带写权限/秘密的脚本，不用 pull_request_target 执行不可信代码。本次未配置新CI/branch protection/付费runner；下面任务需agent执行后回报，不能说已自动化。

## 5. GitHub 协作协议

- 协调 Issue 固定列包SHA、PR、双方负责人、共享 commit、待办及验收矩阵；Mac agent 在该 Issue 回报 findings/修复branch/PR/产物SHA/证据类型，不另散落聊天。
- 一个缺陷一个 Issue：复现、实际结果、预期、根因证据、受影响平台、验收条件。Windows故障必须附上下文范围，禁止从子进程读回猜“真实桌面”。
- PR使用模板：关联Issue，改动影响，两端验证表，未覆盖/风险，构建来源，回滚方法。跨端公共改动合并前至少等待另一端回报受影响项。
- 不可丢失修复：候选发布前确认所有已验修复在共享commit、两个adapter均继承；平台热修先在branch交付，再合并，避免下轮Mac覆盖Windows修复。
- 发布tag不可复用/覆盖；资产filename含target/build；stable更新manifest只在双方正式门槛满足后更新，本次prerelease不更新latest通道。

## 6. 分批落地与完成条件

| 顺序 | 工作 | 负责人 | 可验收成果 |
|---|---|---|---|
| P0（本次） | Windows包/源码修复/手册公开交接、建立Issue/PR | Windows agent | 可下载资产+SHA、代码review分支、协调入口 |
| P1 | Mac权威源码比对，携带Windows公共修复；Z2和完整安装补验 | Mac+Windows | Mac review回复、Z2修复PR、安装/回滚真实证据 |
| P1 | 统一入口/provenance/相对manifest，双端runtime锁、依赖缓存 | 两端各自adapter | 一条命令从干净clone得到完整包；输入/输出hash可追溯 |
| P2 | 双目标CI、无env导入/Excel/installer分层门槛 | 两端+仓库维护者 | 同commit两产物，CI日志及隔离实机报告齐全 |
| P2 | 升级/回滚、签名/notarization与stable门禁 | 平台维护者 | 不损坏用户配置，签名真实可查，正式发布清单 |

每步不以耗时许诺完成，按产物和证据验收。下一轮主要节省来自锁定runtime、复用未变Native、源码同步与一键入口，而不是减少实机验证。
