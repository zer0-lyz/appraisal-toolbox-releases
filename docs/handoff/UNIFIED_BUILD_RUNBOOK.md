# 同一 commit 双端候选构建

入口已实现，正式发布不属于本入口。输出与缓存必须在源码树外、输出必须新建。构建拒绝 tracked/untracked 脏树；锁文件 hash、sourceCommit、installerBuild、载荷 SHA 与候选 ZIP SHA 自动生成。当前候选版本为 0.2.2（buildNumber 2026101701），stable 与共享 Latest 仍为 0.2.1；ID/host 不变。本入口只生成候选，不发布 Release。

## Mac arm64

```bash
node scripts/release/build.cjs --target macos-arm64 --version 0.2.2 --build-id mac-candidate-20261017 --build-number 2026101701 --output /tmp/toolbox-mac-candidate --cache /tmp/toolbox-build-cache --base-archive /path/appraisal-toolbox-v0.2.1-macos-arm64-full.zip
```

`--base-archive` 可省略，入口从根锁的指定发行资产下载并校验 SHA；已命中按 target+lock+baseSHA 缓存也逐文件核验，拒绝额外文件。仅复用官方 runtime（Node/Python pkg/全部离线 wheels）；业务每轮取 Git tracked 源码。`--python` 指定组包标准库解释器，默认 `/usr/bin/python3`，实际版本/摘要记录于 provenance；它不是交付 Python，不能代替四入口/Excel 验收。

Mac 安装器为源码 host + 固定官方 Node，无产品 codesign/notarization。运行时由官方 Python 3.14.6 pkg 和 SRI已锁 wheel 安装，普通用户实际运行 `安装.command` 时严格检查该 Python 精确版本；缺版本时官方框架安装需要用户正常交互。本任务不自动安装全局框架、不移除 quarantine、不操作正式 Profile。

```bash
bash macos/test-isolated-install.sh /tmp/toolbox-mac-candidate/<manifest.packageRoot> /tmp/toolbox-mac-validation
```

真实官方 pkg 解出精确 Python 3.14.6 至测试目录，用 `DYLD_FRAMEWORK_PATH` 指向隔离副本；无需安装全局框架。真实 install.sh 在独立 `APPRAISAL_TOOLBOX_ROOT` / `APPRAISAL_BROWSER_HOME` 中执行初装、保留合成 history/cache/workbooks 的升级、真实 Edge路径写失败后的回滚。随后真实打包 host 清空 Python/skills 覆盖变量进行4入口/Excel回读/三表格模式/NM URL 验证。环境与 GUI 边界在 summary 明示；不是普通桌面/真实 Chrome Edge 首连/网络抓取验收。

## Windows x64

```powershell
# 官方 v24.18.1 node.exe 必须与锁 SHA 一致；不可用其他 Node 替代。
./windows/bootstrap-build-tools.ps1 -ToolsDirectory C:/ToolboxBuildCache/tools
node scripts/release/build.cjs --target windows-x64 --version 0.2.2 --build-id windows-candidate-20261017 --build-number 2026101701 --output C:/ToolboxCandidate --cache C:/ToolboxBuildCache --tools C:/ToolboxBuildCache/tools --base-archive C:/Inputs/appraisal-toolbox-v0.2.1-windows-x64-full.zip
```

工具下载只信根锁固定 URL/SHA512，不动态接受 registry 改变的 integrity；缓存 tar 核验后逐文件对已解模块，拒绝额外模块文件。Windows 全量 adapter 使用同一 clean source commit，自动读取 `.6`。旧 wrapper 改为 mandatory BuildSuffix，取消静默 fix2。不全局变更执行策略。Windows suffix仅兼容旧命令，统一参数才是新入口。

`--reuse-native <旧build-result.json>` 要求旧ZIP、EXE、bundle SHA 及全部 native-helper/skills 字节与路径集合相同。无匹配或有文件增删时拒绝复用；同业务/安装器修改仍重封装 extension/新 lock/metadata。Mac 源 host 每轮复制，不需要 SEA 缓存。工具/运行时按摘要复用，不以文件名或存在性判定安全命中。

## CI与验收

`.github/workflows/dual-platform-candidate.yml`：同一个 PR merge commit 在 macos-15 arm64 与 windows-2022 x64 构建，contents:read，无发布凭据/无自动 Release/无 Latest 修改。每端 source checks + candidate build + actual packaged-host imports/合成Excel/NM；Mac增加真实脚本隔离安装/升级/回滚。Windows CI只做NM/离线，不调用Windows正式安装器，不宣称普通桌面/MSIX通过。

托管 runner 名称及系统映像会更新；入口检查实际 OS/arch，provenance记录实际 macOS/组包工具版本。根锁的 vendor Node/Python/wheels/Windows SEA tools 精确锁定，OS系统工具用镜像来源+运行时版本记录，不能宣称 OS 工具也由固定二进制摘要交付。Windows Authenticode与Mac notarization另设发布门槛。

构建失败保留新输出诊断，不覆盖旧资产。测试可能生成 pycache，正式包只从 git tracked 源复制，runtime库存为锁定快照。发布前两个平台负责人在 Issue #1给共同sourceCommit、包SHA、构建来源、GUI/安装/离线分层结果；失败/未覆盖必须保留。
