# 评估工具箱（Appraisal Toolbox）

独立于天源底稿系统运行的 Chrome 侧边栏扩展，收录评估业务中不依赖天源页面绑定的数据采集与测算工具。

- 扩展 ID（由 manifest key 固定）：`aamfmhcbjgofhmannejoiilkkpchfkgm`
- 当前版本：`0.2.1`（构建 `2026100902`）
- 许可：MIT

## 功能模块

| 模块 | 说明 |
| --- | --- |
| 浙江土地市场网 | 抓取浙江省自然资源网上交易系统成交公示，输出 Excel / HTML / 地图结果 |
| 阿里司法拍卖 | 登录淘宝后自动读取列表并核验成交详情 |
| 阿里资产租赁 | 抓取使用权出租案例并核验首年租金与租期 |
| 表格设置 | 批量统一 Word 文档中所有表格的格式 |
| 安居客数据 | 抓取物业出售、租赁案例并保存原始证据 |
| 折旧摊销与资本性支出预测 | 设置参数、录入资产并运行长周期折旧摊销预测 |
| 地图基础配置（辅助） | 配置高德地图密钥，供结果页地图生成使用 |
| 版本更新（辅助） | 检查本仓库发布的工具箱新版本 |

## 安装

1. 从 [Releases](https://github.com/zer0-lyz/appraisal-toolbox-releases/releases) 下载对应系统的完整安装包：
   - macOS Apple Silicon：`appraisal-toolbox-v0.2.1-macos-arm64-full.zip`
   - Windows x64：`appraisal-toolbox-v0.2.1-windows-x64-full.zip`
2. 解压后运行包内安装器；安装器会配置专属 Native Host `com.appraisal.toolbox.helper`、独立运行目录、Node.js / Python 与离线依赖。
3. Chrome 或 Edge 打开扩展管理页，开启开发者模式并加载安装器提示的 `extension` 目录。
4. 确认扩展 ID 为 `aamfmhcbjgofhmannejoiilkkpchfkgm`。

本产品不依赖天源浏览器工作台、Connector、MCP 或天源 CLI。macOS Apple Silicon
安装包已完成本机自检；Windows x64 安装包需在 Windows 10/11 x64 实机完成验收。

## 版本更新机制

扩展只检查本仓库的更新清单
（`https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/latest/download/update-manifest.json`），
与主工作台的更新通道完全隔离；页内不做组件覆盖安装，检测到新版本时引导到发布页下载。
正式 Release 发布前，更新页显示「尚未发布」属预期。

## 架构

- MV3 侧边栏 + 极简外壳（hash 路由、模块注册表、native messaging 封装）。
- 功能即模块：`src/modules/<module-id>/`（module.js / template.js / styles.css），模块只通过 context 使用宿主能力，禁止跨模块引用内部文件。
- 使用专属 Native Host 和独立运行目录，与主「天源浏览器工作台」安装互不覆盖。

## 相关仓库

- 主工作台（含权威源码与全部提交历史）：`zer0-lyz/tianyuan-browser-workbench`
