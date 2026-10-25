"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const SAFE_CODES = new Set([
  "EACCES", "EPERM", "EROFS", "ENOSPC", "ENOENT", "ENOTDIR", "EIO", "EEXIST", "EINVAL",
]);

function normalizeFsCode(error) {
  const value = String(error?.code || "");
  return SAFE_CODES.has(value) ? value : "UNKNOWN";
}

function reasonFor(code, stage) {
  if (code === "EACCES" || code === "EPERM") return "MANAGED_OUTPUT_PERMISSION_DENIED";
  if (code === "EROFS") return "MANAGED_OUTPUT_READ_ONLY";
  if (code === "ENOSPC") return "MANAGED_OUTPUT_DISK_FULL";
  if (code === "EEXIST") return stage === "write_probe" ? "MANAGED_OUTPUT_CREATE_FAILED" : "MANAGED_OUTPUT_NAME_CONFLICT";
  if (["ENOENT", "ENOTDIR", "EIO"].includes(code)) return "MANAGED_OUTPUT_PATH_UNAVAILABLE";
  if (code === "EINVAL" && stage === "validate_parent") return "MANAGED_OUTPUT_PATH_UNAVAILABLE";
  return "MANAGED_OUTPUT_CREATE_FAILED";
}

function publicError(error, stage) {
  const code = normalizeFsCode(error);
  const reason = reasonFor(code, stage);
  const wrapped = new Error(reason);
  wrapped.name = "ManagedOutputDirectoryError";
  wrapped.code = code;
  wrapped.reason = reason;
  wrapped.stage = stage;
  wrapped.diagnostics = {
    exitCode: null,
    stderrTail: [
      `阶段: ${String(stage).slice(0, 48)}`,
      `错误码: ${code}`,
      `结果: ${reason}`,
    ],
  };
  return wrapped;
}

function invalidError(reason, stage, code = "EINVAL") {
  const error = new Error(reason);
  error.name = "ManagedOutputDirectoryError";
  error.code = code;
  error.reason = reason;
  error.stage = stage;
  error.diagnostics = {
    exitCode: null,
    stderrTail: [`阶段: ${stage}`, `错误码: ${code}`, `结果: ${reason}`],
  };
  return error;
}

