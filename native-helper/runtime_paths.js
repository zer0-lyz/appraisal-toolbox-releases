"use strict";

const path = require("node:path");

function nativeHelperDataDirectory(moduleDirectory = __dirname) {
  try {
    if (require("node:sea").isSea()) return path.dirname(process.execPath);
  } catch {
    // Ordinary Node.js development and source-based runs use their module directory.
  }
  return moduleDirectory;
}

module.exports = { nativeHelperDataDirectory };
