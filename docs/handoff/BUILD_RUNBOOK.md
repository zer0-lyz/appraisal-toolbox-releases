# 当前可复用构建操作与已知限制

当前能直接使用的是已交付完整包；本轮没有从新 commit 重建二进制。文件来源与字节映射在 release-manifest.json 和 source-inventory.json。原包固定 SHA a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28，来自官方 v0.2.1 Windows full 资产；必须重新下载时先核对摘要，不从本机用户 runtime 取文件。

## Windows 全量构建（现有入口，Windows x64）

1. 固定 Node v24.18.1；校验 Node EXE SHA 与 release-inputs.lock.json。准备新的输出目录，不覆盖历史包。
2. 使用 windows/bootstrap-build-tools.ps1 -ToolsDirectory <缓存目录>，依赖版本/integrity 见锁。此脚本不跑 npm install scripts。已有缓存仍逐项核验摘要，不禁用 TLS。
3. 从普通构建上下文用 Node 参数数组调用：

    node windows/build-windows-fix2.cjs <已验原始完整ZIP> <新的输出目录> <构建工具目录> round2

4. 注意：PowerShell 包装 build-windows-fix2.ps1 目前不暴露 suffix，会默认旧 fix2。当前 Node builder 的 installerBuild 仍硬编码 .5，即使包内 installer 为 .6。在后续统一入口实现并验收前，必须执行第5步收尾，不能直接发布全量 builder 输出。不要用 shell 当前系统 python.exe。
5. 收尾入口（已有实现）：

    node windows/finalize-windows-fix2.cjs <第3步输出目录> <另一个新的最终输出目录>

它读取当前 install.ps1 的 installerBuild、校验业务/Native/技能逐文件一致、复用已验 EXE、重写包清单。若业务与前一包不同会拒绝，必须先全量构建。历史 build-result.json 含本机绝对路径，跨机需重建本地输出，不直接篡改路径冒用证据。
6. 现有 builder self-test 带 TIANYUAN_* 覆盖变量，只证明构建内 smoke。验收还必须在隔离安装副本清空这些覆盖变量，再运行实际 native_host.exe --self-test 并检查4入口；业务至少覆盖真实无env Excel导出。
7. 发布前检查 ZIP/内层 SHA/source inventory；只发布最终输出，保留失败中间候选和证据，不混用。

现有脚本的 PowerShell 执行方式属于待审流程，不因方便而全局变更系统执行策略；受组织策略阻断时报告具体原因，不绕过。本轮只审计和复用已验包，没有执行全量 builder。

## 安装器收尾适用范围

只改 installer/docs 时可以复用 EXE，前提是源码业务载荷、bundle/EXE/旧ZIP全部匹配；不能仅凭文件名 reuse。完整安装 ZIP 含 install.cmd，不是图形向导 EXE。解压后由用户在普通桌面会话运行安装，先完整备份，验收不碰正式 Profile。

## Mac

本仓库尚没有经本轮验证的 Mac 可复现构建入口。Mac agent 应恢复/审查真实 Mac 构建脚本和来源，纳入公共仓库。不得在 Mac 交叉构建 Windows SEA 然后跳过 Windows runtime 验收；不得把 Windows python-portable 复制到 Mac。双端通用代码及协议在同一 commit，平台依赖按 target 锁定。

锁文件描述当前交付输入，不是新入口已落地的承诺；后续实现/CI接入任务见 DUAL_PLATFORM_PLAN 和协调 Issue。
