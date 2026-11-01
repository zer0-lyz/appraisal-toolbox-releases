# 逐项采用审查：Mac 与 Windows 影响、回滚和证据

完整逐文件哈希/决策见同目录 `file-classification.csv`。本表按可回滚的功能组说明平台影响；Windows build16实际GUI仍未覆盖。

| 项目/文件 | 采用决定与理由 | Mac影响 | Windows影响 | 回滚与证据 |
|---|---|---|---|---|
| 高德相机：`native-helper/map-assets/amap-only.js`、`skills/map-shared/update_map_page.py`、`windows/tests/amap-only.test.cjs` | 采用单SDK相机、SDK投影锚点、有限值和解绑保护；保留数据坐标，避免双相机/CSS缩放漂移 | 共用逻辑生效；Leaflet + 模拟AMap回归通过，真实地图/触控板未覆盖 | 共用逻辑进入Windows重建；需在真实AMap Key和桌面复测 | 回退08693提交中对应文件；`evidence/client-summary.json`、`evidence/map-integration.log` |
| 更新状态/协议：`src/modules/updates/{module.js,template.js}`、`src/shell/{index.html,shell.js}`、`native-helper/{native_host.js,update_checker.js,platform/update.js}` | 采用能力协商、阶段/终态、忙态、错误诊断、旧宿主拒绝和同版本防降级；保留Mac #5 schema2 decoder接口 | adapter报告不支持自动更新，继续手动下载；不加载Windows engine | dispatcher仅Windows x64加载`update_engine.js`；Windows仍需真实下载安装GUI验收 | 回退08693中对应源文件；`evidence/update-ui-summary.json`、`evidence/packaged-host-summary.json` |
| Windows updater：`native-helper/update_engine.js` | 仅作为Windows实现保留；不能在Mac运行；PowerShell/注册表操作不移入Mac | Mac host在能力判断后拒绝更新，不加载engine | Windows可使用原16版引擎代码，重建后须进行包级成功/失败/取消/防降级验证 | 从08693回退engine/dispatcher成对文件；packaged-host摘要证明Mac拒绝路径 |
| Native/Python/工作簿：`native-helper/native_host.js`、`src/modules/workbook-tools/*`、三项技能目录`skills/{appraisal-declaration-print-format,appraisal-detail-print-format,asset-link-restore}/` | 采用allowlist、7入口导入、工作簿调用队列/锁、报告名避免覆盖；保持工具development阶段，不扩大业务授权 | Mac锁/路径策略保留，7入口在包内runtime独立导入 | Windows需用锁定Python重跑7入口、三种表格动作和并发busy检查 | 回退08693中Native/模块/skills文件；`evidence/packaged-host-summary.json`、historical logs |
| Windows安装适配：`windows/installer/{install.ps1,extension-deployment.ps1}`、`native-helper/platform/windows.js`、`windows/build-windows-fix2.cjs` | 只保留Windows专属实现；exit 1文件选择失败、exit 2取消；绝不转换成Mac安装路径 | 不参与Mac adapter；Mac安装脚本、原扩展ID和host不变 | 下次包要测普通桌面注册、升级/回滚、Edge注册失败 | 回退08693中这组Windows文件；Mac isolated installer摘要与其分离 |
| 构建门禁：`scripts/release/{build.cjs,build.test.cjs,intake-contracts.test.cjs,source-checks.cjs,update-ui-fixtures.cjs}`、`windows/build-windows-fix2.cjs` | 统一入口和旧Windows直建入口都强制source-checks；防止操作者绕过回归；保留clean source、输入锁和source drift拒绝 | Mac构建固定清洁源码/runtime摘要后再打包 | 两个Windows入口都阻断source-checks失败的包；仍需Windows环境/SEA验证 | 先回退fe41，再回退20a6、08693；`evidence/final-source-checks.log`、`evidence/mac-build-validated.log` |
| 土地/拍卖/租赁约束：`skills/zj-land-publicity/tests/test_land_publicity_runner.py`、`skills/map-shared/update_map_page.py`及交付技能 | 测试夹具补齐HTTP status/header/body/total，生产严格校验保持；不改变日期、成交、坐标、验证码或人工复核判据 | 修复后的共享逻辑可在Mac包运行；本轮历史测试8/8 | 同一业务源重建后测试仍强制；真实网站/Excel GUI分别验收 | 回退20a6仅含HTTP fixtures；业务源如需回滚再单独revert 08693对应文件；`evidence/historical-land.log`、`evidence/historical-depreciation.log` |

