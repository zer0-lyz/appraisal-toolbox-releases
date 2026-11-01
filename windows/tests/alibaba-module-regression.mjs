import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyAlibabaPage,
  getAlibabaFailureMessage,
  isAlibabaLoginUrl,
  isAlibabaVerificationUrl,
} from "../../src/core/alibaba-page-state.js";
import * as auction from "../../src/modules/alibaba-auction/module.js";
import * as lease from "../../src/modules/alibaba-lease/module.js";
import { alibabaAuctionTemplate } from "../../src/modules/alibaba-auction/template.js";
import { alibabaLeaseTemplate } from "../../src/modules/alibaba-lease/template.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDirectory, "../..");
const evidenceDirectory = path.resolve(process.argv[2] || path.join(testDirectory, "alibaba-module-regression-evidence"));
fs.mkdirSync(evidenceDirectory, { recursive: true });

const cases = [];
for (const [name, template, outputId, applyId, runId] of [
  ["auction", alibabaAuctionTemplate, "alibabaAuctionOutputDirectory", "saveAlibabaAuctionParams", "runAlibabaAuction"],
  ["lease", alibabaLeaseTemplate, "alibabaLeaseOutputDirectory", "saveAlibabaLeaseParams", "runAlibabaLease"],
]) {
  assert(template.indexOf(outputId) < template.indexOf(applyId), `${name}: output selection must precede apply confirmation`);
  assert(template.indexOf(applyId) < template.indexOf(runId), `${name}: apply confirmation must precede network scraping`);
}
cases.push("auction and lease operation order is filters, output location, apply, then page/network actions");

const loginPages = [
  "https://login.taobao.com/member/login.jhtml",
  "https://passport.taobao.com/",
  "https://sf.taobao.com/member/login.htm?redirect=https%3A%2F%2Fsf.taobao.com%2Flist",
  "https://sf.taobao.com/list/50025969.htm?login_jump=1",
];
for (const url of loginPages) {
  assert.equal(isAlibabaLoginUrl(url), true, `login route should be classified as login: ${url}`);
  assert.equal(isAlibabaVerificationUrl(url), false, `login route must not be classified as verification: ${url}`);
  assert.equal(classifyAlibabaPage({ url }), "login");
  assert.equal(auction.directPageLooksBlocked({ url }), "ALIBABA_LOGIN_REQUIRED");
  assert.equal(lease.pageLooksBlocked({ url }), "ALIBABA_LEASE_LOGIN_REQUIRED");
}
cases.push("four login host/path/query variants classified as login in both modules");

const verificationPages = [
  "https://sec.taobao.com/query.htm",
  "https://safe.taobao.com/captcha/verify?from=sf",
  "https://sf.taobao.com/list/50025969.htm?punish=1",
];
for (const url of verificationPages) {
  assert.equal(isAlibabaVerificationUrl(url), true, `security route should be classified as verification: ${url}`);
  assert.equal(classifyAlibabaPage({ url }), "verification");
  assert.equal(auction.directPageLooksBlocked({ url }), "ALIBABA_VERIFICATION_REQUIRED");
  assert.equal(lease.pageLooksBlocked({ url }), "ALIBABA_LEASE_VERIFICATION_REQUIRED");
}
assert.equal(auction.directPageLooksBlocked({ url: loginPages[0], verificationRequired: true }), "ALIBABA_LOGIN_REQUIRED");
assert.equal(lease.pageLooksBlocked({ url: loginPages[1], verificationRequired: true }), "ALIBABA_LEASE_LOGIN_REQUIRED");
cases.push("security URLs classified as verification; login remains higher priority than a generic DOM marker");

