# Windows 修复承接与 Mac 源审查（2026-10-12）

审查对象：PR #4，实际交接 HEAD `8cde0ea68102a560ee7158190c48d1599fd13a00`，不是 main。此分支直接继承该 commit 的全部共享载荷；下表的“承接”表示代码在共同祖先/当前树中存在，不代表 Mac GUI 或 Windows 新构建已通过。

Mac 历史生产输入：官方 v0.2.1 Mac ZIP `4570d0fa51a0284fbee1f5157731fc7bd311fae9402da4cbe896f2acdeaa792c`。历史源码快照 `328acaca898ab16cd234df0f8c25a6f3120db3cc`，本机 `/tmp/ty-full-installers-20261009-67nPrf/source-git`（干净）。历史生产包含包内修订，不能声称它由该干净 commit 原样构建。发行包恢复来源保留原文。

本机开发实验目录 `/Users/lin/Projects/Codex/评估工具箱-折现率-v0.1` 同基线但有未提交改动，25 个文件已在本任务独立备份及摘要登记；未 reset、未改动该目录。折现率实验迁入新共享源是后续独立任务，不能覆盖本轮公共修复。本任务新的共同权威源为 `zer0-lyz/appraisal-toolbox-releases` 的 Mac 接收分支；Mac 发行构建不得再取实验目录或天源构建目录的业务源。

`mac-source-comparison.json` 逐文件列出 native-helper/skills 52 项：33 项完全相同、19 项不同。`platform/macos.js`、`platform/common.js`、`process_launcher.js` 完全相同，保留原字节；不同共享文件按下表审查，继承 Windows 公共修复。Mac 原安装源码从上述摘要核对的官方 ZIP 恢复并纳入 `macos/installer/`；新构建入口以共享源与锁定官方 runtime 组包，属于新增可复现实现，不伪称找到了历史未归档组包脚本。原通用天源 release 脚本不作为工具箱构建入口。

