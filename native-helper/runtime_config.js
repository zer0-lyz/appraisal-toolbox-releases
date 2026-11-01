"use strict";

const fs = require("node:fs");
const path = require("node:path");
const launcher = require("./process_launcher.js");
const { createPlatformAdapter } = require("./platform/index.js");

function loadRuntimeConfig(env = process.env) {
  const configPath = env.TIANYUAN_RUNTIME_CONFIG_PATH
    || path.join(launcher.runtimeDirectory({ env }), "runtime-config.json");
  try {
    const value = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? launcher.normalizeRuntimeConfig(value) : {};
  } catch { return {}; }
}

function resolvePythonBin({ env = process.env, config = loadRuntimeConfig(env), platform = createPlatformAdapter({ env }) } = {}) {
  return env.TIANYUAN_PYTHON_BIN || env.PYTHON_BIN || config.pythonBin || platform.defaultPythonBin;
}

module.exports = { loadRuntimeConfig, resolvePythonBin };
