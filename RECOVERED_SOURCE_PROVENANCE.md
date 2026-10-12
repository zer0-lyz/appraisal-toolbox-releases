# 恢复源码来源

`native-helper/` 与 `skills/` 来自已校验的 Windows x64 v0.2.1 官方完整发布包解压目录：`C:\AppraisalToolboxAcceptance\v0.2.1\package\appraisal-toolbox-v0.2.1-windows-x64`。原始 ZIP：`C:\AppraisalToolboxAcceptance\v0.2.1\evidence\appraisal-toolbox-v0.2.1-windows-x64-full.zip`，SHA-256：`a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28`。恢复文件逐文件与包内 `SHA256SUMS` 比对通过（哈希留证据于交付目录）。这是发布包恢复来源，不声明为当前 Git checkout 原始源码。

打包前保留该发布包里的 `native_host.exe` 未复制到源码树；最终 EXE 从本次恢复的 `native-helper/native_host.js` 与本地 Node 运行时集中重建。

## Mac安装源接收（2026-10-12）

`macos/installer` 中安装/卸载源码从官方v0.2.1 Mac发行ZIP恢复，ZIP SHA256 `4570d0fa51a0284fbee1f5157731fc7bd311fae9402da4cbe896f2acdeaa792c` 与GitHub资产digest一致，之后在本轮源码提交中修订保留数据/回滚/metadata行为。`native-helper/platform/macos.js`、common及process_launcher与该包字节相同，未被Windows恢复源覆盖。历史Macsource快照为328acaca；包内额外修订另作来源，不宣称干净快照原样组包。

新共同源80eec2bb的本机Mac候选及两端CI从clean commit构建；不能将旧Windows .6包反写成该commit重建。运行时摘要一致不代表签名有效：当前Macvendor Node/Python pkg签名校验失败，#6独立核验；共享技能内部bundle摘要历史维护缺口见#7。当前执行结果与分层证据见docs/handoff/MAC_EXECUTION_STATUS_20261012.md。
