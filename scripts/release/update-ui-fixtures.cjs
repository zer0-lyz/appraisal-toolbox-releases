'use strict';
// Exercises the actual updates module in a synthetic DOM; this is not browser GUI acceptance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { JSDOM } = require(path.join(path.resolve(process.argv[2]), 'jsdom'));
const root = path.resolve(__dirname, '../..');
function budgetMinutes(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)\\s*\\*\\s*60\\s*\\*\\s*1000`));
  assert(match, `could not read ${name} minute budget from ${file}`);
  return Number(match[1]);
}
const uiPollBudgetMinutes = budgetMinutes('src/modules/updates/module.js', 'STATUS_POLL_BUDGET_MS');
const workerBudgetReferenceMinutes = budgetMinutes('native-helper/macos_update_worker.js', 'WORKER_BUDGET_MS');
assert(uiPollBudgetMinutes > workerBudgetReferenceMinutes, 'UI status polling must outlast the worker phase-budget reference');
const idle = { ok: true, action: 'get_update_status', updateStatusSupported: true, state: 'idle', phase: 'idle', verified: false, recoveryBlocked: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(setImmediate); assert(predicate(), 'fixture event did not arrive'); };

async function fixture(options = {}) {
  const platform = options.platform || 'macos-arm64';
  const updateStatusSupported = options.updateStatusSupported ?? platform === 'macos-arm64';
  const dom = new JSDOM('<div id="page-updates"></div><button id="openUpdatesTop"></button>', { url: 'https://fixture.invalid/' });
  const { document } = dom.window;
  const handlers = new Map(), timeouts = [], reloadTimers = [], opened = [], localStore = { ...(options.localStore || {}) };
  const originalSetTimeout = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, delay, ...args) => delay === 900
    ? (reloadTimers.push(callback), reloadTimers.length)
    : originalSetTimeout(callback, 1, ...args);
  const config = { productVersion: '0.2.2', buildNumber: 2026101701 };
  const contract = { runtimeBuildId: 'fixture', runtimeBuildKind: 'local' };
  const checkResult = {
    ok: true, action: 'check_github_update', releasePublished: true, updateAvailable: true,
    latestVersion: '0.2.3', platform, autoUpdateSupported: platform === 'windows-x64' || platform === 'macos-arm64',
    updateStatusSupported, releaseUrl: 'https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/tag/v0.2.3',
    asset: { name: 'fixture.zip', url: 'https://github.com/zer0-lyz/appraisal-toolbox-releases/releases/download/v0.2.3/fixture.zip', sha256: 'a'.repeat(64) },
    currentVersion: '0.2.2', currentBuildNumber: 2026101701, currentRuntimeBuildId: 'fixture', currentRuntimeBuildKind: 'local',
    ...(options.checkResult || {}),
  };
  const statusQueue = [...(options.statuses || [])];
  let statusCalls = 0, checks = 0, streams = 0, reloads = 0;
  const context = {
    document, manifest: { pageElementId: 'page-updates' }, extensionManifest: { version: '0.2.2' },
    storage: { migrateLegacy: async () => options.storedResult || null, save: async () => {} },
    setConnection() {}, setStatus() {}, isBusy: () => false, navigate() {},
    chrome: {
      runtime: { getURL: p => p, reload: () => reloads++ },
      tabs: { create: async value => opened.push(value) },
      storage: { local: {
        get: (keys, callback) => callback(Object.fromEntries(keys.filter(k => k in localStore).map(k => [k, localStore[k]]))),
        set: (values, callback) => { Object.assign(localStore, values); callback?.(); },
      } },
    },
    scope: {
      on: (element, event, handler) => handlers.set(element.id || event, handler),
      add() {}, interval() {}, timeout: (callback, delay) => timeouts.push({ callback, delay }),
    },
    sendNativeMessage: async message => {
      if (message.action === 'check_github_update') { checks++; return checkResult; }
      if (message.action === 'get_update_status') {
        statusCalls++;
        const next = statusQueue.length ? statusQueue.shift() : idle;
        return typeof next === 'function' ? await next() : next;
      }
      throw new Error(`unexpected Native action: ${message.action}`);
    },
    streamNativeMessage: async (message, progress) => {
      streams++;
      progress({ event: 'progress', percent: 20, phase: 'downloading', message: '正在下载更新包' });
      if (options.streamError) throw new Error(options.streamError);
      return options.streamResult || { ok: true, event: 'complete', accepted: true, state: 'starting', phase: 'starting', verified: false, transactionId: '11111111-1111-4111-8111-111111111111', platform };
    },
  };
  const sandbox = { window: dom.window, URL, Date, console, fetch: async url => ({ ok: true, json: async () => String(url).includes('runtime-compat') ? contract : config }) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/modules/updates/template.js'), 'utf8').replace('export const', 'const') + ';globalThis.updatesTemplate=updatesTemplate;', sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/modules/updates/module.js'), 'utf8').replace('export const', 'const').replace('import { updatesTemplate } from "./template.js";', '') + ';globalThis.module=updatesModule;', sandbox);
  await sandbox.module.create().initialize(context);
  return { document, handlers, timeouts, reloadTimers, opened, localStore, counters: () => ({ checks, statusCalls, streams, reloads }), close: () => dom.window.close() };
}

async function checkForUpdate(f) { await f.handlers.get('updatePrimaryAction')(); }
async function startUpdate(f) { return f.handlers.get('updatePrimaryAction')(); }
function verified(state, reason = '') { return { ok: state === 'complete', action: 'get_update_status', updateStatusSupported: true, state, phase: state, percent: state === 'complete' ? 100 : 0, verified: true, recoveryBlocked: false, transactionId: '11111111-1111-4111-8111-111111111111', ...(reason ? { reason } : {}) }; }

(async () => {
  const cases = [];
  {
    const busy = deferred(), complete = deferred();
    const f = await fixture({ statuses: [idle, () => busy.promise, () => complete.promise] });
    await checkForUpdate(f);
    const pending = startUpdate(f);
    await flush(() => f.counters().statusCalls >= 2);
    assert.equal(f.reloadTimers.length, 0, 'accepted starting receipt must not schedule reload');
    busy.resolve({ ...idle, state: 'busy', phase: 'downloading', percent: 46, message: '正在下载更新包' });
    await flush(() => f.counters().statusCalls >= 3);
    assert.match(f.document.getElementById('updateFeedback').textContent, /正在下载更新包/);
    assert.match(f.document.getElementById('updateFeedback').textContent, /本次状态读取已持续 1 分钟/);
    assert.equal(f.reloadTimers.length, 0, 'busy status must not schedule reload');
    complete.resolve(verified('complete'));
    await pending;
    assert.equal(f.reloadTimers.length, 1);
    for (const callback of f.reloadTimers) callback();
    assert.equal(f.counters().reloads, 1);
    cases.push({ name: 'mac-accepted-busy-complete', passed: true, statusCalls: f.counters().statusCalls, reloads: f.counters().reloads }); f.close();
  }
  {
    const f = await fixture({ statuses: [idle, verified('rolled_back', 'UPDATE_INSTALLER_ROLLED_BACK')] });
    await checkForUpdate(f); await startUpdate(f);
    assert.equal(f.counters().reloads, 0); assert.equal(f.reloadTimers.length, 0);
    assert.equal(f.document.getElementById('updatePrimaryAction').disabled, false);
    assert.match(f.document.getElementById('updateFeedback').textContent, /旧版本与原插件目录仍可用/);
    cases.push({ name: 'mac-verified-rollback-retryable', passed: true }); f.close();
  }
  {
    const f = await fixture({
      storedResult: { ok: true, platform: 'macos-arm64', updateStatusSupported: true, currentVersion: 'stale', currentBuildNumber: 1 },
      localStore: { appraisalToolboxUpdateStatusCapability: { platform: 'macos-arm64', updateStatusSupported: true } },
      statuses: [{ ok: false, action: 'get_update_status', updateStatusSupported: true, state: 'unknown', phase: 'unknown', verified: false, recoveryBlocked: true, reason: 'UPDATE_STATE_INVALID' }],
    });
    await f.timeouts.find(item => item.delay === 0).callback();
    assert.equal(f.counters().checks, 0, 'page reopen recovery must not depend on release source check');
    assert.equal(f.counters().statusCalls, 1);
    assert.equal(f.document.getElementById('updatePrimaryAction').disabled, true);
    assert.match(f.document.getElementById('updateFeedback').textContent, /更新状态记录无效/);
    cases.push({ name: 'page-reopen-stale-cache-unknown-blocks', passed: true }); f.close();
  }
  {
    const f = await fixture({ statuses: [idle, verified('complete')], streamError: 'NATIVE_STREAM_IDLE_TIMEOUT' });
    await checkForUpdate(f); await startUpdate(f);
    assert.equal(f.counters().reloads, 0); assert.equal(f.reloadTimers.length, 1);
    assert.doesNotMatch(f.document.getElementById('updateFeedback').textContent, /当前版本未改变/);
    for (const callback of f.reloadTimers) callback();
    assert.equal(f.counters().reloads, 1);
    cases.push({ name: 'stream-loss-status-proves-completion', passed: true }); f.close();
  }
  {
    const f = await fixture({ platform: 'windows-x64', updateStatusSupported: false, streamResult: { ok: true, event: 'complete', platform: 'windows-x64' } });
    await checkForUpdate(f); await startUpdate(f);
    assert.equal(f.counters().statusCalls, 0, 'legacy Windows path must not request the new action');
    assert.equal(f.reloadTimers.length, 1); for (const callback of f.reloadTimers) callback();
    assert.equal(f.counters().reloads, 1);
    cases.push({ name: 'windows-legacy-success', passed: true }); f.close();
  }
  {
    const f = await fixture({ platform: 'windows-x64', updateStatusSupported: false, checkResult: { autoUpdateSupported: false } });
    await checkForUpdate(f); await startUpdate(f);
    assert.equal(f.counters().statusCalls, 0); assert.equal(f.counters().streams, 0); assert.equal(f.opened.length, 1);
    cases.push({ name: 'windows-manual-fallback', passed: true }); f.close();
  }
  for (const [platform, expected] of [['windows-x64', 'Windows'], ['macos-arm64', 'Mac']]) {
    const f = await fixture({ platform, statuses: platform === 'macos-arm64' ? [idle, idle] : [], streamResult: { ok: false, event: 'complete', reason: 'UPDATE_EXTENSION_PATH_REQUIRED' } });
    await checkForUpdate(f); await startUpdate(f);
    assert.match(f.document.getElementById('updateFeedback').textContent, new RegExp(expected));
    cases.push({ name: `${platform}-repair-message`, passed: true }); f.close();
  }
  {
    const f = await fixture({ platform: 'windows-x64', updateStatusSupported: false, streamResult: { ok: false, event: 'complete', reason: 'UPDATE_WINDOWS_CONTEXT_UNVERIFIED' } });
    await checkForUpdate(f); await startUpdate(f);
    assert.match(f.document.getElementById('updateFeedback').textContent, /普通桌面会话/);
    cases.push({ name: 'windows-context-category-message', passed: true }); f.close();
  }
  {
    const f = await fixture({ platform: 'macos-arm64', statuses: [idle, { ...idle, state: 'unknown', phase: 'unknown', recoveryBlocked: true, reason: 'UPDATE_LOCK_LOST' }], streamResult: { ok: true, accepted: true, event: 'complete', state: 'starting', verified: false } });
    await checkForUpdate(f); await startUpdate(f);
    assert.equal(f.document.getElementById('updatePrimaryAction').disabled, true);
    assert.equal(f.counters().reloads, 0); assert.match(f.document.getElementById('updateFeedback').textContent, /已阻止重复安装/);
    cases.push({ name: 'mac-unknown-lock-loss-blocks', passed: true }); f.close();
  }
  const windowsFailures = [
    { name: 'windows-timeout-rollback-retryable', reason: 'UPDATE_PROCESS_TIMEOUT_ROLLED_BACK', message: /旧版本仍可用/, disabled: false },
    { name: 'windows-installer-rollback-retryable', reason: 'UPDATE_INSTALLER_ROLLED_BACK', message: /旧版本与原插件目录仍可用/, disabled: false },
    {
      name: 'windows-installer-context-rollback-verified', reason: 'UPDATE_INSTALLER_ROLLED_BACK',
      diagnostics: { failureCategory: 'registration_context_rejected', rollbackVerified: true },
      message: /安装器未通过本机环境核验，旧版本已恢复/, disabled: false,
    },
    {
      name: 'windows-installer-rollback-unverified-blocks', reason: 'UPDATE_INSTALLER_ROLLBACK_FAILED',
      diagnostics: { failureCategory: 'registration_context_rejected', rollbackVerified: false },
      message: /请勿重复更新/, disabled: true,
    },
    { name: 'windows-installer-rollback-failure-blocks', reason: 'UPDATE_INSTALLER_ROLLBACK_FAILED', message: /恢复状态无法核验/, disabled: true },
    { name: 'windows-owner-unverified-blocks', reason: 'UPDATE_LOCK_OWNER_UNVERIFIED', message: /无法确认上次更新事务状态/, disabled: true },
    { name: 'windows-state-write-failure-blocks', reason: 'UPDATE_LOCK_STATE_WRITE_FAILED', message: /状态无法可靠写入/, disabled: true },
    { name: 'windows-lock-arbitration-failure-blocks', reason: 'UPDATE_LOCK_ARBITRATION_FAILED', message: /无法确认跨进程更新锁状态/, disabled: true },
    { name: 'windows-abandoned-lock-blocks', reason: 'UPDATE_LOCK_ARBITRATION_ABANDONED', message: /上次更新锁异常中断/, disabled: true },
    { name: 'windows-lock-ownership-change-blocks', reason: 'UPDATE_LOCK_OWNERSHIP_CHANGED', message: /归属信息发生变化/, disabled: true },
    { name: 'windows-recovery-required-blocks', reason: 'UPDATE_RECOVERY_REQUIRED', message: /已阻止重复更新/, disabled: true },
    { name: 'windows-busy-message-blocks', reason: 'UPDATE_ALREADY_RUNNING', message: /已有更新正在执行，请等待当前更新结束/, disabled: true },
  ];
  for (const scenario of windowsFailures) {
    const f = await fixture({
      platform: 'windows-x64', updateStatusSupported: false,
      streamResult: { ok: false, event: 'complete', reason: scenario.reason, diagnostics: scenario.diagnostics },
    });
    await checkForUpdate(f); await startUpdate(f);
    assert.match(f.document.getElementById('updateFeedback').textContent, scenario.message, scenario.name);
    assert.equal(f.document.getElementById('updatePrimaryAction').disabled, scenario.disabled, scenario.name);
    assert.equal(f.counters().statusCalls, 0, 'legacy Windows must not request the Mac status action');
    cases.push({ name: scenario.name, passed: true }); f.close();
  }
  const summary = {
    ok: true,
    evidenceType: 'actual-updates-module-synthetic-DOM',
    budgets: { uiPollMinutes: uiPollBudgetMinutes, workerBudgetReferenceMinutes, uiExceedsWorkerReference: true },
    cases,
    guiCovered: false,
  };
  fs.writeFileSync(process.argv[3], JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
})().catch(error => { console.error(error); process.exitCode = 1; });
