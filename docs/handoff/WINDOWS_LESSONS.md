> 2026-10-12 Mac接收增补：统一入口/根两目标锁/缓存/manifest/双平台CI已落地；当前结果以 [MAC_EXECUTION_STATUS_20261012.md](MAC_EXECUTION_STATUS_20261012.md) 和 [UNIFIED_BUILD_RUNBOOK.md](UNIFIED_BUILD_RUNBOOK.md) 为准。以下内容保留Windows历史交接的时间边界；不得把旧“待实施”状态当成当前状态，也不得把新CI通过等同GUI/完整安装全面通过。

# Windows 构建与实机问题：根因、修法、跨端预防

以下定位相对仓库，行号为本次交接快照附近位置；搜索函数名比沿用旧报告行号可靠。业务修复已验收的部分不可回改。标为待办的项不得描述为已修复。

| 问题 | 根因及已实施修法 | Mac / 下次 Windows 必须保留的预防 |
|---|---|---|
| 土地抓取立即 LAND_RUNNER_FAILED | Python 3.14 ._pth 路径隔离忽略 PYTHONPATH 和脚本目录；skills/zj-land-publicity/land_publicity_runner.py:24-30 先插入脚本目录；native-helper/native_host.js:4900 附近用真正便携解释器导入 4 入口 | 不在开发电脑的系统 Python 上代表交付 Python；4 入口各用独立进程，无 env 覆盖验收；内层 -m 入口也检查 |
| 中文路径/输出乱码 | 隔离 Python 不受 PYTHONIOENCODING 控制；Native runner 使用 -X utf8 -u；折旧 workflow.py:756 显式 engine sys.path 后 runpy | 保留 UTF-8 参数、中文/空格路径案例，stdio Native 协议与 runner 日志分离 |
| 拍卖 Excel 必定失败 | 子模块第二套 PYTHON_BIN 回退系统 python，无 openpyxl；native-helper/runtime_config.js:8-19 统一 env > runtime-config.json > platform；拍卖:14、租赁:16 复用 | 所有 spawn/execFile 经统一 resolver；无环境变量在实际打包 EXE 导出再回读；Mac 保留路径规则 |
| Python 源码/完整命令泄漏 | execFile error.message 含 -c 全源码；native-helper/diagnostics.js:3-46 脱敏、有界末尾 20 行；user-errors/native-errors 中文原因 + 复制诊断 | 不直接展示 error.message，不把 stderr/stdout/命令原样上传；任何脚本失败保留 exitCode/stderrTail |
| runner 错误被吞 | 土地/表格/安居客/折旧 stderr 原先丢弃；Native 统一 tail 收集，安居客 complete 传真实退出码 | 全 runner 同协议，故障注入验证有诊断，stdout 保持 JSON/NM framing |
| 折旧 WinError 5/误导超时 | prepare/status 与 write_params 并发替换工作簿；service_worker.js:15 后台队列；native-messaging.mjs 排队不计操作时限；workflow.py:53 锁、:200 三次 200ms 退避 | 串行覆盖 prepare/status/write/preflight/run/export，路径跨进程锁；FILE_BUSY 与真实超时分开；不强杀 WPS |
| 长抓取误报 30 秒超时 | 有进度长任务不能沿用短请求超时；后台 connectNative + 进度/活动计时 | 保留最大预算和关闭标签页取消；超时不是通用“权限问题”文案 |
| 方括号文件漏拷贝 | PowerShell 通配符对 [Content_Types].xml 误解释；install.ps1 字面枚举/.NET Copy | 中文/空格/方括号路径逐文件 SHA 比对；不要路径字符串拼 shell 删除 |
| 安装树被写到 MSIX 虚拟目录，报告假成功 | 进程内注册读回及同树子进程并不证明真实 HKCU；windows/installer/registration-context.ps1:3,112 令牌/路径/父链门禁；verify-registration.ps1 双视图交叉；install.ps1 先门禁后写盘 | Agent 不等同普通桌面；记录 PID/时间/SID/session/链，Chrome/Edge 各验证 manifest/exe/origin 与 32/64；失败回滚，报告不能冒写 verified |
| Edge 缺键与“已验”矛盾 Z1 | 旧历史上下文不足，根因未能还原；已订正报告并提供 verify-desktop-registration.ps1 只读证据入口 | Mac Chrome/Edge 各检查真实 manifest 安装目录和执行权限；保留核验范围，不将补键视为安装验收 |
| Z2 仍漏识别 ZCode | registration-context.ps1:15 当前祖先拒绝名单只列已知 agent，无法证明任意宿主独立性 | **待修**：讨论可信桌面正向证明、未知链拒绝、可见授权/验收入口；只加 ZCode 名称不是完备方案，不绕过宿主限制 |
| 拍卖历史 JS 异常 | 跨模块复制 setResultButtons 未定义；src/modules/alibaba-auction/module.js:2795-2796 改 renderNetworkGate/renderResults | 共享函数放 core，模块内部名字不跨模块调用；历史/清空按钮状态复验 |
| 结果按钮无反应/另开默认浏览器 | Native 默认 OS 打开 HTML 不符合当前浏览器需求；core/browser-results.js 指定当前 windowId，Native 返回验证后 file URL | HTML/map 用当前扩展窗口标签页；Excel 用桌面；权限/旧协议失败有可见反馈 |
| 结果页不自适应/地图配置无效 | 固定宽度与重复地图提示；amap-map.js、map-assets/amap-only.js、skills/map-shared/amap_support.py 统一生成与布局 | 仅高德 JS API Key 配置，不强制额外 securityJsCode；未配置顶部一次提示；配置后需重新生成静态结果；原始坐标/Excel/history 不改 |
| 阿里列表误判登录/验证 | 全正文“请登录”、普通 slider CSS 导致误判；core/alibaba-page-state.js:1 起 URL/可见登录表单/明确挑战信号优先；/iv/expired 仍在验证等待 | 共享分类器；手工登录/滑块，5 分钟共同截止；过期和标签页关闭分开；禁止绕过验证/重放 token |
| 租赁日期范围错/成交漏抓 | 列表结束日期不完整/排序不可靠，成交租金标注与拍卖不同；租赁 module 使用列表预筛、详情日期与本场成交/流拍严判 | 缺日期继续详情核验；未证明排序不提前停；尊重 1-5 页；公告/推荐价格不算本场成交；0 条不覆盖旧成果、不放宽判据 |
| 输出路径在确认参数之后 | 旧布局先确认筛选再选输出；两个阿里 template/module 改筛选→输出→确认→抓取 | 保留单一可见流程和标签页占用提示 |
| 裸错误码/截断/误用开发模块 | core/native-errors.js,user-errors.js 共用中文映射；shell 健康胶囊；module-registry 开发阶段 | 安居客/折旧保持开发中；业务4卡+开发2卡+辅助2入口；健康标签可读、本地历史时间、覆盖原文件二次确认 |
| 天源品牌/路径耦合 | 独立默认 projects/评估工具箱/workbooks，depreciation-capex-forecast.js 忽略旧天源 state | 不自动迁移/读写天源目录；legacy 环境变量名字为兼容，不代表天源依赖 |
| Node SEA 打包及依赖漂移 | Node v24.18.1 + esbuild 0.25.12 + postject alpha.6 固定，bundle 相对依赖必须全部打进 EXE；注入前清除副本旧 Node 签名元数据 | Windows x64 在 Windows 构建，Mac arm64 在 Mac；从官方摘要锁复用 runtime；不把 unsigned SEA 宣称已签名 |
| 构建版本/provenance 漂移 | 全量 builder 当前硬编码 installer .5、PS wrapper 默认 fix2；最终 .6 由 finalize 读取安装器；source 原 HEAD 未含修复 | **待统一** 单入口/锁/相对清单；准确记录 payload inventory+源码 commit，不声称旧包来自新 commit；见 BUILD_RUNBOOK |
| 源不在 Git/跨机依赖本机目录 | native/skills 曾仅在发布包，恢复来源已记 RECOVERED_SOURCE_PROVENANCE.md；本次纳入交接 PR | Mac 审查并合并公共源码，后续两端只从同一 commit 构建，不靠聊天补丁/绝对路径/另一个插件目录 |
| 浏览器控制不可用 | Codex 官方 bridge fetch/URL 前置失败，和 ZCode 控制能力不同 | Agent 工具故障单独记录，不当产品 bug；不绕过安全停止；不能用协议/文件状态冒充 GUI |

关键工艺：本次 .6 ZIP 是安装器收尾，Native SHA 沿用已验二进制。src/native-helper/skills 或 bundle 变化需要全量打包并补受影响回归；只改文档不重编 EXE。用户原加载目录更新必须完整备份、逐文件清单、保留 ID，不要求切换到“修复版插件”。
