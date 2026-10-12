const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
function probe(root, message, options = {}) {
  const env = { ...process.env,
    TIANYUAN_NATIVE_RUNTIME_ROOT: path.join(root, 'native-helper'),
    TIANYUAN_PYTHON_BIN: path.join(root, 'runtime', 'python-portable', 'python.exe'),
    TIANYUAN_PRINT_SKILLS_DIR: path.join(root, 'skills'),
    TIANYUAN_DEPRECIATION_SKILL_DIR: path.join(root, 'skills', 'depreciation-capex-forecast'),
    TIANYUAN_CODEX_GLOBAL_STATE_PATH: path.join(root, 'unused-test-global-state.json'),
    ...options.env };
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'native-helper', 'native_host.exe'), ['chrome-extension://aamfmhcbjgofhmannejoiilkkpchfkgm/'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const body = Buffer.from(JSON.stringify(message));
    const length = Buffer.alloc(4); length.writeUInt32LE(body.length);
    const messages = []; let buffer = Buffer.alloc(0), stderr = '', settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); }
      reject(new Error('Owned Native Messaging test process exceeded timeout'));
    }, options.timeout || 180000);
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (size > 16 * 1024 * 1024) { child.kill(); reject(new Error('Invalid Native Messaging frame')); return; }
        if (buffer.length < 4 + size) break;
        messages.push(JSON.parse(buffer.subarray(4, size + 4).toString('utf8')));
        buffer = buffer.subarray(4 + size);
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-10000); });
    child.on('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer); if (settled) return; settled = true;
      resolve({ message, exitCode, signal, messages, stderr, final: messages.findLast(item => item.event === 'complete') || messages.at(-1) });
    });
    child.stdin.end(Buffer.concat([length, body]));
  });
}
module.exports = { probe };
if (require.main === module) {
  const [root, requestFile, evidenceFile] = process.argv.slice(2);
  probe(path.resolve(root), JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''))).then(result => {
    fs.writeFileSync(evidenceFile, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: result.final?.ok === true, hostExitCode: result.exitCode, responseCount: result.messages.length, reason: result.final?.reason }));
    process.exitCode = result.final?.ok === true && result.exitCode === 0 ? 0 : 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
