> 2026-10-16 发布追记：本文件主体记录 10-13 本地开发阶段。现在已获用户明确授权上传 .16 候选，源码与交接将位于 codex/windows-auto-update-reviewfix-20261016，Release 为 v0.2.1-windows.20261016.16；主体中的“未推送 GitHub”等字样为历史状态。实机验收未覆盖项保持不变。
# Mac 主开发交接：Windows 审查修复 .16

日期：2026-10-13。本次本地 source、原加载目录、E 运行时和 release-current 已修，未提交/推送 GitHub。接收时先按本目录审查修复交付说明核对 ZIP/EXE 和源码清单，不能拿旧 .15 的二进制/自测证明新包。

## 双端共享部分

- 地图组件 .3 仍由高德控制唯一相机，Leaflet 只承载业务工具层；不要回到双相机或 CSS 缩放。
- 保留 AMap 2.0 原生 doubleClickZoom:false 对策，手动桥接；SDK 瞬态 null/NaN 不进入 Leaflet _resetView；on/off 保存相同包装回调。
- 滚轮统一单位、120ms 批处理、500ms 小增量间隔过期；Shift/控件/版权/弹窗行为见 Windows 交付；光标锚点使用 SDK 实际投影修正，不猜同比例缩放。
- Map clientBuild 为有效版本证据；旧内嵌 HTML 必须单独备份替换，数据/配置保持 opaque 字节。重载扩展不更新旧 HTML。
- 拍卖 API GCJ→存档 WGS→展示 GCJ 的边界保持；土地坐标来源独立；安居客提取坐标未被证实，不合并来源结论。
- 更新 UI 接受无 phase 的 complete 及无 event 的旧宿主拒绝；失败文案中文，技术信息复制；正在更新禁止检查抢占忙态。
- 同版本较新 build 不因为 fingerprint 不同被 repair 降级；平台能力协商，Windows x64 才支持本次一键动作。Mac 保留手动下载入口，不能误调用 Windows install.cmd。Mac 一键适配若开发，必须有自己的安装器/上下文/签名/原路径验证。

## Windows 必须保留的约束

- update_engine.js 在安装根外唯一暂存+跨进程 mkdir 锁；宿主/安装器 cwd 都在根外；pipeline/abort/逐跳白名单/清单大小/SHA/候选轮换；日志不随运行时根替换。
- 更新前向官方重新核对当前实际原加载目录版本和目标包，校验同次 nonce/buildId/实际EXE/前端字节，不信过往 status=success。
- 初始下载只接受指定官方仓库/API/指定 Gitee 仓库；GitHub CDN 仅作为合规跳转接受。不要为网络便利扩大到任意 github.com 仓库或任意镜像域。
- install.ps1 原上下文门禁保留；agent/MSIX 不能当真实桌面，不能加绕过通道。installer 测试变量不透传到实际更新。
- 通过记录的 extensionLoadPath 备份后原位更新同一插件；按原 key/name 校验路径，禁止 overlap/reparse，失败恢复原目录并逐文件核验。默认新机使用自身 runtime/extension；不能硬编码本项目 E 盘为通用安装策略。
- 同一个桌面入口使用 ASCII CMD + UTF-16 编码启动载荷 + 带 BOM 的 Unicode PS 文件，不让父 CMD 依赖中文码页；每次运行独立日志。发布前 Windows PowerShell 5.1 和非中文 locale 都应覆盖。
- 不用 robocopy /MIR 覆盖真实 native-helper 并删除专属 manifest/runtime-config/update-sources。构建目录可以重建，已部署目录要有完整备份和逐文件证据。
- 发生未确认子树终止/安装超时保留锁，不自动抢占；需复核进程与安装状态后人工恢复。

## 构建与验收

- 本次 EXE 只编译一次，最终资源收尾封包经过 bundle/EXE/旧包匹配复用；每次完整包均重新生成 SHA256SUMS/provenance/source-inventory，并重新自测实际 EXE。
- 当前 buildNumber1305/runtimeBuildKind=local；正式 release 与全局 latest 不应直接提升为此本地包。后续按照双端方案更新平台独立清单，避免 Windows build 让 Mac 被误更新。
- 组件/协议/哈希通过 ≠ 普通桌面/真实高德/自动更新 GUI 通过；ZCode 按单独提示词验收。本次自动更新没有公开较新目标时保持未覆盖，不制造假版本。
- 原 .2 实机地图基本闭环保留，但旧高倍率 matched=0 的时间线不证明对齐；新复验每倍率需要可见目标并考虑图标锚点/像素舍入。
- E1 新逐帧 NM 探针位于审查修复目录；旧首帧探针保留历史且不再用于网络归因。

待 ZCode 实机报告回来再决定是否发布；本交接文件没有自动向 GitHub 或其他 agent 发送。
