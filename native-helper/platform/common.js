"use strict";

const fs = require("node:fs");
const path = require("node:path");

function security() {
  return { credentialsReturned: false };
}

function pickerResult(stdout) {
  return {
    ok: true,
    paths: String(stdout || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    security: security(),
  };
}

function pickerFailure(error) {
  return {
    ok: false,
    cancelled: Number(error?.code) === 1
      || Number(error?.code) === 2
      || String(error?.message || "").includes("User canceled"),
    reason: "FILE_SELECTION_CANCELLED",
    security: security(),
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function createFileCredentialReference({ fallbackPath, key, secret }) {
  const values = readJson(fallbackPath, { secrets: {} });
  values.secrets = values.secrets || {};
  values.secrets[key] = secret;
  writeJson(fallbackPath, values);
  return `file:${fallbackPath}#${key}`;
}

function resolveFileCredentialReference(reference) {
  if (!String(reference || "").startsWith("file:")) return "";
  const [filePart, key] = String(reference).slice(5).split("#");
  if (!filePart || !key) return "";
  try {
    const values = readJson(filePart, {});
    return String(values?.secrets?.[key] || values?.[key] || "");
  } catch {
    return "";
  }
}

function commandAvailable(execFileSync, command, args = ["--version"]) {
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  commandAvailable,
  createFileCredentialReference,
  pickerFailure,
  pickerResult,
  readJson,
  resolveFileCredentialReference,
  security,
  writeJson,
};
