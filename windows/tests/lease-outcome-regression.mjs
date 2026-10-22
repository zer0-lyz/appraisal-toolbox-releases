import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as lease from '../../src/modules/alibaba-lease/module.js';

const evidence = path.resolve(process.argv[2]);
fs.mkdirSync(evidence, { recursive: true });
const checks = [];
const request = { ...lease.DEFAULT_CONFIG, startDate: '2026-06-01', endDate: '2026-10-09', maxPages: 2, outputDirectory: 'E:\\synthetic-lease-output', generateMap: false };
const detailUrl = id => `https://zc-item.taobao.com/auction/${id}.htm`;
const soldSummary = '结束时间 2026/09/01 10:00:00\n成交价 43,000 元/年\n本场已结束！\n竞买记录（1）';
globalThis.window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), setTimeout: (fn, ms) => setTimeout(fn, ms === 900 ? 0 : ms), clearTimeout };
function detailDocument(text) {
  return { title: '阿里资产租赁详情', body: { innerText: text }, scripts: [], querySelector: s => s === 'h1' ? { innerText: '住宅租赁成交案例' } : null, querySelectorAll: () => [] };
}
async function extract(text) {
  globalThis.location = { href: detailUrl(123456789100) };
  globalThis.document = detailDocument(text);
  return await lease.extractLeaseDetailPage();
}
for (const unrelated of ['标的物详情描述\n未达到竞价条件或无人出价时，本次竞价失败。', '为您推荐\n其他标的\n竞价失败（无人出价）']) {
  const detail = await extract(`${soldSummary}\n${unrelated}`);
  assert.equal(detail.failedNoBids, false);
  assert.equal(lease.parseLeaseDetail(detail, request).valid, true);
  assert.equal(detail.transactionAmount, '43000');
}
checks.push('公告条款及推荐标的中的流拍文字不会拒收本场明确成交');
const unsold = await extract('结束时间 2026/09/01 10:00:00\n起始价 10,000 元\n本场已结束\n竞价失败（无人出价）\n竞买记录（0）\n为您推荐\n其他成交标的\n成交价 999,999 元');
assert.equal(unsold.failedNoBids, true);
assert.equal(unsold.hasExplicitSoldPrice, false);
assert.equal(lease.parseLeaseDetail(unsold, request).valid, false);
checks.push('本场真实无人出价继续拒收，推荐成交价不能污染本场金额');
const conflict = await extract(`${soldSummary}\n竞价失败（无人出价）`);
assert.equal(lease.parseLeaseDetail(conflict, request).valid, false);
assert.match(lease.skipReason(conflict, lease.parseLeaseDetail(conflict, request), request), /信息.*人工核对/);
checks.push('本场成交与流拍信息冲突时拒收并给出人工核对原因');

function contextFor(pages, details, nativeReply = { ok: true }) {
  const tab = { id: 71, active: true, url: lease.buildSourceUrl(request) };
  const listeners = new Set();
  const visited = [], nativeCalls = [], progress = [];
  const chrome = {
    tabs: {
      query: async () => [tab], get: async () => tab,
      update: async (_id, values) => { tab.url = values.url; visited.push(values.url); for (const f of [...listeners]) f(tab.id, { status: 'complete' }); return tab; },
      onUpdated: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) },
    },
    scripting: { executeScript: async ({ func }) => {
      globalThis.location = { href: tab.url };
      if (details[tab.url]) globalThis.document = detailDocument(details[tab.url]);
      else {
        const items = pages[Number(new URL(tab.url).searchParams.get('page'))] || [];
        const cards = items.map(item => {
          const anchor = { href: detailUrl(item.id), innerText: item.title || '住宅租赁权', parentElement: null, hasAttribute: () => false, getAttribute: () => '', getBoundingClientRect: () => ({ width: 100, height: 20 }) };
          return { innerText: `${item.title || '住宅租赁权'}\n结束时间 ${item.date}\n起始价 10,000 元/年`, querySelector: () => anchor };
        });
        globalThis.document = { title: '阿里资产租赁列表', body: { innerText: `共 ${cards.length} 条` }, scripts: [], querySelector: () => ({ children: cards }), querySelectorAll: () => [] };
      }
      return [{ result: await func() }];
    } },
  };
  return { context: { chrome, sendNativeMessage: async value => { nativeCalls.push(value); return { ...nativeReply, results: value.results, htmlPath: nativeReply.ok ? 'E:\\synthetic-lease-output\\latest.html' : '' }; } }, visited, nativeCalls, progress };
}
const fixture = contextFor({ 1: [{ id: 123456789101, date: '2023/12/15' }], 2: [{ id: 123456789102, date: '2026/09/01' }] }, { [detailUrl(123456789102)]: `${soldSummary}\n标的物详情描述\n无人出价将竞价失败` });
const result = await lease.runCurrentTabScrape(fixture.context, request, p => fixture.progress.push(p));
assert.equal(result.ok, true);
assert.equal(result.results.length, 1);
assert.equal(result.listedCount, 2);
assert.equal(result.candidates, 1);
assert.equal(result.datePrefiltered, 1);
assert.equal(result.skipped, 1);
assert.equal(fixture.nativeCalls[0].candidates, 2);
assert(fixture.visited.some(url => url.includes('page=2')));
assert(!fixture.visited.includes(detailUrl(123456789101)));
checks.push('日期较早的首页不会提前停翻页，第二页范围内成交被读取，旧详情不访问，列表/候选/跳过数量一致');

