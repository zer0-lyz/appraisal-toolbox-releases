---
name: 浙江省自然资源厅土地成交数据抓取
description: "抓取浙江省自然资源网上交易系统（zjzrzyjy.com）土地成交公示数据。适用于抓取浙江自然资源土地成交公示、绍兴/金华等地区工业仓储用地成交数据；提取公示编号、地块信息、成交结果、受让单位等字段；解析 content 字段提取土地详情；保存为 Excel；可选导出 resourceCoordinate 坐标并生成地图。"
---

# 浙江自然资源土地成交公示抓取技能

## 概述

抓取浙江省自然资源网上交易系统（zjzrzyjy.com）土地成交页面实际使用的成交结果数据，从 `land-bidding` 列表 API 获取记录，按行政区和官网查询日期收窄候选，再读取详情复核并整理为 Excel。工作台界面固定查询国有土地、挂牌出让/拍卖出让、结果公示；查询日期按官网列表的报名/挂牌开始时间，结果表同时保留成交公示发布时间。坐标功能优先读取详情接口 `queryResourceDetail` 的 `resourceCoordinate`，并可额外生成坐标 JSON / 地图 HTML；如果接口缺失，再回退到宗地界址图 PDF 渲染流程。

## 运行前确认

如果用户没有明确给出参数，不要默认全量抓取。先确认以下信息，再执行：

- 行政区名称，例如 `绍兴`、`镇海区`
- 成交公示起始日期和结束日期，例如 `2025-01-01` 至 `2025-12-31`
- 是否需要按 `districtName` 精确匹配，适合区县名
- 是否需要导出坐标，或同时生成地图
- 输出文件路径，若不提供则脚本会自动命名

工作台中的交易条件不提供选择项，抓取页数由模块内部固定为 50 页。当前网页使用的列表接口支持 `regionCode`、`enrollStartTime`、`nowTime` 和 `resourceStage=CJ`，运行器会先按行政区和官网查询日期向服务器请求候选；列表返回的 `ggPubTime` 作为结果表中的成交公示发布时间，查询日期本身使用 `_queryDate` 保存的报名/挂牌开始时间做本地闭区间复核。土地用途、位置关键词等条件再在候选列表和详情阶段复核。旧的 `queryPublicityList` 接口仍保留在脚本中供历史调用，但工作台不再使用它。

同一组有效筛选条件会生成稳定的查询指纹，并复用同一组 Excel、HTML 和地图文件路径；再次点击抓取时会更新原文件，不会重复生成一套带时间戳的新文件。改变行政区、日期、用途、分页上限等查询条件会得到独立结果；地图开关只控制同一结果的附属地图文件，不改变查询指纹。新结果先在临时目录完成生成和校验，再通过原子替换覆盖旧结果；抓取失败时保留上一版 Excel/HTML。关闭地图后，旧的地图附属文件会在新结果提交后清理。

每次成功运行还会在结果目录生成同名的 `_history.json` 历史清单，保存筛选参数、原始列表记录、详情快照、坐标和结果文件关系，不保存登录凭据。工作台可以扫描当前选定目录，也兼容没有历史清单的旧版土地结果 Excel；加载历史清单后可直接打开原地图/表格，或只针对历史记录重新读取详情并重新生成结果。历史复用和重新抓取均继续使用同一套筛选、详情回读和原子输出门禁。

如果信息不全，先询问用户，不要直接使用默认值跑全量。

## API 信息

### 成交结果列表接口
- **URL**: `https://www.zjzrzyjy.com/trade/view/landbidding/querylandbidding`
- **方法**: GET
- **参数**:
  - `currentPage`: 页码，从 1 开始
  - `pageSize`: 每页条数（运行器使用 50）
  - `regionCode`: 行政区代码，可传逗号分隔的代码集合
  - `enrollStartTime`: 查询起始时间戳（毫秒）
  - `nowTime`: 查询结束时间戳（毫秒）
  - `resourceStage=CJ`: 只读取成交结果阶段
- **Referer**: `https://www.zjzrzyjy.com/landView/land-bidding`

