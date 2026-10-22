"use strict";

const { createMacOSAdapter } = require("./macos.js");
const { createUnsupportedAdapter } = require("./unsupported.js");
const { createWindowsAdapter } = require("./windows.js");

function createPlatformAdapter(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "win32") return createWindowsAdapter(options);
  if (platform === "darwin") return createMacOSAdapter(options);
  return createUnsupportedAdapter({ ...options, platform });
}

module.exports = { createPlatformAdapter };