| Windows 修复/问题 | 共享文件 / 函数（以函数检索为准） | Mac 适用性与承接 | 回归及证据边界 |
|---|---|---|---|
| 隔离 Python 同目录 import | `skills/zj-land-publicity/land_publicity_runner.py` 的脚本目录自举；`native-helper/native_host.js::runPythonSkillImportSmokeTest` | 保留；Mac 也由交付解释器独立进程导入四入口 | 打包 host `--self-test`，Windows ._pth 实机另验 |
| 内层 engine、中文输出 | `skills/depreciation-capex-forecast/scripts/workflow.py::run_workflow`；Native 各 runner 的 `-X utf8 -u` | 保留 `sys.path` + runpy、UTF-8 参数 | 中文/空格/方括号路径；真实引擎/并发单独验 |
| Excel Python 单一解析 | `native-helper/runtime_config.js::loadRuntimeConfig/resolvePythonBin`；`alibaba-auction.js::writeResultExcel`；`alibaba-lease.js::writeResultExcel`；`depreciation-capex-forecast.js` | env > config > platform，保留 Mac adapter；安装 launcher 不再强制 PYTHON_BIN/skills 覆盖 | 真实安装配置、清除覆盖变量、NM Excel + openpyxl 回读 |
| 脱敏中文诊断 | `native-helper/diagnostics.js::redactDiagnosticText/buildRunnerDiagnostics/pythonExportFailure`；`src/core/native-errors.js`、`user-errors.js` | 保留 exitCode/尾部20行；本 PR 将修复提示按平台选安装入口 | 合成 token、失败路径、中文原因；不上传原始 stderr/命令源码 |
| 所有 runner stderr | `native_host.js::runPrintFormat` 与土地 runner；`anjuke-property.js`；`depreciation-capex-forecast.js` | 保留 diagnostics 收集与真实退出码 | 故障注入及 bounded tail；正常 NM stdout 仅 framing |
| 工作簿并发/占用 | `src/background/service_worker.js::depreciationNativeQueue`；`src/core/native-messaging.mjs::createSerialQueue`；`workflow.py::_single_workbook_operation_lock`、替换退避 | 两平台分支保留（Mac fcntl / Windows msvcrt），队列不消耗请求时限 | 同路径跨进程锁/替换单独回归；仍开发中，GUI 未覆盖 |
| 长抓取30秒误超时 | `src/core/native-messaging.mjs` 的 connected port/活动计时；各业务流 | 保留任务预算/取消与分类，不退回单请求30秒 | 协议/夹具不代表长网络 GUI 成功 |
| 拍卖历史按钮 | `src/modules/alibaba-auction/module.js::renderNetworkGate/renderResults` 与历史/清空 handler | 保留，禁止恢复未定义 setResultButtons | round2 UI fixture 执行真实模块回调；Mac GUI 另验 |
| 当前浏览器结果页 | `src/core/browser-results.js::openHtmlResultInCurrentBrowser`；Native 各业务 open-path handler | 保留当前 windowId/验证 file URL；Mac `/usr/bin/open` 仅用于桌面文档 | 组件测试、实际 NM URL；浏览器标签页实机另验 |
| 高德配置/静态再生成 | `native-helper/amap-map.js`；`map-assets/amap-only.js`；`skills/map-shared/amap_support.py::load_map_config/browser_script` | 保留 Key-only、顶部一次缺配置提示、响应式；不改原坐标/Excel/history | map settings 和生成器合成配置；真实 Key 地图不在本任务自动填写 |
| 阿里登录/验证等待 | `src/core/alibaba-page-state.js::classifyAlibabaPage/isAlibabaExpiredVerificationUrl`；两模块 manual wait | 保留共同分类器、5分钟期限、expired 分类 | 页面信号14例/缩放时钟/真实入口夹具；自然 expired 未覆盖 |
| 租赁日期/页数/本场成交 | `src/modules/alibaba-lease/module.js` 的详情判定/列表预筛/`runCurrentTabScrape` | 保留严格本场成交、零结果不放宽不覆盖、未证实排序不提前停 | lease outcome fixture；Windows 40→1 实测仍为 Windows 历史证据 |
| 输出→确认→抓取流程 | 两阿里 `template.js` + `module.js`；`src/modules/table-format/module.js` | 保留布局、占用反馈、overwrite 二次确认 | 实际模块 DOM fixture，GUI 取消/确认仍另验 |
| 健康/历史时间/窄面板/开发角标 | `src/shell/shell.js`；`src/core/module-registry.js`；`user-errors.js::localizeHistoryLabel` | 保留四业务+开发二卡+辅助二入口；不转正安居客/折旧 | 前端回归；Windows GUI 历史结果不复制为 Mac |
| 独立身份/路径 | `manifest.json` 固定 key；`native_host.js`；`depreciation-capex-forecast.js::defaultWorkingPath/isLegacyProjectPath`；platform adapters | ID/host 不变，不读写天源；TIANYUAN_* 兼容名称保留 | 独立新测试根、身份/manifest/来源检查 |
| Windows 特殊路径复制 | `windows/installer/install.ps1` 字面枚举/.NET Copy；新 ZIP 入口 UTF-8 | Windows 实现原样承接；Mac 使用 ditto，候选 ZIP 文件名/执行位准确 | Windows 中文/空格/[Content_Types] 逐文件SHA实机复验 |
| 注册上下文 Z1/Z2 | `windows/installer/registration-context.ps1`、`verify-registration.ps1` | 不改已验规则；Z2 仍失败/待修，不在 Mac 假修 | #2 需可信桌面正向证明/未知链处理；不能只补 ZCode 名字 |
| Node SEA/完整 bundle | `windows/build-windows-fix2.cjs::build`、`bootstrap-build-tools.ps1` | Windows 真机/runner 全量编译；Mac 是源 host + 官方 Node，不混交叉 SEA | Node EXE SHA、SRI tar+模块字节、bundle相对依赖、EXE/ZIP匹配 |
| 构建默认fix2/installer .5 | Windows PS wrapper / builder；`scripts/release/build.cjs`、`build-common.cjs::installerBuild/sourceState` | 本 PR 修复：显式 suffix、自动读取 .6、clean tree、准确 commit | 构建参数、版本断言；Windows 全量 SEA 待复验 |
| 缓存/provenance | 根 `release-inputs.lock.json`；`build.cjs`、`verify-tools.cjs` | Mac runtime 命中逐字节校验；Windows tar SRI/Native 旧包+EXE+bundle+skills 精确匹配 | runtime 改字节/多文件拒绝；Native变化必须全量重编 |
| Mac 安装丢本地数据风险 | `macos/installer/install.sh`、`test-isolated-install.sh` | 从官方源码恢复后修复：升级保留 history/cache/projects/config，原子替换/双浏览器核验/保留备份 | 真脚本隔离安装/合成数据升级/Edge故障回滚；普通桌面/系统框架安装另验 |
| 全局 buildNumber 误提示 | `native-helper/platform-update-manifest.js::selectPlatformManifest`；`update_checker.js::resultFromManifest` | 本 PR 支持 opt-in schema2 平台元数据；schema1行为保留，配置/Latest 不切换 | Windows独立提高不触发Mac；缺target拒绝；旧客户端兼容设计见新文档 |
| 源未归档/浏览器agent故障 | 本仓库全部共享源+平台安装器；固定 Issue #1 | 下次双方仅同一共同 commit 构建；agent能力故障与产品缺陷分开 | 本 PR/sourceCommit/manifest为接续入口；GUI不给协议证据冒名 |

