# 给 Mac 主开发 agent：Windows 修复接收与双端开发交接

你是“评估工具箱”的 Mac 主开发 agent。请接收 Windows 端已完成的修复和发布成果，完成源码审查、问题沉淀和双端构建流程对接，确保下次 Mac 开发或 Windows 打包不会丢失本轮修复。

这是执行任务。先读真实源码与 GitHub 资料，再推进到可审核、可追溯的交接节点，不停在建议清单。已有授权允许在本仓库创建工作分支、PR、Issue及回复协调Issue；不直接合并main、不覆盖现有tag/资产，不擅自发布新Mac正式包或切换共享Latest。若旧项目说明写“禁止推送”，记录本次授权变更。

## 1. 接手入口与当前事实

- 仓库：https://github.com/zer0-lyz/appraisal-toolbox-releases
- Windows累计修复PR：https://github.com/zer0-lyz/appraisal-toolbox-releases/pull/4 （目前draft/open，尚未合入main）
- 工作分支：codex/windows-mac-handoff-20261012
- 交接提示词更新前已核实远端HEAD：02f94b6ef83b62b3f08e7c60771e6bfd9fdf0024。接手时fetch最新分支，并记录实际commit；不要只clone main便断定没有修复。
- 双端协调：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/1
- Z2安装核验加固：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/2
- 多机实测反馈：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/3
- Windows正式发行：https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.1-windows.20261012

产品仍为0.2.1；扩展ID aamfmhcbjgofhmannejoiilkkpchfkgm；Native host com.appraisal.toolbox.helper；Windows内部build windows-e2e-round2.1，installer windows-context-attested.6。
Windows ZIP SHA256：9cdf15366fe4711d03f8b34135d5dd4aaa7fbb08826e7678d7b45b2aa2a67a5c。
Native EXE SHA256：2b31db5cca6e97a1aad8954e74bd68ded3718decb855b46e49edfc613cce8454，unsigned SEA。

当前Windows发行项已经由预发布改为正式，不表示所有验收项目通过。包字节未变，历史构建来自当时带未提交修复的源码，不是从本轮新commit重编；原tag对应 f5d509fba9d5f146c8330c07fa6921d3e826a385。后续commit主要补充文档。历史附件里“预发布/完整安装未覆盖”文字需结合最新Release说明、WINDOWS_FORMAL_RELEASE_STATUS.json和Issue增补，不照搬过时状态。

共享Latest仍是原跨平台v0.2.1：现有updater把buildNumber当全局字段，Windows独自提高会使未重建Mac包被反复提示更新。当前Windows从指定发行页下载；该兼容问题要纳入后续双端更新设计。

## 2. 必读与源码来源核实

读取docs/handoff/README.md、WINDOWS_LESSONS.md、DUAL_PLATFORM_PLAN.md、BUILD_RUNBOOK.md、ACCEPTANCE_STATUS.md、release-inputs.lock.json、release-manifest.json、source-inventory.json，以及RECOVERED_SOURCE_PROVENANCE.md、windows/installer/和native-helper/platform/。以本提示词与最新Issue/Release增补为当前状态，其他报告保留历史时间边界。

native-helper/skills是从SHA核对的官方Windows发布包恢复后修复的，不能未经对比覆盖Mac权威源。先明确Mac主源码仓库、commit、构建入口、现有未提交修改；如果Mac源在其他仓库，列出映射与同步方向，不能另留一套未关联代码。备份并保留现有修改，不reset他人工作。

在Issue #1先回报：已取得commit、本机OS/arm64、Mac权威源位置、差异概况和将执行步骤。

## 3. 已验修复必须承接

逐项审查WINDOWS_LESSONS，形成“Windows修法→共享源对应文件/函数→Mac是否适用→回归方法”表。至少包括：

1. 便携Python ._pth隔离导致同目录import失败；runner自举、内层engine入口、显式UTF-8、真实交付解释器4入口导入烟测。
2. 所有业务统一runtime_config.js的Python解析：env > runtime-config.json > 平台默认。Excel导出不能退回缺openpyxl的系统Python；必须含无覆盖变量的实际打包host导出回读。
3. 全runner保留脱敏/截断stderrTail和exitCode；UI显示中文原因及复制诊断，不泄漏-c源码/完整命令。stdout保持Native协议格式。
4. 折旧工作簿操作队列、按路径跨进程锁、os.replace退避；文件占用与真实超时分开。折旧仍开发中，不据离线自检转正。
5. 拍卖历史renderNetworkGate/renderResults、清空后按钮状态，禁止跨模块复制不存在的内部函数。
6. HTML/地图结果页由扩展在当前浏览器窗口打开，Native返回验证后的URL；Excel使用桌面程序。失败有可见反馈。
7. 高德仅JS API Key、不强制额外securityJsCode；缺配置顶部一次提示，响应式结果页；静态产物改配置后重新生成；原坐标/Excel/history不改。
8. 阿里两个模块共享登录/挑战分类器；5分钟共同等待、expired路径分类；登录/滑块人工完成，不自动填凭据或绕过验证。
9. 租赁结束日期/页数和本场成交严判；公告/推荐/流拍不算成交，未证明排序不提前停止；零结果不放宽判据、不覆盖旧成果。
10. 筛选→输出→确认→抓取布局；中文诊断、历史本地时间、健康胶囊、覆盖确认、标签页占用提示、窄面板、开发中角标。
11. 独立产品路径与host，不操作天源；旧TIANYUAN_*环境变量名称是兼容接口，不能不经迁移评估便删改。
12. Windows方括号/中文/空格路径复制、逐文件SHA、Node SEA工具锁/打包bundle/签名状态、installer上下文与Chrome/Edge分开核验。

