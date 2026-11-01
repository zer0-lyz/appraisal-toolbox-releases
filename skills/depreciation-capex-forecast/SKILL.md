---
name: depreciation-capex-forecast
description: Prepare, run, and summarize the self-contained 折旧摊销与资本性支出预测 workbook workflow bundled with its template and engine. Use when the user asks to计算折与资, 折旧摊销预测, 资本性支出预测, wants the workbook template, says the template has been filled and wants the model to run it, or wants a conclusion summary from the resulting workbook.
---

# Depreciation Capex Forecast

This skill is self-contained. The workbook workflow, template, and calculation engine are all bundled inside the skill package.

## Workflow

1. When the user wants the template or wants to start a new calculation, run the template command.
   The skill bundles a static canonical template at `assets/折旧摊销预测输入模板.xlsx`, and the working copy defaults to `~/Downloads/折旧摊销预测输入模板.xlsx`.

```bash
python3 scripts/workflow.py prepare
```

Use `--reset` when you want to overwrite the working copy with the bundled asset.
Return the workbook path from the JSON output and tell the user to fill that file, then close it before asking you to run the calculation.

2. When the user says the workbook is ready, run:

```bash
python3 scripts/workflow.py run
```

When the user has already filled a project workbook, run it in place instead of
creating a Downloads copy:

```bash
python3 scripts/workflow.py run --input "/absolute/path/to/已填写工作簿.xlsx"
```

Use the JSON output to report:

- whether the run succeeded
- whether `检查结果` shows `输入校验 = OK`
- the key rows from `预测汇总`
- the path of the workbook that was updated in place

Default behavior: only `预测汇总` and `检查结果` are written back, so routine runs stay fast and lightweight.

Use `python3 scripts/workflow.py run --with-details` when you want validation output:

- `资产结果明细（年度）`
- `资产结果明细（月度）`
- `资产结果明细（月度）` spans 200 years of monthly columns, keeps the detailed forecast period undiscounted, and discounts the perpetual period to `结束日期`
- `资产结果明细（年度）` and `资产结果明细（月度）` both zero out the pre-`结束日期` discounted view; discounting only begins after the forecast end date

Use `--detail-asset-id` when you want a single asset's `详细过程` sheet.

3. When the user wants a fresh blank working file, rerun `prepare --reset`.

## Rules

- Keep input and output in the same workbook unless the user explicitly asks for a separate result file.
- Input fields are located by row-3 header name. Extra project metadata columns are allowed in any position; required headers must remain unique.
- For numeric input cells, the engine accepts literal values plus the template formulas `=J行号` / `=K行号` and the `MIN` or `MAX` variant of the expected-remaining-years formula. This avoids relying on Excel/WPS formula caches. Unsupported formulas fail input validation with the formula location.
- `预测汇总` and `费用科目汇总` take perpetual-period values directly from the model's annualized perpetual output; they are not re-annualized during workbook export.
- Default working workbook: `~/Downloads/折旧摊销预测输入模板.xlsx`
- Default behavior: prepare the workbook, wait for the user to fill it, then run and summarize the result.
- If the run fails with a file lock or permission-style error, tell the user to close the workbook and retry.
- If `检查结果` contains errors, lead with those issues before quoting totals.
- Do not create version-stacked duplicates unless the user explicitly asks.
- No external project root or environment variable is required; the bundled engine lives under `scripts/depreciation_forecast`.

## Resources

- Use `references/workflow.md` for the fixed-path behavior if you need a reminder.
- Run the automation with `scripts/workflow.py`.
