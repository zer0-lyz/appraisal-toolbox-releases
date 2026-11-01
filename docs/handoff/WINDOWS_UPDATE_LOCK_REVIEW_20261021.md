# Windows 一键更新事务修复与 Mac 接续说明（2026-10-21）

## GitHub 接续点

- 现有 Mac 候选 PR：#12，原 head `f5c594de3bb7081b14ddda6131808251a468101a`，base `codex/mac-build16-baseline-20261016`。
- 本轮 Windows 更新器修改基于该 head 的后续源码历史；实现提交为 `91dcc88ffb24e0d2e8c6385604caa01a5da2267f`，分支 `codex/windows-update-lock-reviewed-20261019`。
- 建议把本分支作为叠加 PR 审查，base 指向 PR #12 的 head 分支 `codex/mac-one-click-update-20261016-pr`。先审 Windows 更新事务与共享 UI，再决定如何单独接入 Mac；不要把 PR #12 的旧 head 或 Windows .2.3 源码快照称为完整双端发布包。
- 本轮只提交源码、回归与交接资料；没有从最终提交构建新的 EXE/ZIP，也没有更新 Release、stable、共享 latest 或合并 main。

## 已实现内容

### Windows 更新锁和事务恢复

- `native-helper/update_engine.js` 使用 Global named Mutex 和当前 SID ACL，由隐藏的 Windows PowerShell 5.1 guardian 持有；安装根路径做大小写、junction、长路径前缀规范化，避免同一路径产生不同锁。
- 事务由 `owner.json` nonce 和 schema v2 `transaction.json` 绑定。解压、安装、恢复进程启动前先写持久状态；状态写入失败就不启动子进程。
- guardian / Native Host 退出不代表安装器已经结束。安装/恢复进程存活未知、启动状态未知或回滚未核验时保留锁，继续请求返回可解释的忙碌/恢复状态。
- 只在安装结果/回滚、进程树、nonce 和旧版指纹核验通过后，才将锁目录原子移出活动路径并释放 Mutex，避免恢复旧 helper 后残留终态目录永久阻塞。
- journal 写入使用 WriteThrough 和 Flush；适配 Windows PowerShell 5.1 的 `File.Replace` 备份参数要求。
- 兼容真实旧 `.11` helper 的有限协议：仅当全部 v2 字段缺失时接受 legacy；检查 Native Messaging 来源、浏览器边界、进程链、PID/创建时间、安装根、扩展路径与 nonce；使用排他新目录和 schema 3 legacy journal。Legacy 明确 `externalRecoverySupported=false`，不会伪造 v2 journal；无法证明事务状态时仍需人工处理。
- 安装器注册核验上下文接受规定的 recovery / verifier 父进程链并绑定 NM/browser proof、nonce、journal 和目标路径；保留原有 agent、MSIX、SID/session 等安全门禁。未通过门禁的上下文仍 fail closed。

### 更新页与诊断

- `src/modules/updates/module.js` 对无法确认安装状态的结果展示恢复指引，不再误报“当前版本未改变”；事务不确定期间不允许本页重复启动更新。
- 新增 `windows/diagnose-update-lock.cjs` 只读锁诊断 CLI；不提供清锁或自动恢复命令。
- 更新阶段状态/错误路径能把 owner、journal 和 rollback 状态交给诊断流程；敏感路径/进程细节按现有脱敏约束处理。

## 回归结果与证据

证据根目录：`E:\Codex\评估工具箱\验收证据\updates-v023-20261018\lock-review-luna-max-20261019\`。

- 四个更新专项套件 27/27 通过；主审独立重跑同为 27/27：`main-final-update-suites-rerun.txt`。
- 四 worker 锁竞争连续 3 轮通过，单轮最多一个持有者；安装子进程存活、解压子进程存活、start pending、rollback unknown 四类危险状态均被拒绝：`update-lock-4worker-3round-rerun-20261019.txt`。
- 最终 `source-checks.cjs` 集成通过，含原 build/intake 16/16：`source-checks-integration-serial-rerun-20261019.txt`。
- Recovery context fixture 与事务身份矩阵分别见 `context-fixture-only-rerun-20261019-01/` 及对应 suite 输出；PowerShell fixture 使用系统 Windows PowerShell 5.1。
- 曾有一次并行集成 worker exit=1，旧断言没有保存 stdout，故当时原因未能还原。后来保留该失败记录、增强诊断输出并将测试文件顺序调度；四 worker 内部真实并发没有关闭。不要把先前失败解释为已证实的并行根因。
- 以上是源代码、进程锁和 fixture 回归，不是安装器 GUI、真实桌面一键更新或官方发布源成功更新验收。

## Mac agent 接续边界

- PR #12 的 Mac 原生适配器必须保持独立：`native-helper/update_engine_macos.js`、`native-helper/platform/macos.js`、`macos/installer/`、Mac 签名/notarization 和 Mac 用户数据迁移流程不要被 Windows 文件替换。
- Windows `Global\` Mutex、SID ACL、PowerShell 5.1 guardian、注册表/NM 上下文证明、`.ps1` recovery fixture、Windows SEA/installer 代码不移植到 Mac。请在 Mac 使用自己的文件锁/进程生命周期、安装器 journal、签名和回滚模型独立实现或评估对应性质。
- `src/modules/updates/module.js` 的共享状态/中文恢复提示可按 Mac 返回协议选择性吸收；为 Mac adapter 增加对应协议 fixture，确认能力字段、busy/recovery 状态、重试和扩展重载语义与 Mac engine 一致。
- 先以 PR #12 head 和本分支的共同提交为基线看文件级 diff，再对照当前 Mac 权威分支；不要用 Windows checkout 整树覆盖 Mac 新功能。独立记录 cherry-pick/手工移植的提交、Mac 文件 SHA、构建和测试。

## 尚未覆盖与已知限制

- 没有本轮最终提交对应的新 ZIP/EXE，也没有新的包 SHA 或签名状态；历史 `.5` 不能冒充本轮构建。
- 真实 Windows GUI、从当前官方发布源完成的一键更新、Chrome/Edge 扩展 reload、数据保留和真实系统提示未覆盖。一次网络探针在 GitHub/Gitee 多通道均停滞，15 分钟护栏终止；这不证明候选更新器完整链已通过。
- legacy `.11` 协议没有外部超时恢复能力；若 journal 或安装状态不能核验，设计上保留锁并要求人工检查。
- 当前分支 source metadata 包含 v0.2.3 候选历史，但最终源码改动之后没有重新构建候选包。未发布 stable、未改共享 latest。
