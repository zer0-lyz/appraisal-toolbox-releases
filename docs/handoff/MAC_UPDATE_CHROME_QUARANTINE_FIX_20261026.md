# Mac 一键更新中的 Chrome quarantine 传播修复（2026-10-26）

## 根因

首次失败发生在 Mac 一键更新下载阶段：官方 v0.2.7 ZIP 的尺寸与 SHA-256 匹配，但 Chrome 为下载缓存文件附加了 `com.apple.quarantine`。`ditto -x -k` 将标记传播给 Python.org pkg、wheel 和其中的 lxml native extension；macOS 27.0.1 随后拒绝导入 `lxml.etree`，暂存安装自检失败。旧安装目录未被替换，原事务与恢复快照当时保留。

截图中的 `libprobe.dylib` 不在产品源码、官方 ZIP、候选 ZIP 或安装目录内。系统日志没有提供调用进程或可用路径；它与本次更新的关系仍未确认。修复处理的是已有证据证明的 Chrome quarantine 传播与 lxml 导入失败，不能据此宣称已查明该弹窗来源。

## 修复

- `native-helper/update_engine_macos.js` 仅在官方清单中的 ZIP 尺寸和 SHA-256 匹配后，检查更新缓存中的普通文件并移除该 ZIP 的 `com.apple.quarantine`；回读确认成功，否则失败关闭。不触碰其他属性、原始下载文件或 Gatekeeper。
- 后续仍执行 ZIP 内部 `SHA256SUMS`、目标平台、版本、runtime 和来源验证。
- `macos/installer/install.sh` 在替换现有安装前，于 staging 中完成 Python 依赖导入自检；安装器标识为 `macos-transactional.5`。
- staging 完成后，仅递归清理 `extension`、`native-helper`、`skills`、`runtime`、`python` 受管组件中的 `com.apple.quarantine`。使用 `lstat` 跳过符号链接；失败则中止。用户地图配置、历史、缓存及其他 xattr 保留。
- Mac 隔离升级测试向旧 runtime、配置和安装目录外的符号链接目标注入合成 quarantine，检查受管文件清洁、配置标记保留及外部目标未被修改。
- Windows adapter、SEA、注册表、Windows installer、Native Host 名称和扩展 ID 均未改。

## 验证结果（2026-10-26）

- PR head `60f75b612fa1c3ad43f27cdf7cb4409b26dedc5c` 的 GitHub Actions run `40336593422` 成功；Mac 构建、隔离安装/升级/回滚和 Native Host 协议检查通过。Windows job 只验证构建、SEA 与协议，不代表 Windows 桌面验收。
- `node scripts/release/source-checks.cjs`：17/17 通过；证据目录：`/var/folders/q2/t3vn6_w78g__hngzhqxcpv00000gn/T/toolbox-source-checks-uw91lF`。
- 本机安装检查为成功：`0.2.7 / 2026102605`，源码提交 `60f75b612fa1c3ad43f27cdf7cb4409b26dedc5c`，安装器 `macos-transactional.5`；Chrome/Edge Native manifest、Native JSON 自检和 Python 依赖导入通过。证据：`~/.appraisal-toolbox/安装检查结果.txt`、`~/.appraisal-toolbox/BUILD-PROVENANCE.json`。
- Chrome 最初仍加载 `0.2.5`；重载原扩展 ID `aamfmhcbjgofhmannejoiilkkpchfkgm` 和路径 `~/.appraisal-toolbox/extension` 后，扩展显示 `0.2.7`。更新页显示当前/最新版本一致、安装已核验，Native Host 与土地数据源正常；随后再次检查更新未复现原错误弹窗。真实更新页面与重载检查已通过；Edge GUI 未覆盖。

## 产物、签名与剩余范围

- 当前 PR head 的 CI Mac ZIP 内部 SHA-256：`ae649e93dd5d370bedb713f630e4e7822bb8201d2217f9a1e0f0cbb49c66393d`；CI artifact [下载页](https://github.com/zer0-lyz/appraisal-toolbox-releases/actions/runs/40336593422/artifacts/12655924829)，外层 artifact SHA-256：`d66515ddce7398b7716c5b7130727abcc79a18c816ff4f72b81379c486223b39`。CI 包元数据为 `0.2.6`，不是覆盖当前 `0.2.7` 的更新包。本机候选包没有发布 URL，也没有留存可分发 ZIP/SHA。
- 产品包未 Developer ID 签名、未 notarize。官方 Release 网络下载并安装、Edge GUI 重载、签名/notarization 和 Windows 桌面更新仍未覆盖。
- 合并此 PR 只把修复放入源码 `main`；不会发布新包，也不会改变 stable 或共享 `latest`。回滚方式为 revert 本 PR 的 Mac 更新修复提交。
