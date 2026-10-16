# Mac 接收 Windows build 16：开发基线与防回归

2026-10-16。关联 #1、PR #4/#5/#9/#10。当前分支 `codex/mac-build16-baseline-20261016` 基于 Mac PR #5 的 `76584a3410732cea93a26dd923a1a373619f7a0d`；上次实际构建为 `80eec2bbec08001f4052a2b0adf7f1791f0b0b09`。main 仍 `46a67bc48766703e13a182f57a1ca5375a2a1aef`。#5 与 #9 从 #4 分叉，#10 叠加 #9，均未合并。

## 接收证据与业务基线

Windows snapshot `65840987d9aea80586817ca63684f4df2953d5c2`，168 文件逐项 SHA 与 Release 来源映射一致。Windows ZIP `7a2cd2f7a79aeee0e4509152ef857d01fcbd038d65f211c5c333347b9b4093f4`，EXE `aa2c39a96f3168862cb867be187041499aa771f1e18e418d41485a9cbafdb824`。包来自 dirty source，原 HEAD 为 main 的 `46a67bc48766703e13a182f57a1ca5375a2a1aef`，不是从 snapshot commit 干净重建。见 source-reception.json。

用户在本轮追加确认“Windows 版已经安装测试通过、业务模块修改调整已验证通过”。这条确认属于新的用户验收信息；历史 ACCEPTANCE_STATUS.json 保留原时点。具体实机报告/通过包绑定尚待提供，不能推导为 Native 自动更新完整 GUI、高德所有触控板手势或 Mac 已通过。三个 Excel 工具源码一并承接，保留现有 development 标记；正式阶段变更需具体验收范围。

逐文件全表见 file-classification.csv（包括双方相同文件与所有差异），汇总见 comparison-summary.json。Mac 原权威 checkout 干净；折现率实验 main `328acaca898ab16cd234df0f8c25a6f3120db3cc` 的未提交工作保留，前后逐文件摘要在外部接收证据中核对。原实验不打包、不迁移、不自行开始新功能。

## 采用与排除

- 高德 `amap-single-camera-20261013.3`：唯一 SDK 相机；真实投影/光标锚点；滚轮单位、120ms 批处理、500ms 小增量过期；Shift/UI/Ctrl 过滤；finite/null 保护；同引用解绑与定时器清理。旧 HTML 更新器先备份，仅替换组件，数据/配置 opaque 字节保持。未改原经纬度。真实 SDK/GUI 独立验收。
- 更新 UI 与 shell：无 phase 的 complete、旧宿主无 event 拒绝、忙态/中文失败/复制诊断；Mac 能力为 false，只打开发布页。Native 平台 dispatcher 在 Mac 不加载 Windows engine；Windows x64 使用原 .16 update_engine.js。
- updater 防同版本降级同时应用清单与 GitHub fallback；保留 PR #5 schema2 分平台解码与 resultFromManifest 公共测试接口。Windows 分支移除该 decoder 的差异不采用。
- 保留 Windows .7 安装器、extension-deployment 与三个 workbook 工具/技能/原文件备份及报告不覆盖修正。Windows file picker 退出1为失败，退出2为取消；此语义在 Windows adapter 内实现，不更改 Mac common/adapter。
- 保留 Mac adapter/common/launcher、Python resolver、UTF-8、stderr 诊断、工作簿跨进程锁与队列、土地/拍卖/租赁日期和成交判据、人工验证流程。Mac diagnostics 继续提示安装.command，不替换成 install.cmd。安居客与折旧仍开发中；坐标来源按模块分别披露。
- 不采用 Windows version.json/runtime-compat.json；候选按显式 target/version/buildId/buildNumber 生成，运行指纹基于本轮受控业务源码，kind=local。保留 Mac 根输入锁、SRI 缓存、clean-tree/源码漂移拒绝、Native 完整源匹配和 mandatory suffix，不退回 Windows 历史静默 fix2、动态信任 registry integrity 或 dirty source 打包。

## 强制构建门禁与最短复现

统一构建入口现在强制先运行 source-checks，不再依赖操作者记得手工跑。包含所有 tracked JS 语法、原页面/租赁/历史/结果/配置夹具、构建锁测试，以及本轮新增防降级、Mac不加载Windows updater、旧宿主拒绝/多帧终态、Windows文件选择错误分类、三工具载荷存在性。失败阻止构建。实际包另做无解释器覆盖的7入口导入与真实 NM、合成 Excel 回读，不能用系统 PATH 代替。

```bash
node scripts/release/source-checks.cjs
node scripts/release/build.cjs --target macos-arm64 --version 0.2.1 --build-id mac-build16-20261016.3 --build-number 2026101601 --output /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-candidate-final --cache /tmp/toolbox-build-cache-20261012 --base-archive '/Users/lin/Downloads/评估工具箱-v0.2.1-双平台完整安装包/appraisal-toolbox-v0.2.1-macos-arm64-full.zip'
bash macos/test-isolated-install.sh /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-candidate-final/appraisal-toolbox-v0.2.1-macos-arm64-mac-build16-20261016.3 /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-validation
```

组包在新输出目录，源码必须 clean；runtime/cache 在树外。Mac 交付 Node v24.14.0、Python 3.14.6、wheels 摘要均用根锁，组包 `/usr/bin/python3` 独立记录。本机 macOS 27.0.1 (26A434)/arm64。构建器仅有 Mac arm64 与 Windows x64 目标，无 Intel Mac 支持声明；其他 macOS 版本本轮未测。完整安装运行 `安装.command`，缺精确 Python 时要求正常系统安装，本轮仅做独立 root/browser-home 的真实脚本安装，不更改系统 Python/正式 Profile。

地图与更新 DOM 回归需外部固定 `jsdom@26.1.0`（npm --ignore-scripts），不进入产品 runtime：

```bash
node windows/tests/amap-only.test.cjs <新证据目录> <含jsdom的node_modules目录>
node scripts/release/update-ui-fixtures.cjs <含jsdom的node_modules目录> <summary.json>
```

Windows 下次从双方冻结的同一新 commit 用统一入口 `--target windows-x64`，先 bootstrap 锁定工具，再全量 SEA 构建。不得拿本轮 Mac 包或旧 .16 EXE 代表新共享源验收。Windows 需要重跑包内7入口/业务导出、普通桌面原扩展路径升级/回滚与相应 GUI，用户已确认的旧包业务结果保留来源边界。

## 回滚与发布边界

本轮未安装至正式用户目录，未读凭据/Profile/真实Key，未调用天源。源码回滚可在独立分支 revert 本轮代码提交，原 PR #5 与原工作区保持；运行包回退用既有安装器备份和精确 SHA 的上个候选，先备份用户数据。候选产品未签名未公证；供应商 Node/Python pkg 旧签名问题 #6、历史Python suite #7 单列，不以hash代替签名。GUI/网络未覆盖项与 Windows 用户确认见最终 RESULT.md。

不发布 stable、不改共享 latest、不合并 main。新功能继续沿原折现率需求，但本轮无新的明确实现规格；基线完成后只确认首个功能范围，不自行扩大需求。

本轮附带修复 #7 的旧 HTTP Response 测试夹具：补齐 status/header/body/total 与生产严格接口一致；生产校验逻辑不变。折旧 bundle 声明摘要按实际载荷重新计算，未改计算规则。最终结果以 RESULT.md 为准。

Windows 旧直接 builder 入口也强制执行相同 source-checks，避免绕过统一入口而遗漏回归。三个工具的安装提示统一使用“当前平台完整安装包”，Mac 不出现 Windows 专属桌面脚本指引。
