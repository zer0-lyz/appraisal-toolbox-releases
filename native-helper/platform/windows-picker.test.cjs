"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createWindowsAdapter } = require("./windows.js");

function adapterFor({ callbackError = null, stdout = "", elapsedMs = 0, syncError = null, onLaunch } = {}) {
  let now = 1000;
  const adapter = createWindowsAdapter({
    env: { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\Fixture\\LocalAppData" },
    homeDir: "C:\\Fixture",
    monotonicNow: () => now,
    execFile: (command, args, options, callback) => {
      onLaunch?.({ command, args, options });
      if (syncError) throw syncError;
      setImmediate(() => {
        now += elapsedMs;
        callback(callbackError, stdout, "");
      });
    },
  });
  return adapter;
}

async function main() {
  const checks = [];
  let launch = null;
  const success = await adapterFor({
    stdout: [
      "Windows PowerShell startup noise",
      'APPRAISAL_PICKER_RESULT:{"ok":true,"cancelled":false,"paths":["C:\\\\中文 数据\\\\成果"]}',
      "",
    ].join("\r\n"),
    onLaunch: (value) => { launch = value; },
  }).chooseDirectory("选择目录");
  assert.equal(launch.command, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert(launch.args.includes("-STA"));
  assert.deepEqual(success.paths, ["C:\\中文 数据\\成果"]);
  checks.push("Windows adapter uses absolute system PowerShell and parses marker JSON path");

  const marker = (payload) => `APPRAISAL_PICKER_RESULT:${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
  const parseResponse = async (stdout) => adapterFor({ stdout }).chooseDirectory("选择目录");
  const cancel = await parseResponse(marker({ ok: false, cancelled: true, paths: [] }));
  assert.equal(cancel.ok, false);
  assert.equal(cancel.cancelled, true);
  assert.equal(cancel.reason, "FILE_SELECTION_CANCELLED");
  checks.push("structured cancel marker is the only successful cancellation response");

  const invalidCases = [
    { name: "empty stdout", stdout: "", reason: "FILE_PICKER_PROTOCOL_INVALID", code: "MISSING_RESULT_MARKER" },
    { name: "empty path array", stdout: marker({ ok: true, cancelled: false, paths: [] }), reason: "FILE_PICKER_EMPTY_RESULT", code: "EMPTY_OR_NONABSOLUTE_PATH" },
    { name: "malformed JSON", stdout: "APPRAISAL_PICKER_RESULT:{broken", reason: "FILE_PICKER_PROTOCOL_INVALID", code: "MALFORMED_JSON" },
    { name: "multiple markers", stdout: `${marker({ ok: false, cancelled: true, paths: [] })}\n${marker({ ok: true, cancelled: false, paths: ["C:\\\\valid"] })}`, reason: "FILE_PICKER_PROTOCOL_INVALID", code: "DUPLICATE_RESULT_MARKER" },
    { name: "nonabsolute path", stdout: marker({ ok: true, cancelled: false, paths: ["relative\\file.xlsx"] }), reason: "FILE_PICKER_EMPTY_RESULT", code: "EMPTY_OR_NONABSOLUTE_PATH" },
    { name: "control character path", stdout: marker({ ok: true, cancelled: false, paths: ["C:\\folder\\bad\npath"] }), reason: "FILE_PICKER_PROTOCOL_INVALID", code: "INVALID_RESPONSE_SHAPE" },
  ];
  for (const item of invalidCases) {
    const result = await parseResponse(item.stdout);
    assert.equal(result.ok, false, item.name);
    assert.equal(result.cancelled, false, item.name);
    assert.equal(result.reason, item.reason, item.name);
    assert(result.diagnostics.stderrTail.some((line) => line.includes(item.code)), item.name);
  }
  checks.push("empty/malformed/duplicate/nonabsolute/control-character responses fail closed");

  const exitTwo = await adapterFor({ callbackError: Object.assign(new Error("process exited 2 without a marker"), { code: 2, killed: false }) }).chooseDirectory("选择目录");
  assert.equal(exitTwo.reason, "FILE_PICKER_PROCESS_FAILED");
  assert.equal(exitTwo.cancelled, false, "nonzero exit code 2 cannot stand in for a trusted cancellation marker");
  checks.push("nonzero process exit 2 without a trusted marker is not cancellation");

  const earlyKill = await adapterFor({
    callbackError: Object.assign(new Error("terminated by host"), { killed: true, signal: "SIGTERM" }),
    elapsedMs: 25,
  }).chooseDirectory("选择目录");
  assert.equal(earlyKill.reason, "FILE_PICKER_PROCESS_FAILED", "early killed process must not be misreported as a picker timeout");
  assert.equal(earlyKill.diagnostics.stderrTail[0], "阶段: process_exit");
  checks.push("early killed/SIGTERM is reported as process failure");

  const bufferFailure = await adapterFor({
    callbackError: Object.assign(new Error("stdout maxBuffer exceeded"), { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    elapsedMs: 50,
  }).chooseDirectory("选择目录");
  assert.equal(bufferFailure.reason, "FILE_PICKER_PROCESS_FAILED", "maxBuffer termination must not be misreported as timeout");
  checks.push("maxBuffer-killed process remains a process failure");

  const elapsedTimeout = await adapterFor({
    callbackError: Object.assign(new Error("terminated at timer"), { killed: true, signal: "SIGTERM" }),
    elapsedMs: 120000,
  }).chooseDirectory("选择目录");
  assert.equal(elapsedTimeout.reason, "FILE_PICKER_TIMEOUT", "the monotonic elapsed timeout remains recognized without ETIMEDOUT");
  assert.equal(elapsedTimeout.diagnostics.stderrTail[0], "阶段: process_timeout");
  checks.push("elapsed monotonic timeout is reported as picker timeout");

  const explicitTimeout = await adapterFor({
    callbackError: Object.assign(new Error("spawn timeout"), { code: "ETIMEDOUT" }),
    elapsedMs: 5,
  }).chooseDirectory("选择目录");
  assert.equal(explicitTimeout.reason, "FILE_PICKER_TIMEOUT", "explicit ETIMEDOUT is recognized even before elapsed threshold");
  checks.push("explicit ETIMEDOUT is reported as picker timeout");

  const startFailure = await adapterFor({ syncError: Object.assign(new Error("launch failed"), { code: "ENOENT" }) }).chooseDirectory("选择目录");
  assert.equal(startFailure.reason, "FILE_PICKER_PROCESS_START_FAILED");
  assert.equal(startFailure.diagnostics.stderrTail[0], "阶段: process_start");
  checks.push("synchronous process start failure remains a start failure");

  const parserMethods = [
    ["chooseDirectory", "选择目录"],
    ["chooseWorkbookFiles"],
    ["chooseWordFiles"],
    ["chooseXlsxFile"],
  ];
  const powershellPath = `${process.env.SystemRoot || process.env.WINDIR || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const parserCommand = [
    "$ErrorActionPreference = 'Stop'",
    "$source = [Environment]::GetEnvironmentVariable('APPRAISAL_PICKER_SCRIPT')",
    "$tokens = $null; $parseErrors = $null",
    "[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)",
    "if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
    "[Console]::Out.WriteLine('PARSE_OK')",
  ].join("\n");
  const parserEncoded = Buffer.from(parserCommand, "utf16le").toString("base64");
  for (const [method, ...args] of parserMethods) {
    let capturedArgs;
    const adapter = createWindowsAdapter({
      env: { SystemRoot: process.env.SystemRoot || process.env.WINDIR || "C:\\Windows" },
      execFile: (_command, commandArgs, _options, callback) => {
        capturedArgs = commandArgs;
        setImmediate(() => callback(null, marker({ ok: false, cancelled: true, paths: [] }), ""));
      },
    });
    await adapter[method](...args);
    assert(capturedArgs?.includes("-EncodedCommand"), `${method} must capture the real encoded PowerShell source`);
    const encoded = capturedArgs[capturedArgs.indexOf("-EncodedCommand") + 1];
    const source = Buffer.from(encoded, "base64").toString("utf16le");
    const output = execFileSync(powershellPath, ["-NoProfile", "-NonInteractive", "-EncodedCommand", parserEncoded], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, APPRAISAL_PICKER_SCRIPT: source },
    });
    assert.equal(output.trim(), "PARSE_OK", `${method} PowerShell syntax parses`);
  }
  checks.push("actual EncodedCommand sources for directory/Excel/Word/XLSX parse without showing dialogs");

  const summary = { schemaVersion: 1, suite: "windows-picker-adapter-regression", status: "passed", checks };
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