const listUrl = "https://sf.taobao.com/list/50025969__2__%BA%BC%D6%DD.htm?local=330109";
assert.equal(classifyAlibabaPage({ url: listUrl, title: "阿里拍卖", pageText: "萧山区住宅用房已结束列表" }), "");
assert.equal(classifyAlibabaPage({ url: listUrl, title: "阿里拍卖", pageText: "萧山区住宅用房已结束列表 请登录后收藏 会员登录" }), "");
assert.equal(classifyAlibabaPage({ url: listUrl, title: "阿里拍卖", loginFormPresent: true }), "login");
assert.equal(classifyAlibabaPage({ url: listUrl, title: "阿里拍卖", loginFormPresent: true, verificationRequired: true }), "login");
assert.equal(auction.isAlibabaVerificationUrl(listUrl), false);
assert.equal(lease.isLeaseVerificationUrl("https://zc-paimai.taobao.com/auction/search.htm"), false);
assert.equal(lease.isLeaseVerificationUrl(loginPages[0]), false);
assert.equal(lease.pageWaitState({ url: loginPages[1] }, listUrl, "list"), "login");
assert.equal(lease.pageWaitState({ url: "https://sec.taobao.com/query.htm" }, listUrl, "list"), "verification");
assert.equal(auction.pageWaitState({ url: loginPages[0] }, listUrl, "list"), "login");
cases.push("normal listing URL is not treated as a gate; wait state keeps login distinct from verification");

const loginTab = { id: 27, url: "https://passport.taobao.com/" };
let loginTabReads = 0;
const loginProgress = [];
const fakeChrome = {
  tabs: {
    query: async () => [loginTab],
    get: async () => {
      loginTabReads += 1;
      if (loginTabReads >= 3) loginTab.url = listUrl;
      return loginTab;
    },
  },
  scripting: {
    executeScript: async ({ func, args }) => [{ result: await func(...(args || [])) }],
  },
};
const resumedAfterLogin = await auction.readAlibabaPageWithManualVerification(
  { chrome: fakeChrome }, loginTab,
  () => ({ url: listUrl, title: "阿里拍卖", pageText: "杭州市萧山区司法拍卖列表页面已经加载完成，可以开始读取记录", items: [] }),
  (payload) => loginProgress.push(payload), "读取列表", null,
  { expectedUrl: listUrl, pageKind: "list", loginTimeoutMs: 1000, loginPollIntervalMs: 5 },
);
assert.equal(resumedAfterLogin.value.url, listUrl);
assert(loginProgress.some((payload) => payload.phase === "login_required"));
cases.push("拍卖执行器在当前标签页等待人工登录，登录返回目标列表后自动继续读取，不代填凭据");

const uncompletedLoginTab = { id: 28, url: "https://passport.taobao.com/" };
await assert.rejects(
  auction.readAlibabaPageWithManualVerification({
    chrome: {
      tabs: { query: async () => [uncompletedLoginTab], get: async () => uncompletedLoginTab },
      scripting: { executeScript: async ({ func, args }) => [{ result: await func(...(args || [])) }] },
    },
  }, uncompletedLoginTab, () => ({}), () => {}, "读取列表", null,
  { expectedUrl: listUrl, pageKind: "list", loginTimeoutMs: 20, loginPollIntervalMs: 5 },
  ),
  (error) => error.code === "ALIBABA_LOGIN_TIMEOUT",
);
cases.push("未完成登录时等待超时会给出专用登录超时结果，不伪报验证失败或继续写空结果");

const leaseLoginRequest = { ...lease.DEFAULT_CONFIG, maxPages: 1, outputDirectory: "C:\\lease-output" };
const leaseLoginUrl = lease.buildSourceUrl(leaseLoginRequest, 1);
const leaseLoginTab = { id: 29, url: leaseLoginUrl, active: true };
let leaseTabReads = 0;
let leaseAuthenticated = false;
const leaseProgress = [];
const leaseLoginResult = await lease.runCurrentTabScrape({
  chrome: {
    tabs: {
      query: async () => [leaseLoginTab],
      get: async () => {
        leaseTabReads += 1;
        if (leaseTabReads >= 2) leaseAuthenticated = true;
        return leaseLoginTab;
      },
    },
    scripting: {
      executeScript: async () => [{ result: leaseAuthenticated
        ? { url: leaseLoginUrl, title: "阿里资产租赁", pageText: "当前筛选列表已经加载完成，暂时没有符合条件的租赁成交记录", items: [], listContainerFound: true }
        : { url: leaseLoginUrl, title: "阿里资产租赁", pageText: "请登录淘宝后查看列表", items: [], listContainerFound: true, loginFormPresent: true } }],
    },
  },
}, leaseLoginRequest, (payload) => leaseProgress.push(payload));
assert(leaseProgress.some((payload) => payload.phase === "login_required"));
assert.equal(leaseLoginResult.errorCode, "ALIBABA_LEASE_LIST_EMPTY", "lease scrape must continue only after the manual-login gate clears");
cases.push("租赁模块经过人工登录等待后恢复读取列表，空列表错误不再混成登录错误");

