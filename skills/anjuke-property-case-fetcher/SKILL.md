---
name: anjuke-property-case-fetcher
description: 安居客物业出售与租赁案例抓取。优先导入用户在安居客中选好的当前列表页网址，支持验证等待、原始 HTML/截图、CSV/JSON 和 A-W Excel 输出。
---

# 安居客物业出售与租赁案例抓取

## 使用边界

- 侧栏优先在当前浏览器标签页读取内容；命令行模式使用本 Skill 的 Playwright 脚本，不依赖 AI 逐条点击。
- 需要登录、验证码或滑块时使用可见浏览器，并由用户在浏览器中完成验证；验证页、安居客通用页和列表导航页不得写入案例。
- 只对详情页逐条串行抓取，详情页之间保留固定间隔，避免连续跳转触发风控；每条结果保留真实详情 URL、案例类型、抓取状态和当前页证据快照。
- 输出目录由用户选择，Native Helper 会在其下创建“安居客物业案例”专用目录。
- 不保存或输出 Cookie、Token、Authorization、密码或验证码。

## 运行入口

侧栏推荐流程：在当前浏览器标签页的安居客网页中手工选择区域和筛选条件，点击“导入当前网址”，再点击“开始抓取”。脚本只接收导入的网址，不要求用户再次录入详情页 URL；遇到验证时保持当前标签页打开并等待人工完成。

```bash
python3 scripts/fetch_anjuke_property_cases.py \
  --list-url '<URL>' --keyword '中田大厦' --case-type sale \
  --out '<本机输出目录>' --max-cases 10
```

也支持重复传入 `--detail-url`。可选参数包括 `--headed`、`--screenshot`、`--wait-verification`、`--verification-timeout`、`--user-data-dir` 和 `--url-pattern`。

## 输出契约

脚本生成 `cases.csv`、`cases.json`、`cases.xlsx`、`result.html`、`map.html`、`html/` 和可选的 `screenshots/`。`result.html` 是结果表格，`map.html` 按详情页坐标显示地图和案例清单；没有坐标的有效案例仍保留在表格中。Excel 工作表“安居客案例”按 A-W 映射市场交易案例统计表；H 列使用 `=ROUND(E/F/(1+G),0)`，L 列按文本写入，R 列使用 HYPERLINK 公式。网页没有提供的字段写入 `null`，不静默省略。

字段顺序为：录入方式、案例序号、位置、售价、建筑面积、税率、交易价格(元/㎡)、楼层、装修、户型、交易时间、朝向、建筑结构、租赁情况、物业类型、建成年份、案例来源、区域位置、商业繁华程度、交通便捷程度、环境状况、开间进深比；B 列保留为空以兼容 A-W 模板。
