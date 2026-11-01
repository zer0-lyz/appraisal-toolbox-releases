---
name: appraisal-detail-print-format
description: "中文备注：明细表打印格式设置；评估明细表打印格式智能调整。Use when Codex needs to format exported appraisal detail Excel workbooks (.xlsx/.xlsm) for clean printing: landscape A4, visible sheets only, hide empty display columns such as 外币账面金额/评估基准日汇率/成新率, preserve formulas/data, fit all visible columns to one page wide, adjust visible column widths, fix print areas, remove blank-print pages, keep agency/signature footers aligned, and prevent tables from overlapping footers."
---

# 评估明细表打印格式

中文触发词：明细表打印格式设置。

## Workflow

Use `scripts/adjust_appraisal_detail_print.py` for exported appraisal detail workbooks. Prefer the script over hand-editing because WPS/Excel print settings are fragile.

Default command:

```bash
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx"
```

The script:

- creates a timestamped backup beside the workbook;
- processes visible sheets only and leaves hidden sheets hidden;
- sets A4 landscape and fits all visible columns to one page wide while allowing multiple pages vertically;
- hides columns that are display-empty in detail rows, including `外币账面金额`;
- hides `评估基准日汇率` when all detail-row currencies are RMB;
- hides `成新率` / `成新率%` only when detail rows are empty or zero;
- hides visible no-data summary sheets when all amount columns are blank or zero, excluding `1-汇总表` and `2-分类汇总`;
- rebuilds print areas from meaningful table content while preserving standard agency signature rows;
- trims print areas to the real table right edge instead of inheriting blank styled columns;
- clears manual page breaks;
- adjusts visible column widths to one consistent page width;
- sets margins/footer spacing so page footers do not protrude or overlap the table;
- uses dynamic page-height judgment for WPS print preview safety;
- lightly compresses row heights only when a near-one-page sheet would otherwise split at the footer.

## Page Setup Rules

- 页面设置使用 A4 横向打印。
- 明细表使用 `fitToPage=1`、`autoPageBreaks=0`、`fitToWidth=1`、`fitToHeight=0`，确保 Windows Excel/WPS 将所有可见列打印在一页宽度内，页高允许自然分页；同时通过隐藏空列和调整可见列宽改善版面。
- 左右页边距保持一致，默认 `0.45` inch，并设置水平居中，使表格两侧视觉对齐。
- 顶部、底部、页眉、页脚边距分别默认 `0.30`、`0.60`、`0.12`、`0.30` inch。
- 计算页面高度时按 A4 横向、上下页边距、WPS 打印预览安全区动态判断，不再使用固定高度。
- 如果 workbook 已设置 `print_title_rows`，如 `$1:$6` 的标题、表号、单位和双表头重复行，判断分页时必须保留并考虑这些行，不要删除或覆盖。
- 默认按 `95%` 可用页高作为 WPS 预览安全系数，避免表格内容压住页脚或落款。
- 只有接近一页且可能压住页脚/落款的 sheet 才允许轻微压缩行高；长表不做全表压缩。

## Operating Rules

- Do not modify source data values, formulas, sheet visibility, or hidden source sheets.
- Treat rows with numeric `序号` in column A as detail rows for empty-column decisions.
- Keep `车辆` and `电子设备` `成新率%` columns when they contain actual values.
- When WPS preview looks stale, ask the user to exit print preview or reopen the workbook before diagnosing further.
- If the workbook is open in WPS and save behavior is odd, close/reopen WPS or work on a copy.

## Useful Options

```bash
# Preview changes without writing
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx" --dry-run

# Use a different visible table width
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx" --target-width 143

# Use a different WPS page-height safety factor
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx" --page-height-factor 0.95

# Skip backup only if the user explicitly asks
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx" --no-backup

# Keep empty summary sheets visible for review
python3 scripts/adjust_appraisal_detail_print.py "/path/to/明细表.xlsx" --keep-empty-summary
```

After running, verify with:

```bash
unzip -t "/path/to/明细表.xlsx" | tail -5
```