function ensureManagedOutputDirectory(parentValue, directoryName, dependencies = {}) {
  const fsApi = dependencies.fs || fs;
  const pathApi = dependencies.path || path;
  const random = dependencies.randomBytes || randomBytes;
  let stage = "validate_parent";
  let descriptor = null;
  let probePath = "";
  let probeOwned = false;

  try {
    const rawParent = String(parentValue || "").trim();
    if (!rawParent || rawParent.includes("\0") || !pathApi.isAbsolute(rawParent)) {
      throw invalidError("MANAGED_OUTPUT_PATH_UNAVAILABLE", stage);
    }
    const parentPath = fsApi.realpathSync(rawParent);
    if (!fsApi.statSync(parentPath).isDirectory()) {
      throw invalidError("MANAGED_OUTPUT_PATH_UNAVAILABLE", stage, "ENOTDIR");
    }

    const folderName = String(directoryName || "").trim();
    if (!folderName || folderName === "." || folderName === ".." || pathApi.basename(folderName) !== folderName) {
      throw invalidError("MANAGED_OUTPUT_CREATE_FAILED", "validate_directory_name");
    }
    const useSelectedDirectory = pathApi.basename(parentPath) === folderName;
    const requestedPath = useSelectedDirectory ? parentPath : pathApi.join(parentPath, folderName);
    let alreadyExists = useSelectedDirectory;

    stage = "check_destination";
    if (!useSelectedDirectory) {
      try {
        const existing = fsApi.statSync(requestedPath);
        alreadyExists = true;
        if (!existing.isDirectory()) throw invalidError("MANAGED_OUTPUT_NAME_CONFLICT", stage, "EEXIST");
      } catch (error) {
        if (error?.reason) throw error;
        if (error?.code !== "ENOENT") throw error;
      }
    }

    if (!alreadyExists) {
      stage = "create_directory";
      try {
        fsApi.mkdirSync(requestedPath, { recursive: true, mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        stage = "check_destination";
        const concurrent = fsApi.statSync(requestedPath);
        if (!concurrent.isDirectory()) throw invalidError("MANAGED_OUTPUT_NAME_CONFLICT", stage, "EEXIST");
      }
    }

    stage = "resolve_destination";
    const outputPath = fsApi.realpathSync(requestedPath);
    stage = "verify_destination";
    if (!fsApi.statSync(outputPath).isDirectory()) {
      throw invalidError("MANAGED_OUTPUT_NAME_CONFLICT", stage, "EEXIST");
    }

    stage = "write_probe";
    probePath = pathApi.join(outputPath, `.appraisal-write-check-${process.pid}-${random(8).toString("hex")}.tmp`);
    descriptor = fsApi.openSync(probePath, "wx", 0o600);
    probeOwned = true;
    const probeBytes = Buffer.from("Appraisal Toolbox output check", "utf8");
    const written = fsApi.writeSync(descriptor, probeBytes);
    if (written !== probeBytes.length) throw Object.assign(new Error("MANAGED_OUTPUT_PROBE_SHORT_WRITE"), { code: "EIO" });
    fsApi.closeSync(descriptor);
    descriptor = null;

    stage = "delete_probe";
    fsApi.unlinkSync(probePath);
    probePath = "";
    probeOwned = false;

    return {
      path: outputPath,
      parentPath,
      directoryName: folderName,
      createdDirectory: !alreadyExists,
    };
  } catch (error) {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch { /* Keep the primary failure stage. */ }
      descriptor = null;
    }
    if (probeOwned && probePath) {
      try { fsApi.unlinkSync(probePath); } catch { /* A cleanup error must not disclose a local path. */ }
    }
    if (error?.reason && error?.diagnostics) throw error;
    throw publicError(error, stage);
  }
}

function managedOutputFailure(error, action, legacyReason = "MANAGED_OUTPUT_CREATE_FAILED") {
  const safeError = error?.reason ? error : publicError(error, error?.stage || "create_directory");
  const reason = safeError.reason || legacyReason;
  return {
    ok: false,
    cancelled: false,
    action,
    path: "",
    paths: [],
    outputDirectory: "",
    reason,
    diagnostics: safeError.diagnostics,
    security: { credentialsReturned: false },
  };
}

async function chooseManagedOutputDirectory(options = {}) {
  const selectDirectory = options.selectDirectory;
  const action = String(options.action || "managed_output_directory_selected");
  const legacyReason = String(options.legacyReason || "MANAGED_OUTPUT_CREATE_FAILED");
  const result = await selectDirectory(options.prompt || "");
  const selectedPath = String(result?.outputDirectory || result?.path || result?.paths?.[0] || "").trim();
  if (!result?.ok) {
    return {
      ...result,
      action,
      path: "",
      paths: [],
      security: { credentialsReturned: false },
    };
  }
  if (!selectedPath) {
    return {
      ...result,
      ok: false,
      cancelled: false,
      action,
      path: "",
      paths: [],
      outputDirectory: "",
      reason: "FILE_PICKER_EMPTY_RESULT",
      diagnostics: result?.diagnostics || {
        exitCode: null,
        stderrTail: ["阶段: response_validation", "错误码: FILE_PICKER_EMPTY_RESULT"],
      },
      security: { credentialsReturned: false },
    };
  }
  try {
    const managed = ensureManagedOutputDirectory(selectedPath, options.directoryName, options.dependencies);
    return {
      ...result,
      ok: true,
      action,
      path: managed.path,
      paths: [managed.path],
      outputDirectory: managed.path,
      parentPath: managed.parentPath,
      directoryName: managed.directoryName,
      createdDirectory: managed.createdDirectory,
      security: { credentialsReturned: false },
    };
  } catch (error) {
    return managedOutputFailure(error, action, legacyReason);
  }
}

module.exports = {
  chooseManagedOutputDirectory,
  ensureManagedOutputDirectory,
  managedOutputFailure,
  reasonFor,
};
