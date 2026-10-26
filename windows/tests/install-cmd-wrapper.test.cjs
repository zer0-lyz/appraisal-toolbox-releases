const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sourceRoot = path.resolve(__dirname, "..", "..");
const wrapperSource = fs.readFileSync(path.join(sourceRoot, "windows", "installer", "install.cmd"), "utf8");
assert.match(wrapperSource, /\[SUCCESS\].*Installation completed/i);
assert.match(wrapperSource, /\[FAILED\].*exit code %EXIT_CODE%/i);
assert.match(wrapperSource, /APPRAISAL_INSTALL_NONINTERACTIVE/);
assert.match(wrapperSource, /^\s*pause\s*$/im);
if (process.platform !== "win32") {
  console.log("Windows installer wrapper source contract passed; cmd.exe runtime checks skipped on this platform.");
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "atb-install-cmd-wrapper-"));
try {
  fs.copyFileSync(path.join(sourceRoot, "windows", "installer", "install.cmd"), path.join(temp, "install.cmd"));
  fs.writeFileSync(path.join(temp, "install.ps1"), "$code=[int]$env:FAKE_INSTALL_EXIT; Write-Output 'fixture installer'; exit $code", "utf8");
  function run(code, noninteractive) {
    const env = { ...process.env, FAKE_INSTALL_EXIT: String(code) };
    if (noninteractive) env.APPRAISAL_INSTALL_NONINTERACTIVE = "1";
    else delete env.APPRAISAL_INSTALL_NONINTERACTIVE;
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "install.cmd"], {
      cwd: temp, encoding: "utf8", input: noninteractive ? undefined : "x", timeout: 10000, windowsHide: true, env
    });
    if (result.error) throw result.error;
    assert.equal(result.status, code, "wrapper must preserve installer exit status");
    return result.stdout + result.stderr;
  }
  const successManual = run(0, false);
  assert.match(successManual, /\[SUCCESS\].*Installation completed/i);
  assert.match(successManual, /Press any key to close this window/i);
  const failureManual = run(17, false);
  assert.match(failureManual, /\[FAILED\].*exit code 17/i);
  assert.match(failureManual, /Press any key to close this window/i);
  const successAutomatic = run(0, true);
  assert.match(successAutomatic, /\[SUCCESS\]/i);
  assert.doesNotMatch(successAutomatic, /Press any key to close this window/i);
  const failureAutomatic = run(17, true);
  assert.match(failureAutomatic, /\[FAILED\].*exit code 17/i);
  assert.doesNotMatch(failureAutomatic, /Press any key to close this window/i);
  console.log("Windows installer wrapper feedback checks passed (manual hold-open and updater noninteractive paths).");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