const loginMessage = getAlibabaFailureMessage("ALIBABA_LOGIN_REQUIRED", "ALIBABA_LOGIN_REQUIRED: old detail", "auction");
const loginTimeoutMessage = getAlibabaFailureMessage("ALIBABA_LOGIN_TIMEOUT", "", "auction");
const openedLoginMessage = getAlibabaFailureMessage("ALIBABA_LEASE_LOGIN_REQUIRED", "", "lease", { opened: true });
const verificationMessage = getAlibabaFailureMessage("ALIBABA_VERIFICATION_TIMEOUT", "", "auction");
assert.match(loginMessage, /手动完成登录/);
assert.match(loginTimeoutMessage, /等待.*淘宝登录超时/);
assert.match(openedLoginMessage, /检索页已在当前浏览器打开，但.*要求淘宝登录/);
assert.match(verificationMessage, /安全验证或页面加载超时/);
assert(!/ALIBABA_[A-Z_]+/.test(`${loginMessage} ${loginTimeoutMessage} ${openedLoginMessage} ${verificationMessage}`));
cases.push("actionable Chinese gate messages hide internal error codes");

globalThis.window = {
  location: { href: "https://passport.taobao.com/" },
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
};
globalThis.document = { body: { innerText: "淘宝登录" }, querySelectorAll: () => [] };
const loginStatus = await auction.synchronizeAlibabaAuctionStatus("finished");
assert.equal(loginStatus.errorCode, "ALIBABA_LOGIN_REQUIRED");
globalThis.window.location.href = "https://sec.taobao.com/query.htm";
const verificationStatus = await auction.synchronizeAlibabaAuctionStatus("finished");
assert.equal(verificationStatus.errorCode, "ALIBABA_VERIFICATION_REQUIRED");
delete globalThis.window;
delete globalThis.document;
cases.push("拍卖状态同步在序列化页面函数中区分 Passport 登录页和安全验证页");

for (const relative of ["src/modules/alibaba-auction/module.js", "src/modules/alibaba-lease/module.js"]) {
  const code = fs.readFileSync(path.join(sourceRoot, relative), "utf8");
  assert(!/\[(?:class|id)\*="(?:slider|verify)"\]/i.test(code), `${relative} must not treat generic sliders/verify badges as anti-bot challenges`);
}
cases.push("both extractors use explicit anti-bot DOM markers instead of generic slider/verify classes");

const selectedRange = { startDate: "2026-06-01", endDate: "2026-10-09" };
const listingCardText = "（特价奥体印象城旁）杭州萧山山丰瑞北苑201室十年租赁权\n发布日期 2026年09月10日\n结束时间 2023/12/15 10:04:57\n成交价 43,000 元/年";
const listingAnchor = {
  href: "https://zc-item.taobao.com/auction/123456789012.htm",
  innerText: "租赁权案例",
  textContent: "租赁权案例",
  parentElement: null,
  id: "",
  className: "",
  hasAttribute: () => false,
  getAttribute: () => "",
  getBoundingClientRect: () => ({ width: 100, height: 20 }),
};
const listingCard = {
  innerText: listingCardText,
  textContent: listingCardText,
  querySelector: () => listingAnchor,
};
globalThis.window = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
globalThis.location = { href: "https://zc-paimai.taobao.com/wow/pm/default/pc/zichansearch" };
globalThis.document = {
  title: "阿里资产租赁",
  body: { innerText: "共 40 条" },
  scripts: [],
  querySelector: () => ({ children: [listingCard] }),
  querySelectorAll: () => [],
};
const listed = lease.extractLeaseListPage();
assert.equal(listed.items[0].listedEndDate, "2023/12/15", "listing parser should use the end-time field, not the first date on the card");
assert.equal(lease.listingDateMatchesRequest(listed.items[0], selectedRange), false, "out-of-range cards must be removed before visiting details");
assert.equal(lease.listingDateMatchesRequest({ listedEndDate: "" }, selectedRange), true, "cards without an explicit date must be checked on their detail page");
assert.equal(lease.pageWaitState({ url: "https://zc-item.taobao.com/auction/123456789012.htm", title: "租赁案例", pageText: "成交价 43,000 元/年" }, "https://zc-item.taobao.com/auction/123456789012.htm", "detail"), "ready", "成交价-only details must reach the parser instead of timing out");
cases.push("租赁列表卡片按结束时间字段过滤；先于详情页排除范围外记录，缺日期卡片交由详情页核验且不会误停翻页");

