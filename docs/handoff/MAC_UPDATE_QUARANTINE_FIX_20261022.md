# Mac 更新时 Python 扩展保留 quarantine 的修复（2026-10-22）

## 现象与根因

本机安装树显示产品 `0.2.3`、buildNumber `2026101805`、安装器 `macos-transactional.1`。其中 `lxml/etree.cpython-314-darwin.so` 的 SHA-256 为 `ef54cd810b15d2ef4acf50cb904b7321bbfe248deebcacfd3e655c86fac8d512`，与天源工作台本机对应文件字节一致；工具箱副本带 `com.apple.quarantine`，天源副本没有。文件字节没有损坏，隔离标记不同。

Mac 安装器先用 `ditto` 将旧安装根复制到 staging，随后只删除扩展、Native Helper、技能和 Node 运行时目录。旧 `python/` 虚拟环境仍在 staging；再次执行 `python -m venv` 不会清除既有 `site-packages`，pip 也可能将已有的 lxml 判定为满足版本要求。因此旧 `.so` 及其 quarantine 属性会跟随 staging 到新安装。Native Helper 的下载实现通过 Node 流直接写入 ZIP，而不是调用浏览器下载；随后由 `ditto` 解包。隔离实验确认 `ditto` 会把带 quarantine 的 ZIP 中该属性传给解出的文件，并在目录复制时继续保留。实测旧安装树的 `.so` 已带 quarantine，更新器的 `ditto` staging 复制会保留它；这解释了现有一键更新链为何仍可能在重建运行时后遇到 Gatekeeper。

## 修复

安装器现在在创建虚拟环境前删除 staging 中的 `python/`，之后仅从包内 SHA 锁定的 wheel 重新安装依赖。原安装根和用户数据不在此步骤改写；安装事务的快照与回滚路径不变。安装器标识由 `macos-transactional.2` 升至 `.3`。

新增隔离升级回归：先在 disposable HOME 中真实安装，再给旧 Python 环境里的全部原生扩展 `.so` 和随包 Node 设置合成 quarantine 标记，执行真实升级器；升级后逐个确认 Python 扩展及 Node 均无旧标记，导入 `charset_normalizer`、`requests`、`openpyxl`、`lxml` 和 `python-docx`，并核验替换后的 Node Developer ID 签名。回归同时保留原有合成配置/历史文件、Native 自检、Chrome/Edge manifest 核验和 Edge 注册失败后的回滚测试。整个测试不接触正式 Profile、凭据、地图 Key 或天源运行目录。

## 安全与发布边界

没有删除文件的 quarantine 属性、关闭 Gatekeeper、复制天源运行时或修改签名策略。修复针对更新时残留的旧 Python 环境；产品 ZIP/launcher 仍需独立的 Developer ID 签名和公证工作，尚未签名/公证的手动浏览器下载在新安装场景仍可能触发 Gatekeeper。收件用户不需要 Apple Developer 会员；发行者需要配置可信的签名与公证流程才能解决未签名发行包的门禁问题。

此候选仅用于代码与隔离回归，不发布 Release，不改 stable/latest，不安装到本机正式目录。
