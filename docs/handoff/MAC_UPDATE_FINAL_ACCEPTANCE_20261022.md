# Mac 更新模块最终交接与分层验收（2026-10-22）

## 源码与范围

- 草稿 PR #15：https://github.com/zer0-lyz/appraisal-toolbox-releases/pull/15
- 协调 Issue #1，Windows 参考 PR #14 head `9f09d1c195232d2c1f1e2c13e6b154281fb672bc`；本轮不合并任一 PR。
- 共同 CI 构建源码：`d34d184b53ff72df424c1aff1fc06899c03c2a27`，分支 `codex/mac-update-recovery-20261021`。基于正式 v0.2.3 源码；没有用折现率实验源或已安装运行时拼业务载荷。
- 本机 r6 构建源码：`e8dc0aca98ab3b23b4adaa02ed65bf84ef6ef32e`。与上述共同 CI commit 的唯一差异是隔离测试脚本由 rg 改用系统 grep；`src/`、`native-helper/`、`skills/` 字节相同。
- 原 Mac 权威接收分支 `codex/mac-main-handoff-20261012` / `76584a3410732cea93a26dd923a1a373619f7a0d` 和原功能树 `codex/mac-one-click-update-20261016-pr` / `026822cf9d167876f6477d540fb737597ba8eaa6` 均再次核对为干净、保留原位。
- 本机环境：macOS 27.0.1 (26A434)、arm64、Node 24.14.0、Python.org 3.14.6。

复用天源工作台后台任务、持久状态回读和成功后 reload 的流程；工具箱 repo、扩展 ID、Native Host 和路径不变，未复制天源配置。逐文件分类/理由见 `MAC_UPDATE_RECOVERY_PLAN_20261021.md`（PR #14 的 33 文件）和 `MAC_UPDATE_RECOVERY_REVIEW_20261021.md`（本轮实际变更）。Windows Global Mutex、SID ACL、PowerShell guardian、注册表、SEA 没有移植到 Mac；Windows adapter 未改。Windows 接续时仍须保留 PR #14 的专属实现并审查两条分支，不能以本次 CI 构建代替 PR #14 桌面验收。

## 构建与安装命令

本机已执行，源码干净、output/cache 在树外：

```bash
node scripts/release/build.cjs --target macos-arm64 --version 0.2.3 --build-id mac-update-recovery-20261021-r6 --build-number 2026102101 --channel candidate --runtime-build-kind local --python /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 --output /Users/lin/Projects/appraisal-toolbox-update-evidence-20261021/candidate-build-r6 --cache /tmp/toolbox-build-cache
bash macos/test-isolated-install.sh <package-root> <new-test-directory>
```

普通完整包入口是解压后的 `安装.command`（`/bin/bash <package-root>/安装.command`）。本轮只在一次性 HOME/浏览器目录执行，没有部署到正式用户目录或 Profile。旧版 helper 到新事务协议的普通桌面迁移仍未实测，不可将隔离结果冒充此项通过。

## 候选身份与摘要

产品 `0.2.3`、buildNumber `2026102101`、channel `candidate`、runtimeBuildKind `local`。本机 buildId `mac-update-recovery-20261021-r6`：

- ZIP：`/Users/lin/Projects/appraisal-toolbox-update-evidence-20261021/candidate-build-r6/appraisal-toolbox-v0.2.3-macos-arm64-mac-update-recovery-20261021-r6.zip`
- ZIP SHA-256：`80924f176bd63ec5ee02170555d26f5ac1193bbf009865b87f8dcb7117b3e470`
- Native JS SHA-256：`f8b7f135fff1eb704eec70edec57872534e82b51ddc9f47ed699ebf704addb69`
- runtimeBuildId：`339b0b5a7ae1415e52e73a831e8a642a75c92c42b89cd77bec17e597c7dce576`
- ZIP CRC、153 个载荷文件 SHA、执行位、包内来源/sourceDirty=false 已独立核验。产品未签名、未 notarize；供应商 runtime 签名不能算产品签名。

CI run 26：https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/39701457582
CI run 26 的 Mac arm64 与 Windows x64 job 均 success，共同 sourceCommit 为上面的 d34d184，均构建 0.2.3 / 2026102101 / candidate/local。Mac 在 runner 上使用提取的 Python 3.14.6 完成 41 项回归、隔离安装/升级/回滚和实际 Native 协议；Windows 完成共享 UI 夹具、全量 SEA 构建与实际离线 Native 协议，仍不是 Windows 桌面验收。

