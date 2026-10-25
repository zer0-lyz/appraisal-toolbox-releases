"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureManagedOutputDirectory } = require("./managed-output-directory.js");

function injectedFs(method, fail) {
  const result = Object.create(fs);
  const original = fs[method].bind(fs);
  result[method] = (...args) => {
    const injected = fail(args);
    if (injected) throw Object.assign(new Error("fixture failed at C:\\Users\\Sensitive\\private-token=must-not-leak"), { code: injected });
    return original(...args);
  };
  return result;
}

function expectFailure(parent, folderName, overrides, expected) {
  assert.throws(() => ensureManagedOutputDirectory(parent, folderName, overrides), (error) => {
    assert.equal(error.name, "ManagedOutputDirectoryError");
    assert.equal(error.stage, expected.stage);
    assert.equal(error.code, expected.code);
    assert.equal(error.reason, expected.reason);
    assert.equal(error.diagnostics.stderrTail[0], `阶段: ${expected.stage}`);
    assert.equal(error.diagnostics.stderrTail[1], `错误码: ${expected.code}`);
    assert(!JSON.stringify(error.diagnostics).includes("Sensitive"));
    assert(!JSON.stringify(error.diagnostics).includes("private-token"));
    return true;
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "appraisal-managed-output-"));
  const checks = [];
  const folderName = "浙江 土地成果";
  try {
    const parent = fs.mkdtempSync(path.join(root, "中文 空格 父目录-"));
    const result = ensureManagedOutputDirectory(parent, folderName);
    const expected = path.join(parent, folderName);
    assert.equal(result.path, fs.realpathSync(expected));
    assert.equal(result.createdDirectory, true);
    assert(fs.statSync(result.path).isDirectory());
    checks.push("真实临时文件系统：中文/空格上级目录下创建专用成果文件夹");

    const sentinel = path.join(expected, "原成果.txt");
    const sentinelBytes = Buffer.from("previous output remains byte-identical", "utf8");
    fs.writeFileSync(sentinel, sentinelBytes);
    const reused = ensureManagedOutputDirectory(parent, folderName);
    assert.equal(reused.path, expected);
    assert.equal(reused.createdDirectory, false);
    assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
    const selectedChild = ensureManagedOutputDirectory(expected, folderName);
    assert.equal(selectedChild.path, expected, "choosing the managed directory itself must not create a nested child");
    assert.equal(selectedChild.createdDirectory, false);
    assert.equal(fs.existsSync(path.join(expected, folderName)), false);
    assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
    checks.push("已有成果目录复用、直接选择专用子目录不套娃且原成果不变");

    const fileConflictParent = fs.mkdtempSync(path.join(root, "same-name-conflict-"));
    const conflictPath = path.join(fileConflictParent, folderName);
    const conflictBytes = Buffer.from("same-name file must not be removed", "utf8");
    fs.writeFileSync(conflictPath, conflictBytes);
    expectFailure(fileConflictParent, folderName, {}, {
      stage: "check_destination", code: "EEXIST", reason: "MANAGED_OUTPUT_NAME_CONFLICT",
    });
    assert.deepEqual(fs.readFileSync(conflictPath), conflictBytes);
    checks.push("成果子目录同名文件冲突被拒绝且原文件保留");

    const probeParent = fs.mkdtempSync(path.join(root, "probe-name-collision-"));
    const probeDirectory = path.join(probeParent, folderName);
    fs.mkdirSync(probeDirectory);
    const random = Buffer.from("1234567890abcdef", "hex");
    const existingProbe = path.join(probeDirectory, `.appraisal-write-check-${process.pid}-${random.toString("hex")}.tmp`);
    const probeBytes = Buffer.from("preexisting collision target", "utf8");
    fs.writeFileSync(existingProbe, probeBytes);
    expectFailure(probeParent, folderName, { randomBytes: () => random }, {
      stage: "write_probe", code: "EEXIST", reason: "MANAGED_OUTPUT_CREATE_FAILED",
    });
    assert.deepEqual(fs.readFileSync(existingProbe), probeBytes, "an exclusive-open collision must never delete another file");
    checks.push("独占探针重名冲突不会删除既有探针文件");

    const cases = [
      {
        name: "create access denied",
        method: "mkdirSync",
        fail: (args) => path.basename(String(args[0])) === folderName ? "EACCES" : "",
        expected: { stage: "create_directory", code: "EACCES", reason: "MANAGED_OUTPUT_PERMISSION_DENIED" },
      },
      {
        name: "create operation not permitted",
        method: "mkdirSync",
        fail: (args) => path.basename(String(args[0])) === folderName ? "EPERM" : "",
        expected: { stage: "create_directory", code: "EPERM", reason: "MANAGED_OUTPUT_PERMISSION_DENIED" },
      },
      {
        name: "read-only output directory",
        method: "openSync",
        fail: (args) => String(args[1]) === "wx" ? "EROFS" : "",
        expected: { stage: "write_probe", code: "EROFS", reason: "MANAGED_OUTPUT_READ_ONLY" },
      },
      {
        name: "probe creation permission denied",
        method: "openSync",
        fail: (args) => String(args[1]) === "wx" ? "EACCES" : "",
        expected: { stage: "write_probe", code: "EACCES", reason: "MANAGED_OUTPUT_PERMISSION_DENIED" },
      },
      {
        name: "disk full during probe write",
        method: "writeSync",
        fail: () => "ENOSPC",
        expected: { stage: "write_probe", code: "ENOSPC", reason: "MANAGED_OUTPUT_DISK_FULL" },
      },
      {
        name: "parent disappears before resolution",
        method: "realpathSync",
        fail: () => "ENOENT",
        expected: { stage: "validate_parent", code: "ENOENT", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE" },
      },
      {
        name: "destination readback I/O failure",
        method: "statSync",
        fail: (args) => path.basename(String(args[0])) === folderName ? "EIO" : "",
        expected: { stage: "check_destination", code: "EIO", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE" },
      },
      {
        name: "destination resolution I/O failure",
        method: "realpathSync",
        fail: (args) => path.basename(String(args[0])) === folderName ? "EIO" : "",
        expected: { stage: "resolve_destination", code: "EIO", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE" },
      },
    ];
    for (const item of cases) {
      const caseParent = fs.mkdtempSync(path.join(root, `fault-${item.method}-`));
      expectFailure(caseParent, folderName, { fs: injectedFs(item.method, item.fail) }, item.expected);
      checks.push(`${item.name}: stage/code/中文错误分类/脱敏诊断`);
    }

    const shortWriteParent = fs.mkdtempSync(path.join(root, "fault-short-probe-write-"));
    const shortWriteFs = Object.create(fs);
    shortWriteFs.writeSync = () => 0;
    expectFailure(shortWriteParent, folderName, { fs: shortWriteFs }, {
      stage: "write_probe", code: "EIO", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE",
    });
    assert.equal(fs.readdirSync(path.join(shortWriteParent, folderName)).length, 0);
    checks.push("探针短写不报成功并清理本次探针");

    const verifyParent = fs.mkdtempSync(path.join(root, "fault-verify-stat-"));
    let stats = 0;
    const verifyFs = injectedFs("statSync", (args) => {
      if (path.basename(String(args[0])) !== folderName) return "";
      stats += 1;
      return stats === 2 ? "EIO" : "";
    });
    expectFailure(verifyParent, folderName, { fs: verifyFs }, {
      stage: "verify_destination", code: "EIO", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE",
    });
    checks.push("最终目录验证 I/O 错误留存 verify_destination 阶段");

    const deleteParent = fs.mkdtempSync(path.join(root, "fault-probe-delete-"));
    let deleteCalls = 0;
    const deleteFs = injectedFs("unlinkSync", (args) => {
      if (String(args[0]).includes(".appraisal-write-check-")) {
        deleteCalls += 1;
        return deleteCalls === 1 ? "EIO" : "";
      }
      return "";
    });
    expectFailure(deleteParent, folderName, { fs: deleteFs }, {
      stage: "delete_probe", code: "EIO", reason: "MANAGED_OUTPUT_PATH_UNAVAILABLE",
    });
    assert.equal(fs.readdirSync(path.join(deleteParent, folderName)).length, 0, "the helper should clean the probe after the injected first unlink failure");
    checks.push("探针删除阶段 I/O 错误可诊断并清理本次探针");

    const summary = { schemaVersion: 1, suite: "managed-output-directory-regression", status: "passed", checks };
    if (process.argv[2]) {
      fs.mkdirSync(path.dirname(path.resolve(process.argv[2])), { recursive: true });
      fs.writeFileSync(path.resolve(process.argv[2]), `${JSON.stringify(summary, null, 2)}\n`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