Windows 历史已验业务规则不回改。Windows 发布 `.6` 的历史 ZIP/EXE 与脏源码构建事实保持原记录，新候选不冒用旧 SHA。平台专属修改与新共享 decoder 需要 Windows 对受影响项目复验后才能提出合并/发布。

## Windows 自动更新事务补强（2026-10-18）

针对 PR #12 的 Windows 候选复审，补充以下 Windows 事务保护：`native-helper/update_engine.js` 对安装器失败报告按 update nonce 和安装根绑定；只有安装器明确报告回滚成功且旧 Native EXE/原扩展版本指纹匹配，才释放更新锁。安装结果缺少成功证明时尝试使用原安装器、原上下文门禁及持久 journal 恢复；journal 缺失、回滚证据无效或安装进程树未确认结束时失败关闭并保留锁。`windows/installer/install.ps1` 的失败报告携带 nonce，回滚失败时保留旧安装快照。UI 对恢复状态不明的失败显示中文修复指引，并在当前模块生命周期内禁用再次更新。

Mac 的 `native-helper/update_engine_macos.js`、`native-helper/platform/macos.js`、Mac 安装器及签名流程未改。共享 `src/modules/updates/module.js` 的安装路径错误文案依据返回平台区分；新增阻断状态仅对事务不确定、Native 更新锁仍占用等结果生效。Mac 与 Windows 的合成 DOM 状态均在本机回归；真实 GUI 与 Mac 实机仍需各自验收。

构建环节在 PowerShell `-NoProfile` 子进程中曾遇到可选 `Microsoft.PowerShell.Archive` 模块自动加载失败。Windows 包构建器现对 SHA-256 已核验的基础 ZIP 使用 .NET `ZipFile` API，并在写入前校验每个条目都落在解压目标目录内；该修改只影响开发/打包工具，不改变用户更新时的安装解压路径。

新的 Native 自测还发现，扩展模块随附的折旧模板存在于 `src/modules/depreciation-capex-forecast/assets/`，但源码技能目录缺少运行时要求的文件名，导致从源码构建的 `skills/depreciation-capex-forecast` 不完整。已将模板按原字节放入技能目录，SHA-256 与扩展资源及 v0.2.1 锁定基础包一致；构建测试现在要求扩展与技能目录都含精确文件名 `折旧摊销预测输入模板.xlsx`，且两个模板字节完全相同。

