# Mac 一键更新中的 Chrome quarantine 传播修复（2026-10-26）

## 根因

v0.2.7 的一键更新已从锁定 wheel 重建 Python 环境，但用户实际点击更新时，Native Messaging 更新进程下载出的 `update.zip` 仍带 `com.apple.quarantine`，来源标记为 Chrome。外部文件尺寸和 SHA-256 已与正式发布清单匹配；之后 `ditto -x -k` 把 archive 的 quarantine 属性传播给 `.pkg`、wheel 等解包成员，`pip` 安装出的 `lxml/etree.cpython-314-darwin.so` 因而继续带标记。macOS 27.0.1 在导入时拒绝这个 ad-hoc 签名的扩展，导致新目录自检失败。原安装器的 Python 重建修复仍有效，但没有覆盖“下载 archive 自身带 quarantine”这条真实更新链。

现场证据：本机 transaction 保持 `unknown / recoveryBlocked`，安装目录仍为 v0.2.5；失败日志记录到更新到 v0.2.7 时 `lxml.etree` 的 `library load disallowed by system policy`。下载 ZIP、内置 Python.org pkg、lxml wheel 和安装后的 lxml 扩展均读到 `com.apple.quarantine`，agent 为 Chrome。真实安装未再次运行，原事务、快照和更新包均保留。

截图中的 `libprobe.dylib` 不在该 v0.2.7 解包目录或 Python.org 3.14.6 pkg payload 列表中；系统日志只提供 `libprobe.dylib` 标识和脱敏路径哈希，无法从现有证据确认它与此更新包的关系。以下修复针对已证实的 Chrome quarantine 传播和 lxml 导入失败；`libprobe.dylib` 仍须在隔离安装/真实 GUI 中复核。

## 修复

- `native-helper/update_engine_macos.js` 仅对更新缓存中的普通文件读取 xattr；在官方更新清单提供的预期尺寸与 SHA-256 均匹配后，只移除该 ZIP 的 `com.apple.quarantine`，并回读确认已消失。若检查或移除失败则失败关闭；不触碰其他属性、下载目录中的原始文件、系统 Gatekeeper 或普通手动安装。
- 随后仍执行 ZIP 内部 `SHA256SUMS`、目标平台、版本、runtime 和来源验证。`com.apple.provenance` 等其他属性不在清除范围。
- `macos/installer/install.sh` 将 Python 依赖导入自检前移到 staging 阶段、原安装目录替换之前；自检失败时原目录尚未切换。安装器标识升为 `macos-transactional.4`。
- 仅修改 Mac updater/installer、Mac 回归和构建交接；Windows adapter、SEA、注册表与安装器不变。

## 验证要求与边界

回归需在更新器下载路径注入合成 Chrome quarantine，证明：SHA 校验后 ZIP quarantine 消失、解包成员不带该标记、真实隔离安装的 lxml 导入成功、配置/历史保留和失败回滚仍通过。该测试不代表 Chrome GUI、官方 Release 网络链或普通手动安装验收。

产品 host/ZIP 仍未 Developer ID 签名或 notarize。用户不需要 Apple Developer 会员；发行者会员只影响 Apple 官方签名和 notarization。这里的更新路径基于用户点击更新、官方 Release SHA-256 与包内清单做限域信任，不能写成 Apple 已签名或已公证。

稳定版、共享 `latest` 和 `main` 不更新；Windows build/桌面验收状态不变。当前本机 `unknown/recoveryBlocked` 事务没有清理、重试或覆盖，需单独完成可审计恢复后才能进行本机更新。真实 `libprobe.dylib` GUI 路径尚未确认。
