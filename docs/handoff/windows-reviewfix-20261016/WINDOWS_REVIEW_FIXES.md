> 2026-10-16 发布追记：本文件主体记录 10-13 本地开发阶段。现在已获用户明确授权上传 .16 候选，源码与交接将位于 codex/windows-auto-update-reviewfix-20261016，Release 为 v0.2.1-windows.20261016.16；主体中的“未推送 GitHub”等字样为历史状态。实机验收未覆盖项保持不变。
# 审查缺陷修复与回归交付说明

日期：2026-10-13。用户已将“只审不改”更新为“直接修复，交给 ZCode 实机验收”。

## 当前结论

审查中列出的产品缺陷已按下表修复，定向组件/协议/文件夹具回归通过；**真实桌面安装、浏览器地图交互和自动更新完整链路仍待 ZCode 验收**。本报告不将模拟下载、进程、SDK 或 E 盘自测计作实机通过。

- 产品：评估工具箱 0.2.1；扩展 ID：`aamfmhcbjgofhmannejoiilkkpchfkgm`，名称/key/加载目录不变。
- 内部 build：`windows-auto-update.16`；buildNumber：`2026101305`；runtimeBuildKind：`local`（本轮未发布）。
- 地图：`amap-single-camera-20261013.3`，继续使用高德唯一相机。
- EXE SHA-256：`aa2c39a96f3168862cb867be187041499aa771f1e18e418d41485a9cbafdb824`
- ZIP SHA-256：`7a2cd2f7a79aeee0e4509152ef857d01fcbd038d65f211c5c333347b9b4093f4`
- 固定交付：`release-current/appraisal-toolbox-v0.2.1-windows-x64.zip`，包目录同名；完整 SHA256SUMS 有 799 项，ZIP 有 800 项，逐条核验和目录对比零差异。
- Native 集中编译一次；之后地图/前端收尾重新封包时，构建器验证 bundle/旧 EXE/ZIP 摘要一致后复用该 EXE，并重新运行自测。新旧构建证据分别保存，不沿用 .15 的 selfTestPassed。

## 缺陷修法

下列路径均相对 `E:\Codex\评估工具箱`，行号对应本次实际源码。