运行器从官网行政区树解析地市/区县代码；接口返回的 `ggPubTime` 是成交公示发布时间，日期筛选最终以该字段复核。

土地用途、位置关键词、交易方式等未被该接口支持的条件，不会伪装成服务器端筛选；运行器通过 `record_filter` 在详情请求前收窄候选，缺失字段的记录保留并交由详情阶段判断。

### 附件文件接口（获取出让公告、勘测图等下载链接）
- **URL**: `https://www.zjzrzyjy.com/trade/view/landbidding/queryLandResourceUploadFile`
- **参数**:
  - `resourceId`: 地块 resourceId（sourceId）
  - `fileType=XZWJ`: 文件类型（其他类型包括 XCZP、QWT 等）
  - `currentPage=1&pageSize=200`
- **Referer**: `https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={sourceId}`
- **PDF 下载 URL**: `https://file.zjzrzyjy.com/data/{日期}/{fileId}.pdf`
  - 示例: `https://file.zjzrzyjy.com/data/2026/03/25/2036703101888630784.pdf`

### 详情页 URL（source-detail 页面）
- **URL格式**: `https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={sourceId}`
- **注意**: 该页面为 SPA 动态加载，需浏览器渲染才能获取容积率等字段

## 关键字段说明

| API字段 | 说明 |
|---------|------|
| `resourceId` | 地块资源 ID，归一化为 `sourceId`（用于详情和附件接口） |
| `resourceNumber` | 地块编号/公示编号，归一化为 `sourceCode` 和 `publicityId` |
| `xzqName` | 行政区名称，归一化为 `districtName` |
| `regionCode` | 行政区代码，归一化为 `districtCode` |
| `ggPubTime` | 成交公示发布时间，归一化为 `releaseTime` |
| `planUse` | JSON 土地用途，归一化为 `landUse` |
| `resourceLocation` | 地块位置 |
| `landAreaForAre` / `landArea` | 土地面积（亩）/平方米 |
| `startPrice` / `cjj` | 起始价/成交价，接口单位通常为万元 |
| `transactionMode` | `GP`/`PM`，结合 `transactionType` 归一化为交易方式 |
| `resourceStage` | `CJ` 归一化为“结果公示” |

工作台按归一化后的 `_queryDate`（来源为 `enrollStartTime`/`listingStartTime`）对官网查询日期执行起止日期闭区间筛选，起始日和结束日均包含；Excel 的“发布时间”列使用 `releaseTime`（来源为 `ggPubTime`）。

### 字段清洗规则

1. **成交结果**: 新接口的 `cjj` 按万元记录，直接写入成交总价；单价按成交总价×10000÷平方米计算
2. **起始价**: 新接口的 `startPrice` 按万元记录，直接写入起始总价；单价按起始总价×10000÷平方米计算
3. **土地面积**: 优先使用 `landAreaForAre` 和 `landArea`；缺失平方米时按亩×666.67计算
4. **出让年限**: 优先读取详情 `transferPeriodTo`，否则从 `assignmentPeriod` 提取“数字+年”

## 输出字段

| 字段名 | 说明 | 来源 |
|--------|------|------|
| 公示编号 | publicityId | API |
| 公示标题 | sourceCode（宗地编码） | API |
| 行政区 | districtName | API |
| 地块编号（宗地编码） | sourceCode | API |
| 地块位置 | 地块位置描述 | HTML解析 |
| 土地用途 | 如二类工业用地 | HTML解析 |
| 土地面积(亩) | 亩数 | HTML解析 |
| 土地面积(平方米) | 平方米（计算值） | 亩×666.67 |
| 出让年限 | 如 50年 | HTML解析 |
| 成交结果 | 纯数字（万元） | HTML解析后清洗 |
| 受让单位 | 竞得单位 | HTML解析 |
| 发布时间 | 如 2026-04-17 | API |
| 详情页网址 | source-detail 完整 URL | 拼接 |
| 坐标类型* | `resourceCoordinate.locationType` | 详情接口 |
| 坐标中心经度* | `resourceCoordinate.center.lng` | 详情接口 |
| 坐标中心纬度* | `resourceCoordinate.center.lat` | 详情接口 |
| X坐标起点* | `resourceCoordinate.center.originLng` | 详情接口 |
| Y坐标起点* | `resourceCoordinate.center.originLat` | 详情接口 |
| 边界点组数* | `resourceCoordinate.pointGroups` 分组数 | 详情接口 |
| 边界点总数* | `resourceCoordinate.pointGroups.points` 总数 | 详情接口 |
| 坐标数据文件* | 坐标 JSON 文件 | 脚本生成 |
| 地图文件* | 地图 HTML 文件 | 脚本生成 |

