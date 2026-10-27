# 国家统计局数据接口参考

## 一、端点变迁史（照抄老教程必失败）

| 时期 | 接口 | 状态 |
|---|---|---|
| ~2026-05 | `easyquery.htm?m=QueryData&dbcode=hgyd…` | **已废弃**，返回 403（WAF `reason:UrlACL`） |
| 2026-05-27 | `…/external/getEsDataByCidAndDt` | 已 404 |
| **2026-09 实测** | **`…/external/stream/esData`** | **当前有效** |

NBS 会不打招呼地改端点名（目录 UUID 反而一直稳定）。
`mbk-dev/nbsc` 项目也记录了同样的变迁，并在 1.0.1+ 版本做了"多候选路径 + 404 轮询"。

**当前基础地址**：
`https://data.stats.gov.cn/dg/website/publicrelease/web/external`

**注意**：旧接口不只是 404，而是 **403 + WAF 拦截**，
response body 形如：
```
<h1>403 Forbidden</h1>
<hr><center>Client IP: 2409:...</center>
<center>eventID: ... reason:UrlACL</center>
```
`reason:UrlACL` 表示 URL 访问控制，不是 IP 被封，也不是缺 header。
换 UA / 换 Referer / 换 http 协议都无效，**只能改用新路径**。

## 二、三步走

### 1. 目录树

```
GET /new/queryIndexTreeAsync?pid={父节点id}&code=1
```

- `pid` 首次传空字符串 `""`
- `code`：`1` 月度 / `2` 季度 / `3` 年度 / `5` 分省季度 / `6` 分省年度
- 返回节点：`_id`（父节点则作为下次 pid，叶子则作为 cid）
  `isLeaf`、`sdate`/`edate`（覆盖时间范围）、`name`

月度数据根节点：`fc982599aa684be7969d7b90b1bd0e84`（名称「月度数据」）

实测 L1 分类（14 个）：价格指数、工业、能源、固定资产投资(不含农户)、服务业生产指数、
城镇调查失业率、房地产、国内贸易、对外经济、交通运输、邮电通信、采购经理指数、财政、金融。

「价格指数」节点 `_id` = `3c9c459384c74f578f3541b2198aac70`

### 2. 指标列表

```
GET /new/queryIndicatorsByCid?cid={cid}&dt=&name=
```

返回 `data.list[]`，每条含：
- `_id` → indicatorId（后续取数用）
- `i_showname` → 指标名（含单位）
- `i_mark` → 统计口径说明
- `du` → 单位 ID

### 3. 取数

```
POST /stream/esData
Content-Type: application/json
```

```json
{
  "cid": "8bc27b5fd28e46df9b8fda8a5d336306",
  "indicatorIds": ["2603766182c8498eaff9c49457710b7a"],
  "das": [{"text": "全国", "value": "000000000000"}],
  "dts": ["202601MM-202612MM"],
  "showType": "1",
  "rootId": "fc982599aa684be7969d7b90b1bd0e84"
}
```

响应：

```json
{"data":[
  {"code":"202608MM","name":"2026年8月",
   "values":[{"_id":"...","i_showname":"...","value":"99.5","du_name":"%"}]}
]}
```

- 未发布的月份 `values` 可能是空数组
- 返回顺序不保证，按 `code` 自行排序
- 同时回多个指标时，`values[]` 里按 `_id` 对应

## 三、时间编码

| 频率 | 编码 | 后缀 | 示例 |
|---|---|---|---|
| 月度 | `YYYYMM` | `MM` | `202608MM` = 2026年8月 |
| 季度 | `YYYYQ` | `SS` | `202504SS` = 2025年第4季度（Q4 编为 04） |
| 年度 | `YYYY` | `YY` | `2025YY` |

范围：`Start-End`，如 `201801MM-202512MM`

## 四、时间分片（最重要的机制）

同一业务指标按 5 年左右切成多个 cid，**必须分别请求后本地拼接**：

```
价格指数/
├── 分行业工业生产者出厂价格指数 (上年同月=100)/
│   ├── (2007-2013)   cid=8c707b6da5df4703abd7278835e8e668   40 个指标
│   ├── (2014-2017)   cid=8c1e3ad3a3a449559f9447918450e193   42 个指标
│   ├── (2018-2025)   cid=a9a6bab463334e6c8dc2c66cf114a25e   42 个指标
│   └── (2026-)       cid=8bc27b5fd28e46df9b8fda8a5d336306   42 个指标
└── 分行业中类工业生产者出厂价格指数 (上年同月=100)/
    ├── (2014-2017)   isLeaf=false（目录，需再下钻）
    └── (2018-至今)    cid=6cbec0ff932a4899964ba88da7711351  40 个中类节点
```