let injectedFunctions = 0;
let tabUpdates = 0;
let nativeWrites = 0;
const integrationListUrl = lease.buildSourceUrl({
  ...lease.DEFAULT_CONFIG,
  district: "萧山区",
  districtCode: "330109",
  startDate: selectedRange.startDate,
  endDate: selectedRange.endDate,
  maxPages: 1,
});
globalThis.location = { href: integrationListUrl };
const fakeTab = { id: 88, url: integrationListUrl, active: true };
const integrationContext = {
  chrome: {
    tabs: {
      query: async () => [fakeTab],
      get: async () => fakeTab,
      update: async () => { tabUpdates += 1; return fakeTab; },
    },
    scripting: {
      executeScript: async ({ func }) => {
        injectedFunctions += 1;
        return [{ result: func() }];
      },
    },
  },
  sendNativeMessage: async () => { nativeWrites += 1; return { ok: true }; },
};
const dateFilteredRun = await lease.runCurrentTabScrape(integrationContext, {
  ...lease.DEFAULT_CONFIG,
  district: "萧山区",
  districtCode: "330109",
  startDate: selectedRange.startDate,
  endDate: selectedRange.endDate,
  maxPages: 1,
}, () => {});
assert.equal(dateFilteredRun.ok, false);
assert.equal(dateFilteredRun.errorCode, "ALIBABA_LEASE_NO_CASES_IN_DATE_RANGE");
assert.equal(dateFilteredRun.candidates, 0);
assert.equal(dateFilteredRun.datePrefiltered, 1);
assert.match(dateFilteredRun.reason, /日期范围已在详情页访问前过滤/);
assert.equal(injectedFunctions, 1, "the old result must be filtered from the list without opening its detail page");
assert.equal(tabUpdates, 0);
assert.equal(nativeWrites, 0);
cases.push("端到端模拟列表筛选：2023 旧记录在进入详情页和 Native 写入前被排除，并返回所选日期范围说明");

