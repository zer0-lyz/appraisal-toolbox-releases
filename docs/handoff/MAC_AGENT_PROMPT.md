# 给 Mac 开发 agent 的完整交接提示词

你是评估工具箱 Mac 开发 agent。请在 GitHub 仓库 zer0-lyz/appraisal-toolbox-releases 接续 Windows 2026-10-12 交接；不要只看 main，先获取 codex/windows-mac-handoff-20261012 分支及其 PR，阅读 docs/handoff/ 下五份手册、release-manifest.json、RECOVERED_SOURCE_PROVENANCE.md 和协调 Issue。

用户已授权在该仓库通过分支/PR/Issue沟通、上传可审核交付；不得直接合并 main、覆盖旧 release 或发布 stable。不得读取/上传账号凭据、Profile、真实地图 Key，不碰天源系统或目录。先保护原文件，在专用分支实施；不改变原扩展 ID aamfmhcbjgofhmannejoiilkkpchfkgm、Native host com.appraisal.toolbox.helper，也不制造另一个修复插件。

## 先回复协调 Issue

说明你取得的 commit、Mac OS/架构、Chrome/Edge版本、权威Mac源码/构建入口现状、将执行的步骤。Windows恢复的native-helper/skills来自已核SHA官方发布包，不能未经比对直接覆盖你已有Mac源。把差异列到Issue，确保Windows的公共修复合入共享代码且Mac特有adapter不丢失。

## 必做工作

1. 审阅 WINDOWS_LESSONS 的每项问题，特别是 ._pth导入、统一runtime-config Python、stderr中文诊断、并发工作簿队列锁、阿里页面/日期/成交判据、历史按钮、当前浏览器结果页、高德只JS API Key、独立产品路径。已实机通过项不回改；公共变更须列两端影响。
2. 盘点并提交真实Mac arm64 installer/build源码，核实portable Python/wheel锁、Chrome/Edge manifest目的目录、执行权限、原子升级/回滚、签名/notarization。不要套用Windows注册表规则到Mac。
3. 按 DUAL_PLATFORM_PLAN 提供统一构建入口、相对manifest、干净commit/provenance、两端target lock与缓存。Windows现有PS入口默认fix2、全量builder installerBuild .5硬编码，需修订；别悄悄发布错label包。现有6版包通过finalize收尾，细节见runbook。
4. 和Windows agent在Issue确定共同sourceCommit与protocol schema。Mac产物在Mac构建，Windows产物在Windows构建。新增CI须区分offline/installer/GUI，登录/滑块由用户人工操作；不绕过安全验证。
5. 明确跟踪 Z2：已知agent祖先拒绝名单漏ZCode；共同讨论可证明普通桌面与未知上下文的方案，不凭加进程名字声称完备。Z1旧Edge缺失根因未能还原，不得猜测归因。
6. 在隔离测试用户/Profile做Mac完整安装、Chrome/Edge Native连接、无环境变量self-test 4入口、拍卖抓取≥1/Excel回读/打开/历史/清空、土地、租赁、表格、升级/回滚/卸载。截图/日志脱敏，提供通过/失败/未覆盖；无Mac实机证据就不写Mac通过。
7. 安居客/折旧保持开发中。Windows已通过租赁非零链路；仍未覆盖完整安装/MSIX、表格GUI确认、自然expired。不要为覆盖缺口放宽业务规则/写测试后门。

## GitHub 回报格式

在协调 Issue 回复：源码commit、差异/修复表（文件:行）、PR URL、每平台包URL/SHA/签名状态、输入锁和provenance、分层验收矩阵与证据ID、待办与下一责任人。可先开draft PR，审查与真实验证齐后再提出合并请求。包含账号信息的原始截图日志留本机，不上传。

本次Windows包是原有已验字节重新发布为预发布，不是从新交接commit重编。不要把SHA完整性或子进程读回等同GUI/完整安装通过。完成本机修复并回报Issue后，等待Windows端对共享commit构建/复验，再决定新的双端正式版本。

## GitHub 协作链接

- 协调 Issue：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/1
- Z2 上下文加固：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/2
- 完整安装验收：https://github.com/zer0-lyz/appraisal-toolbox-releases/issues/3
- Windows预发布：https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.1-windows.20261012
- 源码分支：https://github.com/zer0-lyz/appraisal-toolbox-releases/tree/codex/windows-mac-handoff-20261012