## 整体回滚

Mac PR #11仍为draft。若review发现问题，关闭PR即可避免合入；若要回退分支上的代码提交，按时间倒序revert `fe41e9f5`、`20a6ed8e`、`08693a9a`，不改#5原分支。候选Release是独立prerelease，不会重写稳定资产或latest；若候选有问题，应发布修正版并在Issue标明，不复用旧包摘要。


## 一键更新新增审查（Mac 优先，Windows 同提交适配）

| 文件 | 采用决定与原因 | Mac 影响 | Windows 影响 | 回滚与证据 |
|---|---|---|---|---|
| `native-helper/update_engine_macos.js`、`native-helper/platform/update.js` | Mac 使用独立安装器：二次核对官方 release、SHA/包清单/provenance、防降级、有限下载重试、并发锁和事务结果核验 | 只在 arm64 提供自动更新；重用 `安装.command` 与原用户目录策略 | Windows 引擎不加载、不改变 | 撤回 Mac engine 与 router 配对改动；`native-helper/update_engine_macos.test.cjs` 与隔离真实安装器测试 |
| `native-helper/native_host.js`、`macos/installer/install.sh` | Mac Native Host 在事务中忽略断连 EPIPE；安装器处理 INT/TERM/HUP 并回滚 | 面板提前关闭时仍完成安装及锁清理；可捕获中断恢复目录/注册 | Windows EPIPE 和安装器逻辑不变 | 撤回对应 EPIPE/trap；Native Host 合同测试、隔离 Edge 注册失败回滚 |
| `src/modules/updates/{module.js,template.js}`、`scripts/release/update-ui-fixtures.cjs` | 共用能力协商/进度页；成功后按目标平台重载已更新扩展 | Mac 一键更新后自动重载 | Windows 继续走 Windows adapter，完成后同样自动重载 | 回退更新页与 fixture；Mac/Windows 合成 DOM 回归，不等同真实 GUI |
| `scripts/release/{source-checks.cjs,test-macos-update-e2e.cjs,test-tools/*}`、`.github/workflows/dual-platform-candidate.yml` | 锁定 jsdom fixture 依赖；CI 两端都跑 UI platform fixture，并用同产品版本/buildNumber构建候选 | Mac CI 运行更新器真实包内安装器隔离回归 | Windows CI 验证现有 SEA/Native 接口；桌面 GUI 仍需实机 | 回退测试依赖/CI 步骤，不改产品数据；workflow artifact 与本地测试日志 |

详细流程、支持范围、人工门槛和回滚边界见 [`MAC_ONE_CLICK_UPDATE.md`](MAC_ONE_CLICK_UPDATE.md)。本轮 Windows 专属更新引擎保持原样；真实 Windows 桌面更新尚未覆盖。

## Mac 一键更新最终源码候选（2026-10-16）