let detailNavigations = 0;
let capturedNativeRequest = null;
const inRangeRequest = {
  ...lease.DEFAULT_CONFIG,
  district: "萧山区",
  districtCode: "330109",
  startDate: selectedRange.startDate,
  endDate: selectedRange.endDate,
  maxPages: 1,
};
const inRangeListUrl = lease.buildSourceUrl(inRangeRequest);
const inRangeTab = { id: 89, url: inRangeListUrl, active: true };
const updatedListeners = new Set();
globalThis.window = {
  getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (id) => clearTimeout(id),
};
globalThis.location = { href: inRangeListUrl };
const inRangeCardText = "萧山区住宅租赁权\n结束时间 2026/09/01 10:00:00\n成交价 43,000 元/年";
const inRangeAnchor = { ...listingAnchor, href: "https://zc-item.taobao.com/auction/123456789013.htm" };
const inRangeCard = { ...listingCard, innerText: inRangeCardText, textContent: inRangeCardText, querySelector: () => inRangeAnchor };
globalThis.document = {
  title: "阿里资产租赁",
  body: { innerText: "共 1 条" },
  scripts: [],
  querySelector: () => ({ children: [inRangeCard] }),
  querySelectorAll: () => [],
};
const inRangeContext = {
  chrome: {
    tabs: {
      query: async () => [inRangeTab],
      get: async () => inRangeTab,
      update: async (_tabId, updateProperties) => {
        detailNavigations += 1;
        inRangeTab.url = updateProperties.url;
        globalThis.location.href = updateProperties.url;
        for (const listener of updatedListeners) listener(inRangeTab.id, { status: "complete" });
        return inRangeTab;
      },
      onUpdated: {
        addListener: (listener) => updatedListeners.add(listener),
        removeListener: (listener) => updatedListeners.delete(listener),
      },
    },
    scripting: {
      executeScript: async ({ func }) => {
        if (inRangeTab.url.includes("zc-item.taobao.com/auction/")) {
          globalThis.document = {
            title: "阿里资产租赁详情",
            body: { innerText: "结束时间 2026/09/01 10:04:57\n成交价 43,000 元/年\n租期 10年\n本场已结束！\n竞买记录（1）" },
            scripts: [],
            querySelector: (selector) => selector === "h1" ? { innerText: "萧山区住宅租赁权成交案例" } : null,
            querySelectorAll: () => [],
          };
        }
        return [{ result: await func() }];
      },
    },
  },
  sendNativeMessage: async (request) => {
    capturedNativeRequest = request;
    return { ok: true, results: request.results, htmlPath: "E:\\lease\\results.html", historyPath: "E:\\lease\\_history.json" };
  },
};
const inRangeRun = await lease.runCurrentTabScrape(inRangeContext, inRangeRequest, () => {});
assert.equal(inRangeRun.ok, true);
assert.equal(inRangeRun.results.length, 1);
assert.equal(inRangeRun.results[0].transactionAmount, 43000);
assert.equal(inRangeRun.results[0].resultStatus, "成交");
assert.equal(inRangeRun.results[0].endTime, "2026-09-01");
assert.equal(detailNavigations, 1, "only the in-range candidate should be opened for details");
assert.equal(capturedNativeRequest.results.length, 1);
assert.equal(capturedNativeRequest.results[0].transactionAmount, 43000);
cases.push("端到端模拟范围内成交：只打开范围内详情，识别43,000元/年成交价并写入结果");

const detailText = [
  "结束时间 2023/12/15 10:04:57",
  "成交价 43,000 元/年",
  "租期 10年",
  "本场已结束！",
  "竞买记录（1）",
].join("\n");
globalThis.document = {
  title: "阿里资产租赁详情",
  body: { innerText: detailText },
  scripts: [],
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.location = { href: "https://zc-item.taobao.com/auction/123456789012.htm" };
const extractedLeaseDetail = await lease.extractLeaseDetailPage();
assert.equal(extractedLeaseDetail.endTime, "2023/12/15 10:04:57");
assert.equal(extractedLeaseDetail.transactionAmount, "43000", "explicit 成交价 is the first-year rent amount");
assert.equal(extractedLeaseDetail.hasExplicitSoldPrice, true);
assert.equal(extractedLeaseDetail.bidCount, 1);
const soldLeaseRecord = lease.parseLeaseDetail(extractedLeaseDetail, { province: "浙江省", city: "杭州市", district: "萧山区" });
assert.equal(soldLeaseRecord.valid, true, "ended listing with an explicit 成交价 is a sold lease case");
assert.equal(soldLeaseRecord.resultStatus, "成交");
assert.equal(lease.matchesRequest(soldLeaseRecord, selectedRange), false, "the real 2023 end date must not be included in the selected 2026 range");
assert.match(lease.skipReason(extractedLeaseDetail, soldLeaseRecord, selectedRange), /早于所选起始日/);
assert.equal(lease.matchesRequest({ endTime: "", title: "案例" }, selectedRange), false, "date-filtered runs must reject details without an end date");
assert.match(lease.skipReason({ ...extractedLeaseDetail, endTime: "" }, { ...soldLeaseRecord, endTime: "" }, selectedRange), /未读取到结束时间/);
cases.push("详情解析识别租赁页的“成交价 43,000 元/年”，同时严格排除 2023 结果并拒绝无法核验日期的记录");

delete globalThis.window;
delete globalThis.document;
delete globalThis.location;

const result = {
  ok: true,
  syntheticOnly: true,
  browserUiCovered: false,
  liveAlibabaNetworkCovered: false,
  accountDataRead: false,
  cases,
};
fs.writeFileSync(path.join(evidenceDirectory, "alibaba-module-regression.json"), JSON.stringify(result, null, 2), "utf8");
console.log(`Alibaba page-state regressions passed (${cases.length} cases). Evidence: ${evidenceDirectory}`);