- Mac 候选下载（包含 ZIP、来源清单与合成验收摘要）：https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/39701457582/artifacts/12392358711
- Mac CI 产品 ZIP：`appraisal-toolbox-v0.2.3-macos-arm64-ci-macos-arm64-39701457582.zip`
- Mac CI 产品 ZIP SHA-256（已下载独立核验）：`e4dca052309a50f2cb81396b47733d4dc00e7ee710a63e1edfdbc3c02121fa93`
- GitHub artifact 外层 ZIP digest（已下载独立核验）：`5a0fb94d0e6120f146a9b7a65a8cd02bff1153ffd6be90849375e5ea22424533`，与产品 ZIP 的摘要不同。
- Windows 同 commit 候选：https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/39701457582/artifacts/12393445915
- Mac artifact 外层/产品 ZIP 摘要、CRC、153 个载荷 SHA、sourceCommit/sourceDirty=false 与 4 份通过摘要均已独立下载核验（run26-macos-audit.json）。CI 两平台的源码/build/运行时指纹清单以各 artifact 内 release-manifest.json 为准。

CI 包 buildId 与本机 r6 不同，ZIP SHA 也不同；不得把本机摘要绑定到 CI 下载文件。它们都只是候选，不是新 Release。

## 通过、失败与未覆盖

| 项目 | 状态 | 证据（根目录见下） |
|---|---|---|
| Mac 并发、journal/nonce/root、进程中断、超时、结果不明阻断、回滚及重载语义 | 通过：41/41，0 skipped；精确提取 Python 3.14.6 | candidate-validation-r6/macos-unit-tests.log |
| 共享来源/构建/协议检查 | 通过：16 项，另含既有业务静态/组件入口 | candidate-build-r6.log |
| 真实 updates module 的 synthetic DOM | 通过：22/22；含 Windows 旧协议和错误诊断 | root-ui-fixtures-final.json |
| 真实包隔离初装、升级与合成配置/数据保留 | 通过 | candidate-validation-r6/installer-summary.json、fresh-install.log、upgrade-install.log |
| worker 驱动真实包安装及持久成功状态 | 通过；下载源为合成受控 fixture | candidate-validation-r6/one-click-update.json |
| Edge 写失败后的原文件/配置/manifest 指纹和实际 Native JSON 自检 | 通过 | candidate-validation-r6/rollback-install.log |
| 实际 Native 帧协议、get_update_status、核心技能导入 | 通过 | candidate-validation-r6/protocol/offline-summary.json、native-update-status-summary.json |
| 当前本地失败项 | 无；历史失败候选不作为交付，修复过程完整留档 | MAC_UPDATE_RECOVERY_REVIEW_20261021.md |
| 普通桌面安装、系统框架安装、真实浏览器连接/GUI/reload 后握手 | 未覆盖 | installer-summary.json 对应字段 false |
| 官方源完整在线更新、旧 helper 迁移、正式 Profile/真实配置保留 | 未覆盖 | FINAL_ACCEPTANCE_STATUS.json |
| Gatekeeper、产品签名/notarization、Windows 桌面完整更新 | 未覆盖 | 分层边界，不以 CI/fixture 代替 |

本机证据根：`/Users/lin/Projects/appraisal-toolbox-update-evidence-20261021`。`candidate-package-final-audit.json` 为 ZIP 独立核验；`FINAL_ACCEPTANCE_STATUS.json` 保持 `fullAcceptancePassed=false`，因为真实 GUI/官方网络等未覆盖。未读取或上传真实凭据、Profile、地图 Key，未修改天源系统。

## 接续与回滚

Mac 新功能继续在本分支/其后继独立分支开发；当前需求就是更新模块，没有扩展到折现率或其他业务功能。下一步 Windows 以共同源码和 PR #14 adapter 做适配与专项验收，冻结新的共同 commit 后分别构建，版本/buildNumber 一致。正式发布前还需双端 review 和上述真实桌面层证据。

源码回退使用独立 revert 提交并重新干净构建；安装恢复只按本事务 nonce/root 的保留快照和清单进行，未核验的 unknown 必须保留现场，不删除锁/journal 伪造成功。未发布 Release，未改 stable/latest，未合并 main，未替换正式插件。