- 功能源码提交：`85683681fbfc5661fc765c54d96cec6d0dfe5d18`，分支 `codex/mac-one-click-update-20261016-pr`，基于 `6249f0bf7e92547f35afd0ec7420ab2bfd8f6506`。版本 `0.2.1`、全局 `buildNumber=2026101602`、Mac `buildId=mac-one-click-update.20261016.5`。
- Mac ZIP：`/Users/lin/Downloads/appraisal-toolbox-mac-update-candidate-20261016-pr-8568368/appraisal-toolbox-v0.2.1-macos-arm64-mac-one-click-update.20261016.5.zip`；SHA-256 `dd96a51117fa4453a2d43dd9103affa48cb48b2cb0e0e6226af62a4eac948a45`。此为本机候选包路径；GitHub 候选下载地址待双平台 PR 构建与审核后确定。
- 构建命令：`bash scripts/release/build.sh --target macos-arm64 --version 0.2.1 --build-id mac-one-click-update.20261016.5 --build-number 2026101602 --output <new-path> --cache <cache-path>`。锁定 Mac 基础资产 SHA `4570d0fa51a0284fbee1f5157731fc7bd311fae9402da4cbe896f2acdeaa792c`，runtime cache hash 校验命中。
- 构建环境为 macOS `27.0.1` arm64、Node `v24.14.0`、组包 Python `/usr/bin/python3` `3.9.6`；安装包内 Python `3.14.6`、Node `v24.14.0`。包内 Node `codesign --verify --deep --strict` 通过，官方 Python `.pkg` 具有 Apple Developer ID Installer 签名且 Apple notarization 状态为 trusted。产品 ZIP 与 launcher 未签名，产品未 notarize。
- 测试：`node scripts/release/source-checks.cjs` 通过（更新协议 `11/11`、Mac 更新引擎 `2/2` 及共享业务检查）；更新页合成 DOM 在 Mac/Windows 均通过。`bash macos/test-isolated-install.sh <package-root> /tmp/appraisal-toolbox-mac-update-e2e-20261016-pr-8568368` 通过实际隔离安装器初装/升级、合成用户数据保留、Chrome/Edge Native Host 清单核验、Edge 写入失败回滚；包内 Host 自检、四项 Python 导入、阿里拍卖/租赁及 `table-format` 三种 Native 协议操作通过。证据：`/tmp/appraisal-toolbox-mac-update-e2e-20261016-pr-8568368/{installer-summary.json,one-click-update.json,protocol/offline-summary.json}`。
- 未覆盖：真实桌面安装及系统 Python 安装授权、Chrome/Edge Native Messaging 真实连接、扩展 GUI 重载、对正式 Release 的真实网络下载更新、真实 Excel/WPS GUI、产品 Gatekeeper 放行；Windows build `.16` 的 `fullAcceptancePassed=false` 不变，真实 Windows 桌面更新仍须另验。测试没有使用真实 Profile、凭据、地图 Key、天源系统或业务网络。
- 回滚：关闭 draft PR，或 revert 功能提交 `8568368`；候选包不触碰 stable、共享 latest 或 `main`。本节证据可随文档提交独立回退。

## Mac 包与双平台同源候选（PR head `c69009f`）

此前列出的 `8568368` 包是功能提交候选。为满足同一源码 commit 分别构建两端，已从 PR head `c69009f3fafacdde5c3485e4a7976d058a14fe63` 重新构建并复验 Mac 候选：版本 `0.2.1`、全局 `buildNumber=2026101602`、Mac `buildId=mac-one-click-update.20261016.6`；ZIP 位于 `/Users/lin/Downloads/appraisal-toolbox-mac-update-candidate-20261016-pr-c69009f/appraisal-toolbox-v0.2.1-macos-arm64-mac-one-click-update.20261016.6.zip`，SHA-256 `24d6e7a5a0c9e508c4f01ceab6475d830ecc67cb5dc5e4f283b39b0fffd8a45f`。这与 Windows 候选工作流的目标源码 commit `c69009f` 相同，平台 buildId 各自独立。

同源包 `bash scripts/release/build.sh ...`、source-checks、更新页 Mac/Windows 合成 DOM、隔离安装/更新/数据保留/Edge 注册失败回滚及 Native/Python/业务协议回归均通过。最终证据目录：`/tmp/appraisal-toolbox-mac-update-e2e-20261016-pr-c69009f/`；UI fixture：`/tmp/appraisal-toolbox-mac-update-ui-fixture-20261016-pr-c69009f.json`。GitHub 双平台 workflow run `38902716917` 针对同一 commit；截至本记录时两个 runner 仍为 queued，Windows 包级结果待 CI 启动后读取。Windows `.16` 桌面验收仍未覆盖。