| ID | 修改位置 | 修法与当前状态 |
|---|---|---|
| A1 | 运行时-fix2/native-helper 三份专属文件 | 之前已恢复 NM manifest/runtime-config；本次代码同步不删除三份专属配置，不使用 /MIR。只有 runtime-config 增加经过产品 ID 校验的原加载路径。 |
| A2 | source/version.json:7；runtime-compat.json:5；部署证据 | 原加载目录、E 自带 extension、包前端逐文件一致；新源码清单、自测、provenance 和 build-result 绑定本次 EXE。 |
| B1/B2 | source/native-helper/update_engine.js:91、120、130、180 | 唯一暂存目录在安装根的父目录，不在活动安装根内；创建并检查重定向。安装器 cwd 在外部包目录，宿主自身 cwd 也临时释放到外部，完成后尝试恢复。真实活跃 EXE/其他宿主占用仍须实机核验。 |
| B3 | update_engine.js:27、137、152 | response aborted/error、pipeline、30 秒网络空闲与 10 分钟单候选期限；大小/SHA 失败和中断关闭流后删除 ZIP；单次 complete；失败不吞诊断。 |
| B4 | update_engine.js:14、109、117、145、155 | 64 位 SHA；官方清单大小、响应 Content-Length、实际文件三者一致；安装前重新核对官方记录及目标构建；逐跳白名单/禁止用户名密码端口；GitHub 官方仓库、资产 API、指定 Gitee 仓库可作为初始来源，GitHub CDN 只允许作为合法跳转；按权威候选轮换，未知 Gitee CDN 拒绝并尝试其他通道。 |
| B5 | update_engine.js:59、126、133、183、193、207；native_host.js:5001 | 跨宿主 mkdir 锁+唯一 nonce；同宿主更新期间拒绝其他动作；10 秒心跳；解压/安装超时 taskkill /T /F，等 close；未确认进程终止/安装超时保留锁，不自动抢占；安装报告绑定 nonce/buildId/EXE 哈希/原路径，安装后回读实际字节。日志保留在外部暂存目录。 |
| B6 | source/windows/installer/extension-deployment.ps1:2、21、39；install.ps1:400、451、535、570 | 安装器信任已有 runtime-config 中的原路径；首次可显式传 OriginalExtensionPath。核对扩展 name/key、目录交叠和 reparse point；原目录完整快照备份，暂存及更新后的逐文件核验；失败恢复原目录并回读；成功报告记录原路径和备份。本机固定桌面入口明确传原 E 路径，普通用户默认安装仍用自身运行时的 extension。 |
| B7 | source/src/modules/updates/module.js:190、280、389、493、550、573；src/shell/shell.js:160 | 补中文错误映射和通用兜底；技术信息进入复制诊断，不将未知裸码/路径当文案。complete 兼容缺 phase 的旧终态并显示 100%；统一检查/安装忙态；失败恢复可重试；无 event 的旧宿主拒绝立即结算。未知安装失败不再保证“当前版本已保留”。 |
| B8 | update_checker.js:374、817、868；update_engine.js:82、109；updates/module.js:402、579 | 较新的同版本 build 不被 repair 指纹分支降级；native 从已记录原路径读取实际版本，再向官方复查，拒绝过期目标。Windows x64 才返回一键能力；旧宿主/Mac 手动发布页入口保留。 |
| C1 | 桌面原 CMD:4；本目录 desktop-update.ps1:1 | 同一路径原脚本备份后改成 ASCII，无 BOM、无 chcp；Unicode PowerShell 以 UTF-16 编码载荷启动，脚本含 UTF-8 BOM 可供 Windows PowerShell 5.1 正确解析。保留 pause、退出码、失败日志；每次真实运行独立状态/日志目录，旧状态不伪造恢复。 |
| C2 | C:/AppraisalToolboxAcceptance/cmd-encoding-test.cmd:4 | 旧夹具完整备份后替换为纯 ASCII/编码载荷；只写本次 encoding-fixture，改变码页后中文路径核验通过，不执行安装，不写真实安装状态。 |
| D1 | source/native-helper/map-assets/amap-only.js:182、190、204、213 | 120ms 合并滚轮、统一 pixel/line/page；小增量跨相邻 burst 累加，500ms 间隔过期；Shift 滚轮三档，Shift 双击缩小，Ctrl 滚轮保留浏览器行为。UI/弹窗/版权控件不被劫持。缩放后用 SDK 实时投影修正中心，保持指针锚点，不推算比例。 |
| D2 | amap-only.js:109、117、231、251 | 严格 number/finite/range，null 不被转成 zoom0；SDK on/off 使用同一 wrapped 引用；卸载取消新计时器/清理累计量和事件。保留 doubleClickZoom:false 以及单相机防护。 |
| E1 | 审查修复-20261013/nm-update-probe.cjs:12；本报告/交接 | 新探针逐帧消费缓冲区，混合 progress+complete 不丢终态；旧探针与旧证据保留为历史，不再用其“停滞”推断网络。高倍率 matched=0/ratio=null 不计通过；手动安装不等于 Native 一键安装；坐标来源按模块说明，安居客仍未证实。 |

## 部署与备份

