# 恢复源码来源

`native-helper/` 与 `skills/` 来自已校验的 Windows x64 v0.2.1 官方完整发布包解压目录：`C:\AppraisalToolboxAcceptance\v0.2.1\package\appraisal-toolbox-v0.2.1-windows-x64`。原始 ZIP：`C:\AppraisalToolboxAcceptance\v0.2.1\evidence\appraisal-toolbox-v0.2.1-windows-x64-full.zip`，SHA-256：`a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28`。恢复文件逐文件与包内 `SHA256SUMS` 比对通过（哈希留证据于交付目录）。这是发布包恢复来源，不声明为当前 Git checkout 原始源码。

打包前保留该发布包里的 `native_host.exe` 未复制到源码树；最终 EXE 从本次恢复的 `native-helper/native_host.js` 与本地 Node 运行时集中重建。