# Mac接收执行结果与下次共同构建

已完成源码提交及双端可复现候选节点，尚未达到新正式Mac发布/全面GUI验收节点。原 Windows 正式发行及共享Latest保持。产品0.2.1、扩展ID/host不变，安居客/折旧仍开发中。

## 冻结来源与接续入口

- Windows实际接收HEAD：`8cde0ea68102a560ee7158190c48d1599fd13a00`，PR #4未合入main。终端直连受网络阻断，通过GitHub接口核验169 blobs及原始tree/commit，原对象只读镜像git fetch成功，FETCH_HEAD相同；没有冒称origin直连fetch成功。
- 本轮最终共同业务/构建源码：**`80eec2bbec08001f4052a2b0adf7f1791f0b0b09`**。Mac本机和两平台CI均构建该clean commit，CI显式checkout head SHA，artifact名称同sourceCommit。后续证据提交仅增加本交接记录，不改该构建输入。
- 修复与构建流程 PR：https://github.com/zer0-lyz/appraisal-toolbox-releases/pull/5 （叠加于PR #4；不自动合并main）。PR #4已提交审查COMMENT。
- 逐文件/函数承接：[WINDOWS_FIX_ADOPTION.md](WINDOWS_FIX_ADOPTION.md)、[mac-source-comparison.json](mac-source-comparison.json)。Mac native-helper/skills 52文件：33相同/19不同，Mac adapter/common/launcher保留原字节。原未提交折现率实验25文件已备份且回读一致，原树未改。
- 一键构建：[UNIFIED_BUILD_RUNBOOK.md](UNIFIED_BUILD_RUNBOOK.md)；根两目标 `release-inputs.lock.json`；`.github/workflows/dual-platform-candidate.yml`；新build入口及runtime/tools/native摘要缓存校验均已落地。历史锁/manifest继续原来源，不冒用为本轮产物。
- 更新方案：[PLATFORM_UPDATE_COMPATIBILITY.md](PLATFORM_UPDATE_COMPATIBILITY.md)。schema2 decoder和回归已实现；生产feed、旧客户端fallback迁移、Latest切换未实施，必须双端协调。

## 本机与CI产物

| 产物 | 来源与SHA256 | 状态 |
|---|---|---|
| Mac本机完整候选 | source `80eec2bb…`；build `mac-handoff-20261012-final`；ZIP `3127d5bd3fed07c9cd75c9974f3bec38a6d95ad3bddc8c9025f56839065472c6` | 189源码/128载荷摘要、ZIP回读/可执行位通过；runtime缓存真实命中 |
| Mac CI完整候选 | 同source；build `ci-38202670433`；ZIP `d49c08ca5f1dc0d1a72dec84bfd32ec1534e47e289686bf764eab3bf2d6e44bd` | macos-15 arm64 job通过，完整ZIP/manifest/摘要保存为artifact |
| Windows CI完整候选 | 同source/build；ZIP `bd4a0e6fc7a098da68a8f17364331ff306adacbcd1e2c9e3ad3d207a93008769` | windows-2022 x64全量SEA及实际host通过；完整ZIP已保存，未发布Release |

输入锁SHA：`d52bd4e01dfc10d0e31ca82f98f332ad1681a91c8bc197627abe4593bb84b689`。Mac共享Native JS SHA：`f56dc0ba01790d987af7d875f984d5eba534496802221c91557859f3a40f712e`。Mac Node v24.14.0 / Python 3.14.6；Windows Node v24.18.1 / Python 3.14.6；全部wheel/工具版本和摘要见根锁。组包系统工具实际版本/摘要在provenance，OS工具不是锁定交付二进制。

本机产物：`/tmp/toolbox-mac-handoff-candidate-final/appraisal-toolbox-v0.2.1-macos-arm64-mac-handoff-20261012-final.zip`。相对manifest与脱敏摘要在 [evidence/mac-20261012/](evidence/mac-20261012/)，永久文本来源入Git；CI二进制artifact有到期时间，下一责任人下载并校验，不能覆盖已发布资产。