Windows已通过：拍卖34条抓取/Excel/WPS/历史及重抓、土地7条与高德、租赁40→1本场成交/产物/Excel、表格三模式NM与界面优化；2026-10-12上午本人普通PowerShell卸载→重装，以及装后注册/无env4技能/浏览器连接通过。不要回改这些业务规则。

## 4. 剩余问题与证据边界

- Z2未修：已知agent进程名拒绝名单漏识别ZCode。讨论可信普通桌面证明和未知上下文处理，不能只增加一个进程名就声称覆盖任意agent；Mac上不能代替Windows真实环境验证。
- Z1旧Edge缺失根因未能还原。旧上下文证据不足，不能猜测“虚拟化”或“外部清除”；上午重装通过也不能反推历史根因。
- 新机首装、保留数据升级、Edge写失败回滚、真实MSIX、表格GUI覆盖取消/确认、自然expired仍需补证；多人测试在Issue #3汇总。
- 安居客、折旧仍属开发中；正式业务仅土地、拍卖、租赁、表格，另有地图/更新两个辅助入口。
- Mac当前成果未由Windows端重新验收；必须在Mac真实机器取得对应证据，不将Windows通过复制成Mac通过。

## 5. 使下次打包可重复的实施任务

在独立分支按价值分批实施，公共改动列双端影响：

A. 审查PR #4并完成权威源差异处理，用提交承接修复，明确待合并点；不只写“收到”。保留共享代码和平台adapter边界。
B. 收录真实Mac arm64构建/installer源码、运行时和依赖来源；按target锁Node/Python/wheel/工具版本、摘要及许可证，不打包系统PATH依赖或用户配置。
C. 统一build入口参数target/version/buildId/output；installerBuild自动读取，修复Windows PS默认fix2与全量builder硬编码installer .5问题。历史finalize收尾用法见runbook。生成相对路径manifest，干净tree/sourceCommit及payload inventory可追溯。
D. 缓存按target+lock/SHA分层：runtime、工具、Native bundle；只有业务/bundle/EXE/旧ZIP匹配才reuse。Native改变全量重打包，installer-only可校验后重封装；不要每次重装未变依赖。
E. GitHub CI按两平台真实target构建，同commit产出。离线导入/Excel/协议、隔离安装升级回滚、GUI真实网络分层；托管runner不等于真实桌面/登录态/MSIX。Windows构建留给Windows runner/agent，不在Mac交叉生成后跳过实机。
F. 设计分平台version/build/asset/release channel，考虑旧updater兼容，解决Windows单独更新误提示旧Mac的问题；不得直接切换当前共享Latest。Mac签名/notarization、Windowsunsigned状态如实记录。
G. 更新项目执行规则/长期记忆/当前状态/任务日志；为每个跨端问题形成Issue、PR、验收条件与责任人，协调Issue #1作为固定汇总入口。

## 6. Mac实际验证与安全约束

从可追溯源码构建Mac arm64完整包，在测试用户/Profile完成Chrome/Edge Native连接、4技能导入、无env Excel导出、四业务核心链路、历史/清空/地图、console、安装/升级/回滚/权限与签名检查。另有Windows专属改动必须交Windows端复验。缺硬件/隔离/自然样本时写未覆盖，先完成可独立推进部分并留下明确交接。

不修改天源系统或正式浏览器Profile，不读取/上传凭据、Cookie、token或真实地图Key，登录和验证由用户手动完成；不绕过工具安全限制；故障注入限可回滚测试环境。原插件更新前完整备份，名称/ID不变，不创建另一个“修复插件”。

## 7. 交付和GitHub回复格式

在Issue #1提交接收回报，再以执行后的成果回复：

- 实际sourceCommit、Mac权威源及恢复源差异处理；Windows各修复是否已落入共享源的表格（文件:行/函数）。
- 修复和流程PR URL；统一入口/锁/缓存/manifest/CI哪些已落地，哪些待办。
- Mac包路径、SHA、输入锁、provenance、签名状态；不冒称旧Windows包从新commit重建。
- Windows/Mac按offline/installer/GUI列通过、失败、未覆盖与脱敏证据ID。
- 推荐下次共同构建commit、Windows需复验项、未解决问题及下一责任人。

完成标准：可审核源码提交、可执行构建步骤、可追溯输入/产物、真实验证结果、GitHub接续入口俱全。公共源审查及两端验证齐后再提出合并或新版本发布请求；本任务不自动合并main，也不覆盖已发布资产。
