# 分平台更新协议：实现与启用边界

## 2026-10-18：v0.2.3 发布分支状态（尚未发布）

本节记录当前独立发布分支；下方原说明是 2026-10-12 的历史状态。分支把 `version.json` 设为 `0.2.3`、buildNumber `2026101805`、`channel=stable`，供真实 Windows x64 与 Mac arm64 构建使用；`native-helper/update-sources.json` 仍指向 GitHub Latest，未在分支或远端切换。尚无 v0.2.3 Release 或上传资产。

计划使用 schema 2 清单时，根字段保留旧客户端读取的共同 `productVersion`、`buildNumber`、`channel`、`runtimeBuildKind`、`runtimeBuildId` 和双平台 `assets`；`platforms.windows-x64` 与 `platforms.macos-arm64` 各自记录实际 target、版本、build、runtime 指纹和对应 asset。新 decoder 选择本机 target 并拒绝缺项/非法摘要；未带该 decoder 的客户端仍按已有根级全局 build 比较及 `assets[target]` 选择。发布前须以两端真实 CI ZIP 的文件名、URL、字节数、SHA 和包内版本填清单，再运行 `review-update-manifest.cjs`；不能把下方格式示意当成 v0.2.3 清单。

单一共同 buildNumber 只有在两个平台都由同一源码 commit 构建并核对 runtimeBuildId 后才可发布。真实在线更新、旧 v0.2.2 Windows 宿主自举与桌面回滚仍未覆盖；其限制见独立验收记录。正式 Release / Latest 切换需待主 agent 技术复核。

新增 decoder 支持 opt-in `schemaVersion:2`，`platforms[target]` 每项必须包含 target/productVersion/buildNumber/asset.sha256。版本、build、runtimeBuildId、releaseUrl和asset从当前target获取。缺平台项/摘要非法时拒绝，不回退其他平台或全局 build。schema1 的既有行为保持不变。

当时根 version.json、update-sources.json、已发布共享 Latest 全部未修改；该句只描述本文件下方历史说明写入时的状态，不代表 2026-10-18 发布分支状态。共同构建号通过显式 `--build-number` 由协调 Issue 冻结，不能自行随日期为未重建平台提高数字。

```json
{
  "schemaVersion": 2,
  "repository": "zer0-lyz/appraisal-toolbox-releases",
  "platforms": {
    "macos-arm64": {
      "target": "macos-arm64",
      "productVersion": "0.2.1",
      "buildNumber": 2026100901,
      "asset": {"fileName": "mac-candidate.zip", "url": "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/EXAMPLE/mac-candidate.zip", "sha256": "REPLACE_WITH_REAL_SHA"}
    },
    "windows-x64": {
      "target": "windows-x64",
      "productVersion": "0.2.1",
      "buildNumber": 2026101201,
      "asset": {"fileName": "windows-candidate.zip", "url": "https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/EXAMPLE/windows-candidate.zip", "sha256": "REPLACE_WITH_REAL_SHA"}
    }
  }
}
```

此为格式示意，不能上传为更新清单。单元回归使用合成有效SHA，验证Windows单独提高不触发未变Mac；schema1仍沿用全局build（因此旧客户端仍有原兼容风险）。

启用须双方在 #1协调：首先共同版本升级将decoder交付给两端；旧清单固定在双方都有的共同版本/build/已存在资产，不能为Windows单独修复提高全局字段；新客户端另读专用v2清单。v1 endpoints继续提供兼容清单，不能把仅有platforms的v2文件直接替换给旧客户端。更高产品版本必须两目标都有对应资产，mandatory也按平台处理；stable/prerelease按平台分别审批。该feed分离/配置切换/正式签名/门禁尚未执行，负责人为Mac共享协议维护者与Windows发行维护者。

新GitHub分平台正式Release不自动等于切换Latest。旧客户端通过GitHub Latest API的 fallback同样需审计，不能只修改一个manifest便声称完全兼容；本PR没有变更该fallback。启用前两端用旧0.2.1、新候选、缺平台、同版本不同build、runtime修复、预发布/正式混合矩阵验收。

## 2026-10-21：Mac 后台更新状态协议候选（PR #15）

以上 2026-10-18“尚未发布”仅是历史记录；本次 Mac 修复基于已存在的正式 v0.2.3 源 commit `9de4d81ca48f4aa4722775e010ba0f7dad2029b8`，未自行修改任何发布源。当前候选仍是 0.2.3、buildNumber 2026102101、candidate/local，不把 PR #14 的 CI artifact 当作新 Release。

新增可选 `updateStatusSupported`：仅 Native 声明支持时，页面调用只读 `get_update_status`。启动请求的 `event=complete,accepted=true,state=starting,verified=false` 只结束启动回执，不表示安装成功。`starting/busy/installing/recovering` 继续等待；`complete` 且 `verified=true` 才成功并请求当前浏览器扩展重载；`rolled_back/failed_safe` 且 `verified=true` 允许重试但不重载；unknown 或未核验终态阻止重复安装。页面重开/流断开后仍读取持久状态，不能以网络错误推断原版本未变。

Mac adapter 与 installer 使用自己的事务及进程模型。Windows capability=false 时页面沿用原 stream；新增只读动作不得开启天源 Connector/Bridge 动作。双方从同一最终代码 commit 分别构建，Windows 需要对共享 UI/协议及本平台 adapter 单独验收。产品签名/notarization、正式官方源完整升级、真实重载后版本握手仍须独立证据。
