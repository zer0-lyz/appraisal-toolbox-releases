# 评估工具箱 v0.2.1 Windows x64 · 审查修复构建 .16

发布日期：2026-10-16；构建日期：2026-10-13。产品名称、版本 0.2.1、原扩展 ID 均保持不变。

## 下载与安装

下载 appraisal-toolbox-v0.2.1-windows-x64-full-20261016-build16.zip，先核对同名 .sha256，然后解压，在普通 Windows x64 桌面运行 install.cmd。不能把 ZIP 当作 Chrome 商店安装包。既有用户保留原扩展 ID 与原加载目录；外部加载目录请按安装器 OriginalExtensionPath 支持的方式登记，备份后原位更新。详见 WINDOWS_REVIEW_FIXES.md 和 WINDOWS_ACCEPTANCE_PROMPT.md。

- ZIP SHA-256：7a2cd2f7a79aeee0e4509152ef857d01fcbd038d65f211c5c333347b9b4093f4
- Native EXE SHA-256：aa2c39a96f3168862cb867be187041499aa771f1e18e418d41485a9cbafdb824
- buildId：windows-auto-update.16；buildNumber：2026101305；installer：windows-context-attested.7
- 地图：amap-single-camera-20261013.3；Native 为未签名 SEA。

## 本次修复

- 自动更新根外暂存/cwd、下载中断与残件清理、官方来源与 SHA/大小验证、候选通道轮换、互斥锁/心跳/进程树超时、nonce/build/实际字节回读。
- 安装器记录并备份更新同一个原插件目录；保留普通桌面上下文门禁与回滚，不用 /MIR 抹除专属配置。
- 前端错误中文、诊断分层、终态100%、更新忙态、旧宿主拒绝即时返回、同版本较新构建防降级、平台能力协商；Mac 手动入口保留。
- 地图继续使用高德唯一相机，修复滚轮节流/单位/触控板小增量、光标锚点、控件过滤、空值保护与监听解绑。
- 固定本机桌面入口 ASCII/Unicode 启动与独立日志方案；新增三个本地 Excel 工具保持“开发中”。

## 验证边界

本次为预发布，供 ZCode/用户实机复验。已通过：新EXE真实技能import、E盘清空Python环境覆盖自测、8下载/进程夹具、DOM/地图模拟SDK/原目录回滚夹具、799内层SHA与800ZIP条目/源码映射校验。

未覆盖：本次普通桌面完整安装/真实注册表与浏览器闭环、真实高德薄弱手势、Native一键更新完整链、真实超时子树/恢复、新Mac包。历史 .2 地图实机结果不能替代 .3 薄弱项。没有公开较新目标时不得制造假版本或绕过上下文门禁。

本包 runtimeBuildKind=local，按本地候选原字节上传，没有因为本次GitHub提交重新构建。原 BUILD-PROVENANCE 保留 dirty source 与原源码HEAD；本次 SOURCE_PACKAGE_MAPPING 和发布manifest建立快照commit与逐文件载荷关系，不伪称干净commit重建。

现有正式版、共享latest清单与Mac资产未修改；本次不合并main。Mac接手见 MAC_REVIEW_FIXES_HANDOFF.md 和协调 Issue #1。
