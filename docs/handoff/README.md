> 2026-10-12 Mac接收增补：统一入口/根两目标锁/缓存/manifest/双平台CI已落地；当前结果以 [MAC_EXECUTION_STATUS_20261012.md](MAC_EXECUTION_STATUS_20261012.md) 和 [UNIFIED_BUILD_RUNBOOK.md](UNIFIED_BUILD_RUNBOOK.md) 为准。以下内容保留Windows历史交接的时间边界；不得把旧“待实施”状态当成当前状态，也不得把新CI通过等同GUI/完整安装全面通过。

# Windows / Mac 双端交接入口（2026-10-12）

产品仍为评估工具箱 0.2.1，扩展 ID aamfmhcbjgofhmannejoiilkkpchfkgm，业务 build windows-e2e-round2.1。
本次上传 Windows 完整 ZIP 是 2026-10-11 最终包的字节不变副本；没有重新编译 Native、没有创建新插件，也没有重新跑 GUI 验收。安装器 build windows-context-attested.6。

- [Windows 问题与预防清单](WINDOWS_LESSONS.md)
- [双端开发与发布方案](DUAL_PLATFORM_PLAN.md)
- [当前构建入口与限制](BUILD_RUNBOOK.md)
- [验收结果与发布边界](ACCEPTANCE_STATUS.md)
- [Mac agent 可直接执行的交接提示词](MAC_AGENT_PROMPT.md)
- [本次公开交付清单](release-manifest.json)

GitHub 分支是累计修复的代码审查载体；协调 Issue 是双方持续沟通入口；预发布 Release 是 Windows 安装资产入口。main 未合并；本轮没有构建或验证新 Mac 包。历史 windows/MAC_CODEX_HANDOFF_PROMPT.md 中的禁止推送限制已被用户本次明确授权 GitHub 交接覆盖，以本目录提示词为准。

原始源码并不完整：native-helper/skills 从已核对官方 Windows 包恢复后修复，来源见 RECOVERED_SOURCE_PROVENANCE.md。不要把恢复目录当成经过 Mac 端审核的原始源码。

## GitHub 协作链接

- 协调 Issue：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/1
- Z2 上下文加固：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/2
- 完整安装验收：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/3
- Windows预发布：https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.1-windows.20261012
- 源码分支：https://github.com/zer0-lyz/appraisal-toolbox-releases/tree/codex/windows-mac-handoff-20261012
