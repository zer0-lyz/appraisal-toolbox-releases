"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createDepreciationCapexForecastService } = require("./depreciation-capex-forecast.js");

async function runPickerResponse(operation, response) {
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "appraisal-picker-protocol-"));
  try {
    const service = createDepreciationCapexForecastService({
      runtimeDirectory,
      workbookDirectory: path.join(runtimeDirectory, "workbooks"),
      skillRoot: path.resolve(__dirname, "../skills/depreciation-capex-forecast"),
      platformAdapter: {
        runtimeRoot: runtimeDirectory,
        chooseXlsxFile: async () => response,
        chooseDirectory: async () => response,
      },
    });
    return await service.handle({ operation });
  } finally {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const checks = [];
  const xlsxCancel = await runPickerResponse("select", { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED" });
  assert.equal(xlsxCancel.cancelled, true);
  assert.equal(xlsxCancel.action, "depreciation_capex_forecast_xlsx_selection_cancelled");
  checks.push("XLSX cancellation preserves the explicit cancellation action");

  const xlsxFailure = await runPickerResponse("select", { ok: false, cancelled: false, reason: "FILE_PICKER_TIMEOUT" });
  assert.equal(xlsxFailure.cancelled, false);
  assert.equal(xlsxFailure.reason, "FILE_PICKER_TIMEOUT");
  assert.equal(xlsxFailure.action, "depreciation_capex_forecast_xlsx_selection_failed");
  checks.push("XLSX process failure is not relabeled as cancellation");

  const outputCancel = await runPickerResponse("select_output_directory", { ok: false, cancelled: true, reason: "FILE_SELECTION_CANCELLED" });
  assert.equal(outputCancel.cancelled, true);
  assert.equal(outputCancel.action, "depreciation_capex_forecast_output_directory_selection_cancelled");
  checks.push("output-directory cancellation preserves the explicit cancellation action");

  const outputFailure = await runPickerResponse("select_output_directory", { ok: false, cancelled: false, reason: "FILE_PICKER_PROCESS_FAILED" });
  assert.equal(outputFailure.cancelled, false);
  assert.equal(outputFailure.reason, "FILE_PICKER_PROCESS_FAILED");
  assert.equal(outputFailure.action, "depreciation_capex_forecast_output_directory_selection_failed");
  checks.push("output-directory process failure is not relabeled as cancellation");

  const emptyOutput = await runPickerResponse("select_output_directory", { ok: true, cancelled: false, paths: [] });
  assert.equal(emptyOutput.ok, false);
  assert.equal(emptyOutput.cancelled, false);
  assert.equal(emptyOutput.reason, "FILE_PICKER_EMPTY_RESULT");
  assert.equal(emptyOutput.action, "depreciation_capex_forecast_output_directory_selection_failed");
  checks.push("successful-but-empty output selection is a protocol failure, not cancellation");

  const emptyXlsx = await runPickerResponse("select", { ok: true, cancelled: false, paths: [] });
  assert.equal(emptyXlsx.ok, false);
  assert.equal(emptyXlsx.cancelled, false);
  assert.equal(emptyXlsx.reason, "FILE_PICKER_EMPTY_RESULT");
  assert.equal(emptyXlsx.action, "depreciation_capex_forecast_xlsx_selection_failed");
  checks.push("successful-but-empty workbook selection remains an explicit failure");

  const summary = { schemaVersion: 1, suite: "depreciation-capex-picker-protocol", status: "passed", checks };
  if (process.argv[2]) {
    fs.mkdirSync(path.dirname(path.resolve(process.argv[2])), { recursive: true });
    fs.writeFileSync(path.resolve(process.argv[2]), `${JSON.stringify(summary, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