*标注字段：使用 `--coords` 参数时生成；使用 `--map` 时同时生成地图 HTML/JS

## 坐标提取流程

### 步骤 1：启用坐标抓取
```bash
python scrape_zj_land.py 绍兴 2025 "/Volumes/A区/下载/绍兴数据.xlsx" --coords --map
```

### 步骤 2：脚本行为
1. 调用详情接口 `queryResourceDetail`，读取 `resourceCoordinate`
2. 在 Excel 中新增坐标列，并输出 `*_coords.json`
3. 运行 `--map` 时，额外生成 `*_map.html` 和 `*_points.js`
4. 如果详情接口未返回坐标，再回退到「宗地界址图」PDF 渲染流程

### 步骤 3：地图查看
生成的 `*_map.html` 可直接打开，地图上会按 `resourceCoordinate.center` 标注每宗地位置。

### 坐标说明
- 坐标系：2000国家大地坐标系 (CGCS2000)
- 地图点位：使用 `resourceCoordinate.center` 的经纬度
- 平面坐标：使用 `resourceCoordinate.center.originLng / originLat`

## 已知限制

1. **容积率**: source-detail 页面为 SPA，API/curl 无法直接获取，需 Playwright
2. **起始价**: 同上
3. **规划指标**: 同上（绿化率、建筑密度等）
4. **坐标缺失**: 少量记录可能没有 `resourceCoordinate`，会退回到 PDF 渲染辅助流程

## 地图底图稳定性

地图 HTML 仅使用官方高德 JS API；未配置时显示配置提示，不加载其他底图。高德 JS API Key 为可选的本机配置，不写入源码、历史清单或 GitHub。需要使用时，在本机创建 `~/.appraisal-toolbox/map-config.json`：

```json
{
  "amap": {
    "enabled": true,
    "webKey": "这里填写高德 Web 端（JS API）Key"
  }
}
```

请使用“Web 端（JS API）”Key。地图配置仅需该 API Key；不要把 Key 提交到 Git 仓库。

## 抓取脚本

完整抓取脚本位于：`${SKILL_DIR}/scrape_zj_land.py`

用法示例：
```bash
# 默认抓取绍兴（不过滤年份）
python3 scrape_zj_land.py

# 抓取绍兴 2025 年以来数据
python3 scrape_zj_land.py 绍兴 2025

# 指定输出路径
python3 scrape_zj_land.py 绍兴 2025 "/Volumes/A区/下载/绍兴数据.xlsx"

# 开启坐标导出并生成地图
python3 scrape_zj_land.py 绍兴 2025 "/Volumes/A区/下载/绍兴数据.xlsx" --coords --map

# 按 districtName 精确匹配
python3 scrape_zj_land.py 某区 2023 "/Volumes/A区/下载/某区数据.xlsx" --coords --map --district-exact
```

参数：
- 第1个：城市名（默认绍兴）
- 第2个：起始年份（默认 2025）
- 第3个：输出文件路径（可选）
- `--coords`：是否提取勘测图坐标
- `--map`：是否生成地图 HTML/JS（会同时导出坐标）
- `--district-exact`：是否按 `districtName` 精确匹配

## 依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| requests | HTTP 请求 | `pip install requests` |
| openpyxl | Excel 写入 | `pip install openpyxl` |
| PyMuPDF | PDF 渲染为图像 | `pip install pymupdf` |

脚本已处理无依赖情况：`PyMuPDF` 不可用时坐标功能自动跳过。
