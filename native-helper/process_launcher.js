"use strict";

const fs = require("node:fs");
const path = require("node:path");

const POWERSHELL_WRAPPER = [
  "$ErrorActionPreference = 'Stop'",
  "$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TIANYUAN_PROCESS_PAYLOAD))",
  "$payload = $json | ConvertFrom-Json",
  "$arguments = @($payload.args | ForEach-Object { [string]$_ })",
  "& ([string]$payload.command) @arguments",
  "exit $LASTEXITCODE",
].join("\n");

function encodedPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function isWindowsCommandScript(command) {
  return /\.(?:cmd|bat)$/i.test(String(command || "").trim());
}

function normalizeRuntimeConfig(value = {}) {
  return {
    ...value,
    tycpvBin: value.tycpvBin || value.cli || "",
    pythonBin: value.pythonBin || value.python || "",
    printSkillsDir: value.printSkillsDir || value.printSkills || "",
  };
}

function scriptPathFromArgv(argv = process.argv) {
  const candidate = String(argv?.[1] || "");
  if (!candidate || candidate.startsWith("-")) return "";
  if (!/\.(?:c?js|mjs)$/i.test(candidate)) return "";
  try {
    return fs.existsSync(candidate) ? path.resolve(candidate) : "";
  } catch {
    return "";
  }
}

function runtimeDirectory({
  env = process.env,
  argv = process.argv,
  execPath = process.execPath,
} = {}) {
  const configured = String(env.TIANYUAN_NATIVE_RUNTIME_ROOT || "").trim();
  if (configured) return path.resolve(configured);
  const scriptPath = scriptPathFromArgv(argv);
  return path.dirname(scriptPath || execPath);
}

function selfLaunchSpec(args, {
  argv = process.argv,
  execPath = process.execPath,
  env = process.env,
} = {}) {
  const scriptPath = scriptPathFromArgv(argv);
  return {
    command: execPath,
    args: scriptPath ? [scriptPath, ...args] : [...args],
    env: { ...env },
    mode: scriptPath ? "node-script" : "standalone-executable",
  };
}

function commandLaunchSpec(command, args, {
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== "win32" || !isWindowsCommandScript(command)) {
    return {
      command,
      args: [...args],
      env: { ...env },
      mode: "direct",
    };
  }
  const payload = Buffer.from(JSON.stringify({
    command: String(command),
    args: args.map((value) => String(value)),
  }), "utf8").toString("base64");
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedPowerShell(POWERSHELL_WRAPPER),
    ],
    env: {
      ...env,
      TIANYUAN_PROCESS_PAYLOAD: payload,
    },
    mode: "windows-command-wrapper",
  };
}

module.exports = {
  commandLaunchSpec,
  isWindowsCommandScript,
  normalizeRuntimeConfig,
  runtimeDirectory,
  scriptPathFromArgv,
  selfLaunchSpec,
};