三个要点：

1. **indicatorId 跨分片不稳定** —— 每个 cid 都要重新调 `queryIndicatorsByCid`
2. **取数范围要按各分片自身边界传** —— 统一传全范围会漏数。
   实测 2007-2013 分片传 `200701MM-202612MM` 只回 48 条，按其边界
   `200701MM-201312MM` 可得 84 条（7 年 × 12 月）
3. **中类节点可能是目录** —— 「分行业中类…(2018-至今)」`isLeaf=false`，
   其下 40 个子节点才是各中类，每个中类下再是具体指标

## 五、中类结构示例（汽车与塑料制品）

```
分行业中类 (2018-至今) [6cbec0ff…]
├── …共 40 个中类…
├── 家具制造业 [cbf06ed7…]
│   └── 塑料家具制造        ← 别和「塑料制品业」搞混
├── 橡胶和塑料制品业 [82865fa8…]
│   ├── 橡胶制品业   [557d0a6a…]
│   └── 塑料制品业   [fb277192…]   ← 底稿 F 列要的是这个
└── 汽车制造业
    ├── 汽车整车制造
    └── 汽车车身、挂车制造
```

**判定技巧**：拿到候选指标后与底稿已有值比对，一致率 100% 才对。

## 六、反爬与限流

> ⚠️ **先纠正一个曾导致误判的坑（2026-09-16 实测）**：
> NBS **正常返回的 `Content-Type` 也是 `text/html;charset=UTF-8`**，
> body 却是合法的 `{"data":…}`。所以**不能拿 Content-Type 判断成败**——
> 按这个判据会把正常响应误判成"被限流"。

**唯一可靠判据：body 能否 `json.loads`。**

| body 实测内容 | 判定 |
|---|---|
| `{"data":[{"explain":null,"sdate":null,"_name":"月度数据",…` | ✅ 正常（哪怕 Content-Type 是 text/html） |
| `<html>… Please enable JavaScript and refresh the page …` | ❌ 真限流（JS 人机验证） |

参考实现：

```python
def parse_json(r):
    try:
        return json.loads(r.text), 'ok'
    except Exception:
        body = (r.text or '')[:160]
        if 'enable JavaScript' in body or '<html' in body.lower():
            return None, 'BLOCKED(JS挑战)'
        return None, 'not-json'
```

应对：

- 请求间隔 ≥1.2 秒（脚本内 `REQ_GAP`）
- **不要用 HTTP 状态码判成功**——限流时状态码仍是 200
- **不要用 Content-Type 判成功**——正常时也是 text/html
- 触发后需等待较长时间才能恢复（实测等 2 分钟仍被拦，建议等 10 分钟以上）
- 遍历树时对目录节点也要节流，节点数可达数百

## 七、排错清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 403 + `reason:UrlACL` | 用了废弃的 `easyquery.htm` | 改用 `publicrelease/web/external` |
| 404 + Spring Boot JSON | 端点改名 | 试 `/stream/esData` |
| `Content-Type: text/html` | **正常现象，不是错误** | 看 body 能否 json.loads |
| body 含 `Please enable JavaScript` | 触发 JS 人机验证 | 降低频率，等待后再试 |
| 取数返回空数组 | 该月未发布，或 dts 超界 | 检查分片边界 |
| 数据比预期少 | 只取了单个分片 | 遍历全部时间分片后拼接 |
| 指标值整体偏移 | 取错同类指标（大类 vs 中类） | 与底稿比对，一致率须 100% |

## 七之二、写入底稿的注意事项

| 事项 | 说明 |
|---|---|
| **用 COM 而非 openpyxl** | openpyxl 保存会清空全表公式缓存值；COM（WPS）零损伤 |
| 格式要求 | 宋体 10 号、数值型、两位小数（L 列 `###,###,###,###,##0.00`、M 列 `#,##0.00_ `） |
| 新增月份行 | R372 之后无预留行，须 `Rows.Copy` + `PasteSpecial(-4122)` 复制格式，补 A/B/C 列 |
| A 列日期 | 存**月末日期**（`2026-08-31`），不是月初 |
| 写入后必做 | 结构指纹对比备份：sheets/names/media/comments/vml/tables/DV/CF 应完全一致 |

## 八、其他可用参考

- `mbk-dev/nbsc`（Python）— 记录了端点变迁史，1.1.0+ 支持多候选端点自动探测
- 关键词搜索接口（无需知道 cid，最快定位）：
  `GET /query?search=工业生产者出厂价格指数&pagenum=1&pageSize=30`
  返回含 `indic_id`、`i`、`dt_type`（MM/SS/YY）、`type_text` 等
