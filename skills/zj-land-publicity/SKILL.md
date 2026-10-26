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
  - `landUse`: 可选单一用途分类码，1住宅、2商服、3工矿仓储、4其他
- **Referer**: `https://www.zjzrzyjy.com/landView/land-bidding`

运行器从官网行政区树解析地市/区县代码；接口返回的 `ggPubTime` 是成交公示发布时间，日期筛选最终以该字段复核。

土地用途单选时通过官网 `landUse` 分类码（1住宅、2商服、3工矿仓储、4其他）筛选；多选时保留列表候选并按 `planUse` 的官方分类编码复核。位置关键词、部分交易方式等接口未支持的条件由运行器在本地复核；缺失字段的候选记录保留并交由详情阶段判断。

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
| `planUse` | JSON 土地用途及官方分类编码，归一化为 `landUse` |
| `rjl` / 详情 `plotRatio` | 容积率原始值，按官网 X/S 标记及比较符保留 |
| `resourceLocation` | 地块位置 |
| `landAreaForAre` / `landArea` | 土地面积（亩）/平方米；优先使用平方米面积 |
| 成交公示 HTML 面积标签 | `土地面积（平方米）`、`土地面积（亩）` 与值中的显式单位分别归入平方米/亩字段；未知单位只留作原值，不用于换算 |
| `startPrice` / `startPriceUnit` | 起始金额及其明示单位，来自同一列表记录 |
| `cjj` / `cjfs` | 成交金额及其明示单位，来自同一列表记录 |
| `quotationPrice.quotationUnit` / `stagePrice[].quotationUnit` | 各报价项的明示单位，不与其他金额字段拼接 |
| 详情 `dealPriceList[].price` / `unit` | 详情成交金额及其单位，来自同一详情响应 |
| 详情 `dealDetail` | 含有明确金额和单位的成交说明文本 |
| `transactionMode` | `GP`/`PM`，结合 `transactionType` 归一化为交易方式 |
| `resourceStage` | `CJ` 归一化为“结果公示” |

公开接口实取样本中，以上单位字段出现的文本值包括 `万元`、`元/平方米`。程序不为单位数字码建立映射，也不从金额大小、用途或地区推断单位。

工作台按归一化后的 `_queryDate`（来源为 `enrollStartTime`/`listingStartTime`）对官网查询日期执行起止日期闭区间筛选，起始日和结束日均包含；Excel 的“发布时间”列使用 `releaseTime`（来源为 `ggPubTime`）。

### 字段清洗规则

1. **成交结果**：必须将金额与同一来源记录的明示单位配对。`万元` 表示总价，`元/平方米` 表示单价；详情接口单独使用 `dealPriceList[].price/unit` 或含明确单位的 `dealDetail`。列表价与详情价分别标准化后核对，不从一个来源取金额、另一个不一致报价取单位。
2. **起始价**：按同一规则处理 `startPrice/startPriceUnit` 或详情中的明示金额/单位。起始价区间仍按元/平方米筛选；无法核验或无法换算出的起始单价会从区间筛选排除并给出提示。
3. **金额换算**：`万元总价×10000÷平方米面积=元/平方米`；`元/平方米×平方米面积÷10000=万元总价`。面积优先用官网平方米字段，其次使用 HTML 中明确标注平方米的面积。若只有明确标注为亩的面积，使用 `1亩=2000/3平方米` 并写入面积来源；未标单位或其他单位的面积不猜测，不用于价格换算。没有可用面积时只保留由原单位直接确定的一侧。
4. **未知与冲突**：单位缺失、单位不支持、明示单位冲突或来源换算不一致时，不生成标准化价格；原始金额、单位、来源和警告保留。零金额不会因真假值判断被吞掉；含未知复合单位的文本不截断识别。
5. **精度与追溯**：计算使用十进制，导出展示按 `ROUND_HALF_UP` 保留2位；历史清单保存原金额、原单位、字段来源、面积来源、换算依据和核验状态。旧历史缺少单位元数据时保留旧显示值并标记“旧历史未核验”，不静默重算。
6. **出让年限**：优先读取详情 `transferPeriodTo`，否则从 `assignmentPeriod` 提取“数字+年”。

## 输出字段

| 字段名 | 说明 | 来源 |
|--------|------|------|
| 公示编号 | publicityId | API |
| 公示标题 | sourceCode（宗地编码） | API |
| 行政区 | districtName | API |
| 地块编号（宗地编码） | sourceCode | API |
| 地块位置 | 地块位置描述 | HTML解析 |
| 土地用途 | 如二类工业用地 | 官网 `planUse` / 详情 |
| 容积率 | 官网 X/S 原始值，如 `X≤1.01；S≤1.6` | 列表 `rjl`，缺失时详情 `plotRatio` |
| 土地面积(亩) | 明确标注为亩的面积 | HTML 标签/值明确标亩，或列表/详情亩字段 |
| 土地面积(平方米) | 官网或 HTML 明确标注平方米的面积；无平方米字段时仅由明确亩数按 2000/3 换算 | 列表/详情/HTML平方米字段或亩数换算 |
| 出让年限 | 如 50年 | HTML解析 |
| 起始单价/总价、成交单价/总价 | 仅在金额及单位明确时输出；单位和来源另列 | 列表/详情同源价格单位对 |
| 起始价/成交价原始金额、原始单位 | 保留来源输入；未知或冲突时仍显示 | 官方列表/详情 |
| 起始价/成交价来源、核验状态、换算依据、警告 | 可回查金额字段、单位字段及计算过程 | 官方列表/详情及规范化记录 |
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

1. **容积率**: 列表 `rjl` 与详情 `plotRatio` 可读取；结果保留官网 X/S 字段标记和比较符，不擅自解释为上下限
2. **起始价**: 少数记录仍需详情页渲染或附件核验
3. **规划指标**: 绿化率、建筑密度等字段需逐项核实接口是否提供
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