统一 Windows 构建在重打最终 ZIP 后曾只刷新顶层 `release-manifest.json`，adapter 内 `build-result.json` 仍保留预封装 ZIP 摘要。现在两处摘要都会跟随最终 ZIP 更新，回归测试覆盖 adapter 结果摘要与最终 ZIP 一致。

更新引擎在校验下载 SHA 后启动解压器时，漏传 `commandLaunchSpec` 的参数数组，导致更新在解压前以 `args is not iterable` 失败。调用方现显式传空数组，跨平台命令启动器也将省略参数默认为空数组；Native 隔离夹具覆盖有效 SHA 后确实进入解压器启动步骤。

本轮本地分支为 `codex/windows-update-acceptance-fix-20261018`，初始提交是 PR #12 候选源码快照，不带 PR 上游 Git 历史或远端；本地提交和包只作为隔离修复证据，不得声称已更新 PR head。CI 产物使用独立 buildId/ZIP SHA；未发布 stable、未改共享 Latest。历史最终夹具记录见 `C:\AppraisalToolboxAcceptance\v0.2.1\evidence\updates-v022-20261017\repair-validation-20261018-final\`，完整修复报告见 `C:\AppraisalToolboxAcceptance\v0.2.1\evidence\updates-v022-20261017\repair-validation-20261018-continuation\版本更新模块修复与隔离验收-20261018.md`。

## 2026-10-21 Mac 更新事务独立适配（PR #15）

本轮以正式 v0.2.3 / `9de4d81ca48f4aa4722775e010ba0f7dad2029b8` 为 Mac 源码基线，参照 PR #14 head `9f09d1c195232d2c1f1e2c13e6b154281fb672bc` 的安全性质与中文诊断，不整分支覆盖。完整 33 文件分类见 `MAC_UPDATE_RECOVERY_PLAN_20261021.md`，本轮实现文件、采用理由、双端影响、回滚办法与验证记录见 `MAC_UPDATE_RECOVERY_REVIEW_20261021.md`。

共享 UI/协议采用能力协商、busy/recovery 与未知结果禁重试；Mac 进一步采用天源工作台后台任务与持久状态查询模式，完成核验后才请求扩展重载。Windows 无新状态能力时仍保留原流式行为。Mac 使用独立 POSIX flock、Python.org 3.14.6、nonce/root journal、安装快照与真实 Native 自检；未移植 Windows Global Mutex、SID ACL、guardian、PowerShell、注册表、SEA 或其恢复上下文。原有业务规则和平台标识保持。

PR #14 run 20 (`39563782597`) 本次已重新读取为双端 success。Windows artifact `12329121918` 内 ZIP SHA-256 为 `13d9fd2f6262d7d614fc5e957119eee07e413a86d2e7f9ab6f3dfeaf7d7c1899`，Native EXE 为 `0a6e37134d7f03f1b96819ed3897dceb5833cc4927dcb195b78b1e73be07f17d`；sourceCommit 精确为 PR #14 head、sourceDirty=false，804 个载荷摘要一致。它是 CI artifact，包内 stable/release 元数据不构成新 Release 或正式发布。Mac artifact `12328283359` 仅确认列出，下载未完成，未声称已独立核验摘要。

本轮不合并 main、不发布 Release、不更新 stable/latest、不部署正式插件。Windows GUI/官方源完整一键更新/Chrome-Edge reload/真实配置保留继续未覆盖，Mac fixture/隔离证据另列，不互相替代。

## 2026-10-22 双端发布整合

Mac PR #15 的持久状态轮询与事务恢复已与 Windows PR #14 的 Windows updater/installer 合并到同一发布分支。共享 UI 保留 capability negotiation、Windows legacy stream 与 Mac verified-status polling；Windows `update_engine.js` 和 `windows/installer/` 继续使用其 Windows 专属锁、journal、guardian 与注册核验实现。发布前将两端从同一最终源码提交重建；此前 CI artifacts 不充当正式版包。真实 Windows 桌面更新、Mac/Windows 浏览器 GUI、官方源端到端更新与产品签名仍按未覆盖记录。