const emptyFixture = contextFor({ 1: [{ id: 123456789103, date: '2023/12/15' }, { id: 123456789104, date: '2026/09/01' }], 2: [] }, { [detailUrl(123456789104)]: '结束时间 2026/09/01 10:00:00\n起始价 10,000 元\n本场已结束\n竞价失败（无人出价）\n竞买记录（0）' });
const emptyResult = await lease.runCurrentTabScrape(emptyFixture.context, request, p => emptyFixture.progress.push(p));
assert.equal(emptyResult.ok, false);
assert.equal(emptyResult.empty, true);
assert.equal(emptyResult.phase, 'completed_empty');
assert.equal(emptyResult.listedCount, 2);
assert.equal(emptyResult.skipped, 2);
assert.equal(emptyResult.skippedReasons.length, 1);
assert.equal(emptyFixture.nativeCalls.length, 0);
assert.equal(emptyFixture.progress.at(-1).percent, 100);
checks.push('全流拍或范围外时返回100%核验完成和逐条原因，不伪造成交、不调用Native覆盖成果');

const failedWrite = contextFor({ 1: [{ id: 123456789105, date: '2026/09/01' }] }, { [detailUrl(123456789105)]: soldSummary }, { ok: false, reason: '测试输出目录写入失败' });
const failedResult = await lease.runCurrentTabScrape(failedWrite.context, { ...request, maxPages: 1 });
assert.equal(failedResult.ok, false);
assert.equal(failedResult.empty, undefined);
assert.equal(failedResult.errorCode, 'ALIBABA_LEASE_RESULT_WRITE_FAILED');
assert.match(failedResult.reason, /写入失败/);
checks.push('真正的Native写入失败继续报失败，不能显示详情核验成功作为完成原因');
const searchUrl = new URL(lease.buildSourceUrl(request));
assert.equal(lease.listPageMatchesRequest(searchUrl.href, request), true);
searchUrl.searchParams.delete('h_t_mode');
assert.equal(lease.listPageMatchesRequest(searchUrl.href, request), false);
const wrongStatusUrl = new URL(lease.buildSourceUrl(request));
wrongStatusUrl.searchParams.delete('statusOrders');
assert.equal(lease.listPageMatchesRequest(wrongStatusUrl.href, request), false);
checks.push('当前列表必须同时匹配租赁模式、物业类型、状态和地域，不能仅凭同一区域复用错误筛选');
const uiFixture = contextFor({ 1: [{ id: 123456789106, date: '2023/12/15' }, { id: 123456789107, date: '2026/09/01' }], 2: [] }, { [detailUrl(123456789107)]: '结束时间 2026/09/01\n起始价 10,000 元\n本场已结束\n竞价失败（无人出价）\n竞买记录（0）' });
const elements = new Map(), handlers = new Map(), statuses = [];
const element = id => {
  if (!elements.has(id)) elements.set(id, { id, value: '', dataset: {}, style: {}, innerHTML: '', textContent: '', checked: false, disabled: false, hidden: false, parentElement: { setAttribute() {} }, setAttribute() {}, remove() {} });
  return elements.get(id);
};
const ui = lease.alibabaLeaseModule.create();
await ui.initialize({
  ...uiFixture.context,
  chrome: { ...uiFixture.context.chrome, runtime: { getURL: value => value } },
  manifest: lease.alibabaLeaseModule.manifest,
  document: { getElementById: element, createElement: () => ({ remove() {} }), head: { appendChild() {} } },
  storage: { load: async () => ({ ...request, parameterSnapshot: { ...request } }), save: async () => {} },
  scope: { add() {}, on: (target, event, callback) => handlers.set(`${target.id}:${event}`, callback) },
  setStatus: (text, kind) => statuses.push({ text, kind }), navigate() {},
});
await handlers.get('runAlibabaLease:click')();
assert.equal(element('alibabaLeaseProgressPercent').textContent, '100%');
assert.match(element('alibabaLeaseProgressPhase').textContent, /核验完成/);
assert.equal(element('alibabaLeaseProgressFetched').textContent, '2');
assert.equal(element('alibabaLeaseProgressSkipped').textContent, '2');
assert.equal(element('alibabaLeaseResultMessage').dataset.kind, 'warn');
assert.equal(element('alibabaLeaseDiagnostics').hidden, false);
assert.match(element('alibabaLeaseDiagnostics').innerHTML, /日期范围外 1 条/);
assert.match(element('alibabaLeaseDiagnostics').innerHTML, /123456789107/);
assert.equal(uiFixture.nativeCalls.length, 0);
assert.equal(statuses.at(-1).kind, 'warn');
checks.push('执行真实模块初始化与按钮回调：空成交显示100%核验完成、正确计数和逐条详情链接，不落入抓取异常分支');
const summary = { ok: true, syntheticOnly: true, liveBrowserCovered: false, credentialDataRead: false, checks, counts: { success: { listedCount: result.listedCount, candidates: result.candidates, skipped: result.skipped, accepted: result.results.length }, empty: { listedCount: emptyResult.listedCount, candidates: emptyResult.candidates, skipped: emptyResult.skipped, accepted: 0 } } };
fs.writeFileSync(path.join(evidence, 'lease-outcome-regression.json'), JSON.stringify(summary, null, 2));
delete globalThis.window; delete globalThis.document; delete globalThis.location;
console.log(`Lease regressions passed (${checks.length} groups). Evidence: ${evidence}`);
