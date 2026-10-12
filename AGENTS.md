# 评估工具箱跨端协作规则

用户2026-10-12明确授权在本仓库发布Windows交接构建、通过分支/PR/Issue向Mac agent交接；历史提示词里的禁止推送已被覆盖。不直接合并main、不覆盖原v0.2.1、不将未覆盖项目说成通过。

先读 docs/handoff/README.md、WINDOWS_LESSONS.md、ACCEPTANCE_STATUS.md、DUAL_PLATFORM_PLAN.md、BUILD_RUNBOOK.md 和协调Issue。Mac任务见MAC_AGENT_PROMPT.md。

产品ID/host及原加载目录保持；原位更新前完整备份和逐文件SHA。禁止触碰天源目录、正式浏览器Profile、凭据、真实地图Key；禁止上传本机用户runtime-config、登录态日志和未脱敏截图。

native-helper/skills恢复来源见RECOVERED_SOURCE_PROVENANCE.md；对比Mac权威代码后合并，公共修复需两端审查。已通过业务修复保护；安居客/折旧维持开发中。

变更Native须按target全量重打包；installer-only可在校验bundle/源码载荷/EXE/旧ZIP后复用Native。通过/失败/未覆盖区分GUI、协议、夹具、普通桌面、agent上下文。Z1历史根因未能还原，Z2尚未修复。

提交前核对git diff，保留他人修改。当前.gitattributes保留既有混合换行的已验业务载荷字节，不在交接提交顺便格式化全树；后续如需规范化，另开PR并重建摘要。
