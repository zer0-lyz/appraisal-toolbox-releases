# 逐项采用审查：Mac 与 Windows 影响、回滚和证据

完整逐文件哈希/决策见同目录 `file-classification.csv`。本表按可回滚的功能组说明平台影响；Windows build16实际GUI仍未覆盖。

| 项目/文件 | 采用决定与理由 | Mac影响 | Windows影响 | 回滚与证据 |
|---|---|---|---|---|
| 高德相机：`native-helper/map-assets/amap-only.js`、`skills/map-shared/update_map_page.py`、`windows/tests/amap-only.test.cjs` | 采用单SDK相机、SDK投影锚点、有限值和解绑保护；保留数据坐标，避免双相机/CSS缩放漂移 | 共用逻辑生效；Leaflet + 模拟AMap回归通过，真实地图/触控板未覆盖 | 共用逻辑进入Windows重建；需在真实AMap Key和桌面复测 | 回退08693提交中对应文件；`evidence/client-summary.json`、`evidence/map-integration.log` |
| 更新状态/协议：`src/modules/updates/{module.js,template.js}`、`src/shell/{index.html,shell.js}`、`native-helper/{native_host.js,update_checker.js,platform/update.js}` | 采用能力协商、阶段/终态、忙态、错误诊断、旧宿主拒绝和同版本防降级；保留Mac #5 schema2 decoder接口 | adapter报告不支持自动更新，继续手动下载；不加载Windows engine | dispatcher仅Windows x64加载`update_engine.js`；Windows仍需真实下载安装GUI验收 | 回退08693中对应源文件；`evidence/update-ui-summary.json`、`evidence/packaged-host-summary.json` |
| Windows updater：`native-helper/update_engine.js` | 仅作为Windows实现保留；不能在Mac运行；PowerShell/注册表操作不移入Mac | Mac host在能力判断后拒绝更新，不加载engine | Windows可使用原16版引擎代码，重建后须进行包级成功/失败/取消/防降级验证 | 从08693回退engine/dispatcher成对文件；packaged-host摘要证明Mac拒绝路径 |
| Native/Python/工作簿：`native-helper/native_host.js`、`src/modules/workbook-tools/*`、三项技能目录`skills/{appraisal-declaration-print-format,appraisal-detail-print-format,asset-link-restore}/` | 采用allowlist、7入口导入、工作簿调用队列/锁、报告名避免覆盖；保持工具development阶段，不扩大业务授权 | Mac锁/路径策略保留，7入口在包内runtime独立导入 | Windows需用锁定Python重跑7入口、三种表格动作和并发busy检查 | 回退08693中Native/模块/skills文件；`evidence/packaged-host-summary.json`、historical logs |
| Windows安装适配：`windows/installer/{install.ps1,extension-deployment.ps1}`、`native-helper/platform/windows.js`、`windows/build-windows-fix2.cjs` | 只保留Windows专属实现；exit 1文件选择失败、exit 2取消；绝不转换成Mac安装路径 | 不参与Mac adapter；Mac安装脚本、原扩展ID和host不变 | 下次包要测普通桌面注册、升级/回滚、Edge注册失败 | 回退08693中这组Windows文件；Mac isolated installer摘要与其分离 |
| 构建门禁：`scripts/release/{build.cjs,build.test.cjs,intake-contracts.test.cjs,source-checks.cjs,update-ui-fixtures.cjs}`、`windows/build-windows-fix2.cjs` | 统一入口和旧Windows直建入口都强制source-checks；防止操作者绕过回归；保留clean source、输入锁和source drift拒绝 | Mac构建固定清洁源码/runtime摘要后再打包 | 两个Windows入口都阻断source-checks失败的包；仍需Windows环境/SEA验证 | 先回退fe41，再回退20a6、08693；`evidence/final-source-checks.log`、`evidence/mac-build-validated.log` |
| 土地/拍卖/租赁约束：`skills/zj-land-publicity/tests/test_land_publicity_runner.py`、`skills/map-shared/update_map_page.py`及交付技能 | 测试夹具补齐HTTP status/header/body/total，生产严格校验保持；不改变日期、成交、坐标、验证码或人工复核判据 | 修复后的共享逻辑可在Mac包运行；本轮历史测试8/8 | 同一业务源重建后测试仍强制；真实网站/Excel GUI分别验收 | 回退20a6仅含HTTP fixtures；业务源如需回滚再单独revert 08693对应文件；`evidence/historical-land.log`、`evidence/historical-depreciation.log` |

## 整体回滚

Mac PR #11仍为draft。若review发现问题，关闭PR即可避免合入；若要回退分支上的代码提交，按时间倒序revert `fe41e9f5`、`20a6ed8e`、`08693a9a`，不改#5原分支。候选Release是独立prerelease，不会重写稳定资产或latest；若候选有问题，应发布修正版并在Issue标明，不复用旧包摘要。
