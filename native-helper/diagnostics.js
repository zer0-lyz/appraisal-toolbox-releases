"use strict";

function redactDiagnosticText(value) {
  return String(value || "")
    .replace(/(["']?\b(?:proxy-)?(?:authorization|set-cookie|cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\r\n]+)(?=\s*(?:,|$))/gi, "$1[REDACTED]")
    .replace(/(["']?\b(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|web[_-]?key|securityJsCode|amap[_-]?key|client[_-]?secret|token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|api_key|apikey|token|client_secret|secret)=)[^&#\s"'<>]*/gi, "$1[REDACTED]")
    .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z]:\\Users\\[^\r\n"'<>)]*/gi, "[用户路径]")
    .replace(/\/(?:Users|home)\/[^\r\n"'<>)]*/gi, "[用户路径]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]");
}

function buildRunnerDiagnostics(exitCode, stderr) {
  const lines = String(stderr || "")
    .split(/\r?\n/)
    .map((line) => redactDiagnosticText(line).trim())
    .filter(Boolean)
    .slice(-20)
    .map((line) => line.length > 512 ? `…${line.slice(-511)}` : line);
  let total = lines.reduce((sum, line) => sum + line.length, 0);
  while (total > 6000 && lines.length > 1) total -= lines.shift().length;
  if (total > 6000 && lines.length) lines[0] = `…${lines[0].slice(-5999)}`;
  return {
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    stderrTail: lines,
  };
}

function appendStderrTail(lines, line) {
  const text = redactDiagnosticText(line).trim();
  if (!text) return;
  lines.push(text.length > 512 ? `…${text.slice(-511)}` : text);
  if (lines.length > 20) lines.splice(0, lines.length - 20);
}

function pythonExportFailure(error, code) {
  const diagnostics = buildRunnerDiagnostics(Number.isInteger(error?.code) ? error.code : null, error?.stderr || error?.code || "导出文件回读失败");
  const tail = diagnostics.stderrTail.join("\n");
  const repair = process.platform === "darwin" ? "请运行安装.command 修复安装" : "请运行 install.cmd 修复安装";
  const reason = /openpyxl|ModuleNotFoundError/i.test(tail)
    ? `便携 Python 缺少 Excel 组件，${repair}`
    : /PermissionError|WinError\s*(?:5|32|33)|EACCES|EPERM|EBUSY/i.test(tail)
      ? "Excel 文件正被占用或无法写入，请关闭文件并检查输出目录权限"
      : /ENOENT/i.test(tail) ? `便携 Python 路径不可用，${repair}`
        : error?.killed ? "Excel 生成超时，请减少记录数量后重试" : "Excel 生成或回读校验失败，请检查输出目录和本机助手";
  const failure = new Error(reason);
  failure.code = code;
  failure.diagnostics = diagnostics;
  return failure;
}

module.exports = { redactDiagnosticText, buildRunnerDiagnostics, appendStderrTail, pythonExportFailure };