- 已原位更新 `extension-to-load`、`运行时-fix2/native-helper` 和 `运行时-fix2/extension`、`release-current`；未改注册表或真实 C 运行时。
- 修改前源码、原扩展、E 自带扩展、E native-helper、旧整个 release-current、原 CMD、原编码测试及核验脚本，均保存在 `审查修复-20261013/backup-*` 或 `*.before.*`。逐文件前后清单：`deployment-and-artifact-audit.json`。
- 桌面当前萧山 `_map.html` 已通过既有升级器备份并换成 .3；业务/配置前后缀保持字节不变，无 Key/数据解析或日志。文件 SHA：`74c4308a10e1aa6e4a7908e8f6eeb36d6e86c7a42dcd32a6e2310cb6d9a9cabd`，备份路径见 `current-map-upgrade.txt`。
- 真正浏览器运行时 `%LOCALAPPDATA%\AppraisalToolbox` **本轮未安装**；依上一轮独立桌面证据仍为旧 EXE+.2。当前 Codex/MSIX 的文件视图不能作为其现状证据。ZCode 应从普通桌面运行同名原入口并采集新证据。
- 未新增桌面更新入口、未推送 GitHub、不操作天源/正式 Profile 文件/凭据/真实地图 Key。

## 定向回归矩阵

证据目录：`审查修复-20261013`。

| 项目 | 结论 | 证据/范围 |
|---|---|---|
| 新 EXE 技能真实 import 自测；E 部署清空环境覆盖再自测 | 通过 | build-final/compiled-self-test.json；deployed-exe-self-test-no-env.json（带 EXE 哈希；E 本地进程，不是 C 浏览器链路） |
| 下载/大小/SHA/中断/非法域与跳转/并发/陈旧安装报告 | 通过 | native-regression.json、regression-native.cjs；流/权威记录/子进程模拟，8 场景 |
| 编译 EXE 非官方更新 URL 拒绝 | 通过 | compiled-updater-rejection.json；真实 EXE 协议，未联网/未安装 |
| 终态 100%、忙态/错误映射/失败重试、分支防误更新 | 通过 | frontend-regression.json；DOM 夹具，不是 GUI |
| 同版本新构建防降级/旧宿主即时拒绝/NM 多帧 | 通过 | contracts-regression.json、framing-fixture.json |
| 原扩展完整备份、逐文件更新、恢复原目录 | 通过 | extension-regression.json；原函数在独立目录执行，树核验替身，不代表安装器完整实机回滚 |
| 地图批处理/单位/小增量/光标锚点/UI过滤/null/解绑 | 通过 | map-regression.json；真实 Leaflet+模拟高德 API |
| .1→.3 升级与备份/数据字节保留；用户 .2→.3 页面更新 | 通过 | R4-upgrade-fixture-result.json、current-map-upgrade.txt；不是地图 GUI |
| ASCII 入口及码页改变后中文路径 | 通过 | desktop-encoding.json、encoding-fixture/status.json；未运行真实更新入口 |
| 包 799 摘要/ZIP 800 条目/目录/源码清单/扩展 ID | 通过 | deployment-and-artifact-audit.json、R1-zip-vs-directory.json |
| 普通桌面完整安装、双键四视图、原插件新文件被浏览器重载 | 未覆盖 | 交给 ZCode；上下文门禁保留，未从 agent 执行安装 |
| 原生自动更新完整链、活跃宿主替换、真实超时树终止/锁恢复 | 未覆盖 | 当前 .16 未发布，官方目标可能较旧；不得为验证制造版本或绕过门禁 |
| 真实高德多级缩放拖动/触控板、console、Mac | 未覆盖 | 交给 ZCode/后续 Mac 端；无可见目标的倍率不计通过 |

锁保留属于失败保护。真实中断后必须核对 owner PID/nonce、相关子进程及安装状态，确认不存在活动安装且可恢复后才能人工处理锁；本轮不自动删除真实锁。

## 交接

使用本目录 `ZCODE审查修复后实机验收提示词.md`。已通过的拍卖/租赁业务判据、Excel 导出、历史状态和土地数据口径保持；本轮不重新做无关全量抓取。Mac 注意事项见 `MAC审查修复交接.md`。

补充：桌面原名“评估工具箱-Windows完整安装包-20261013.zip”及摘要文件也已备份后更新至本次同 SHA；证据 desktop-package-update.json。未新增桌面文件名。
