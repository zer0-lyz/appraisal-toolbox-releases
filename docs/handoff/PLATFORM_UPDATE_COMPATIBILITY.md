# 分平台更新协议：实现与启用边界

新增 decoder 支持 opt-in `schemaVersion:2`，`platforms[target]` 每项必须包含 target/productVersion/buildNumber/asset.sha256。版本、build、runtimeBuildId、releaseUrl和asset从当前target获取。缺平台项/摘要非法时拒绝，不回退其他平台或全局 build。schema1 的既有行为保持不变。

根 version.json、update-sources.json、已发布共享 Latest 全部未修改。本轮仅候选源码具备新 decoder，不声称已部署新更新协议。共同构建号通过显式 `--build-number` 由协调 Issue 冻结，不能自行随日期为未重建平台提高数字。

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
