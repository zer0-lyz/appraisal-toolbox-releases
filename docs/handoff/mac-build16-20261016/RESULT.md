# Mac build16 基线结果

截至 2026-10-16。代码分支 `codex/mac-build16-baseline-20261016`，构建源 `fe41e9f5cbc53265f662a3f9dc75788aadd33dc9`，该提交工作区干净。PR #5 原 Mac 分支 HEAD `76584a3410732cea93a26dd923a1a373619f7a0d` 保持未改；更早的折现率实验目录亦保持原状态。

## 构建产物

- 产品 `0.2.1`；buildId `mac-build16-20261016.3`；buildNumber `2026101601`；macOS arm64。
- Release 候选：[v0.2.1-macos.20261016.3](https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.1-macos.20261016.3)
- ZIP：[appraisal-toolbox-v0.2.1-macos-arm64-mac-build16-20261016.3.zip](https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.1-macos.20261016.3/appraisal-toolbox-v0.2.1-macos-arm64-mac-build16-20261016.3.zip)
- SHA-256 `6816b2c8ddaf8b597fcb41bb7a99062c0c1817f229b25d224abd5e5dc855d0df`；Native JS SHA-256 `5511bdf1d8aeeae0332603b26b6efa91dc11e08159b2a6dceb173035d3bd71d3`。
- 根输入锁 SHA-256 `d52bd4e01dfc10d0e31ca82f98f332ad1681a91c8bc197627abe4593bb84b689`；runtimeBuildId `0431d86f3b94baea15d7ab2e6c6f6ab79ccd7d1277de4a4a760c47477855198e`。
- 交付 Node v24.14.0、Python 3.14.6。构建工具 Node v24.14.0、`/usr/bin/python3` 3.9.6。ZIP含144个载荷文件并逐项回读；runtime缓存按锁命中。
- 产品未签名、未 notarize。包内 Node `codesign --verify --deep --strict` exit 0；Python 3.14.6 官方 pkg `pkgutil --check-signature` exit 0，Apple发行签名链和notary trust通过。

构建命令：

```bash
node scripts/release/build.cjs --target macos-arm64 --version 0.2.1 --build-id mac-build16-20261016.3 --build-number 2026101601 --output /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-candidate-validated --cache /tmp/toolbox-build-cache-20261012 --base-archive '/Users/lin/Downloads/评估工具箱-v0.2.1-双平台完整安装包/appraisal-toolbox-v0.2.1-macos-arm64-full.zip'
```

隔离安装命令：

```bash
bash macos/test-isolated-install.sh /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-candidate-validated/appraisal-toolbox-v0.2.1-macos-arm64-mac-build16-20261016.3 /Users/lin/Projects/appraisal-toolbox-intake-20261016/mac-validation
```

以上路径保留于本机；公开可审查摘要见本目录 `evidence/`。

## 分层状态

| 层级 | 状态 | 证据和边界 |
|---|---|---|
| 源码与映射 | 通过 | Windows 168 文件映射验证；Mac 221 文件逐项分类，79 项差异见 `file-classification.csv`。Windows包来自dirty source，不声称由snapshot commit干净重建。 |
| 构建源码检查 | 通过 | `evidence/final-source-checks.log`：tracked JS 语法、业务 fixtures 和9项Node tests全部通过。两种Windows构建入口也纳入强制source-checks。 |
| 业务回归 | 通过 | 土地历史 unittest 8/8；折旧历史 unittest 8/8；三类表格动作、拍卖/租赁合成HTML/history/Excel回读见 `evidence/`。折旧仍属development。 |
| 高德组件 | 通过（模拟SDK） | Leaflet真实库 + 模拟AMap API，4种比例和锚点/滚轮/Shift/UI/Ctrl/null/解绑场景通过；8个inline scripts解析。真实高德网络、触控板和浏览器GUI未覆盖。 |
| 更新状态逻辑 | 通过（synthetic DOM） | Mac不流式更新并打开下载页；Windows mock流验证忙态和缺phase终态补100%。未覆盖真实Windows Native安装链。 |
| 打包 Native Host/NM | 通过（离线） | `evidence/packaged-host-summary.json`：实际包7个Python入口独立导入、health和NM协议；Mac更新请求返回`PLATFORM_UPDATE_UNSUPPORTED`。真实浏览器连接未覆盖。 |
| 安装器 | 通过（隔离目录） | 初装、合成数据升级保留、Edge写入失败回滚、Chrome/Edge manifest回读通过；正式桌面目录、浏览器GUI与真实NM连接未覆盖。 |
| 包完整性 | 通过 | ZIP integrity、144项SHA、launcher执行位和provenance回读通过；hash不代表代码签名。 |
| 产品签名 | 未通过/未提供 | 当前候选产品未签名且未提交notarization；供应商Node与Python pkg检查通过，详见`evidence/signature-summary.json`。 |
| Windows .16 桌面验收 | 未覆盖 | Release `ACCEPTANCE_STATUS.json`为`fullAcceptancePassed=false`；Issue评论 #6211914310/#6211971083 明确无 .16 真实GUI报告。10月11日旧包报告不适用。 |
| 普通Mac桌面/真实网络 | 未覆盖 | 未执行Chrome/Edge普通桌面安装、真实高德请求、真实土地/拍卖/租赁网站或Excel/WPS GUI。 |

Issue #1 最新指定的Windows状态是权威验收边界。先前用户口头说安装和业务模块已验证，未提供与 .16 包绑定的实机报告；保留为口头部分反馈，不转写为完整验收通过。

## 下一次 Windows build 的防回归门槛

具体检查点、失败阻断方式和仍需实机验证项目见 `WINDOWS_BUILD_GUARDRAILS.md`。下一包须从双方冻结的同一干净commit构建；先跑强制source-checks，包内用锁定Python检查7个入口，再做桌面安装、升级/回滚、真实浏览器连接与相关GUI。不得以Mac模拟结果代替Windows实机验收。