CI：https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/38202670433 （两job success）。[Mac artifact](https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/38202670433/artifacts/11725468301) / [Windows artifact](https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/38202670433/artifacts/11725819368)。Artifact外层ZIP digest与候选内层ZIP SHA不同，不能混用，详见ci-summary.json。

## 分层验证及未通过项

| 层/项目 | Mac本机 | Windows本轮 | 说明 |
|---|---|---|---|
| JavaScript语法/共享页面与业务夹具 | 通过 | CI通过 | 14页面分类、8组租赁、实际模块history/clear/overwrite回调、当前窗口URL、Key-only配置；不是真实GUI |
| 精确交付解释器4入口导入 | 通过 | 实际SEA CI通过 | 独立进程、无Python/skills env覆盖；Mac精确pkg隔离框架，未用本机3.14.3替代 |
| 拍卖/租赁HTML/history/Excel回读 | 通过 | 实际SEA CI通过 | 合成记录/中文空格方括号路径、openpyxl回读，真实NM host；不是网络抓取/桌面Excel打开 |
| 表格3模式/结果URL | 通过 | 实际SEA CI通过 | actual protocol；GUI确认/文件选择另验 |
| 安装/升级/失败回滚 | 隔离真脚本通过 | 新candidate安装未覆盖 | Mac真实脚本独立root/browser-home初装、保留合成history/cache/projects/config、Edge写失败回滚；不替代普通桌面/系统框架安装/浏览器首连 |
| 工作簿跨进程锁与占用错误 | Mac POSIX实际双进程+合成占用通过 | 本轮msvcrt实机未覆盖 | FILE_BUSY与WORKBOOK_OPERATION_TIMEOUT不同；折旧继续开发中 |
| 本机vendor输入签名 | **失败** | 新SEA unsigned | Mac旧正式输入及候选Node/Python pkg均signature invalid；根因未知，#6；产品launcher/ZIP未签名未公证 |
| 随包历史Python unittest | **土地4通过/4error；折旧7通过/1失败** | 本轮CI未运行这两历史unit suite | 旧HTTP Response fixture与内部bundle声明摘要过期，#7；不放宽业务门禁、不转正折旧 |
| 新候选真实GUI/网络4业务 | 未覆盖 | 未覆盖 | Windows历史34拍卖/7土地/40→1租赁保持旧证据时间边界，不复制为新候选或Mac通过 |
| Z2/真实MSIX/普通桌面新机/自然expired | 未覆盖/Windows专属 | Z2仍失败待修，其余本轮未覆盖 | #2/#3，由Windows实机补证；旧Z1根因不猜测 |

迭代中的时区fixture、Mac SIP丢继承DYLD、租赁sheet测试名、Windows Git tar路径、安装metadata漏保留与artifact漏收Windows ZIP已修复并由最终两端CI复验。失败中间候选不是交付候选，不沿用其SHA。

## 下一责任人与共同构建约定

1. **Windows agent**：从 `80eec2bbec08001f4052a2b0adf7f1791f0b0b09` 下载CI完整Windows候选或按runbook全量构建；在普通桌面隔离环境验证中文/空格/方括号路径、Chrome/Edge独立注册、首次连接、新机安装/保留数据升级/失败回滚/真实MSIX，以及4业务、history/clear/地图/手工登录。#2推进可信桌面正向证明与未知上下文处理，不能只追加ZCode进程名宣称完成。
2. **Mac agent/runtime维护者**：#6独立核验供应商签名与原始来源；#7修正旧HTTP fixture和自动技能bundle摘要，公共变更交Windows复验；在测试用户/Profile补GUI/网络/普通桌面安装、升级、回滚、权限和首次连接。无真实Key/登录态时由用户手工完成，不自动读凭据。
3. **双方共同维护者**：冻结同一source commit及两平台build/version/asset，审查PR #4/#5后才提合并请求；更新feed迁移、旧客户端兼容、签名和发布另行协调。不直接合并main、不切换当前Latest、不覆盖tag/资产、不发布新的Mac正式包。

协调入口仍为Issue #1。后续问题沿Issue编号记录，而非再靠聊天补丁或发布目录临时修改；共同代码来源/锁/相对manifest/回归方法已在仓库，下一轮不从旧Mac实验目录覆盖Windows已验修复。
