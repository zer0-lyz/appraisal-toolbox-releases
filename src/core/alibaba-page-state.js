const LOGIN_TITLE = /^(?:(?:淘宝(?:会员)?|会员|账号)?登录|登录(?:淘宝|页面|账号|会员)?)(?:[\s|：:_-].*)?$/i;
const VERIFICATION_TEXT = /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证|拖动.{0,8}(?:滑块|拼图)|captcha|punish|security\s*check/i;

function parseAlibabaUrl(value) {
  const raw = typeof value === "string" ? value : String(value?.url || "");
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isAlibabaExpiredVerificationUrl(value) {
  const url = parseAlibabaUrl(value);
  return Boolean(url && /(^|\.)taobao\.com$/i.test(url.hostname)
    && /(?:^|\/)(?:iv|captcha|verify|challenge)(?:\/|$)/i.test(url.pathname)
    && /expired|timeout|invalid|过期/i.test(url.pathname));
}

export function isAlibabaLoginUrl(value) {
  const url = parseAlibabaUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (/(^|\.)taobao\.com$/i.test(host) && /^\/iv(?:\/|$)/i.test(url.pathname)) return false;
  if (host === "login.taobao.com" || host === "passport.taobao.com") return true;
  if (/(?:^|\/)(?:login|passport)(?:[./]|\/|$)/i.test(url.pathname)) return true;
  return [...url.searchParams.entries()].some(([key, item]) => /login_jump/i.test(`${key} ${item}`));
}

export function isAlibabaVerificationUrl(value) {
  const url = parseAlibabaUrl(value);
  if (!url || isAlibabaLoginUrl(url.href)) return false;
  const host = url.hostname.toLowerCase();
  if (host !== "taobao.com" && !host.endsWith(".taobao.com")) return false;
  const state = `${url.pathname} ${url.search} ${url.hash}`;
  return /^(?:sec|safe|verify|captcha|punish|anti)(?:[-.]|$)/i.test(host)
    || /^\/iv(?:\/|$)/i.test(url.pathname)
    || /(?:captcha|verify|validate|punish|challenge|security(?:[-_/]?check)?)/i.test(state);
}

export function classifyAlibabaPage(value) {
  const url = typeof value === "string" ? value : String(value?.url || "");
  const title = String(value?.title || "");
  const pageText = String(value?.pageText || "");
  if (isAlibabaLoginUrl(url)) return "login";
  if (isAlibabaVerificationUrl(url)) return "verification";
  // 登录文案可能出现在已登录列表页的导航、提示或推荐内容中。仅信任明确的
  // 登录 URL、可见登录表单标记或明确的页面标题，不用整页任意文本误判登录。
  if (value?.loginRequired === true || value?.loginFormPresent === true || LOGIN_TITLE.test(title)) return "login";
  if (value?.verificationRequired === true || VERIFICATION_TEXT.test(`${title} ${pageText}`)) return "verification";
  return "";
}

export function getAlibabaBlockedErrorCode(state, moduleKind = "auction") {
  if (state === "login") return moduleKind === "lease" ? "ALIBABA_LEASE_LOGIN_REQUIRED" : "ALIBABA_LOGIN_REQUIRED";
  if (state === "verification") return moduleKind === "lease" ? "ALIBABA_LEASE_VERIFICATION_REQUIRED" : "ALIBABA_VERIFICATION_REQUIRED";
  return "";
}

export function getAlibabaFailureMessage(errorCode, fallback = "", moduleKind = "auction", options = {}) {
  const code = String(errorCode || "").trim().toUpperCase();
  const isLease = moduleKind === "lease";
  const productName = isLease ? "阿里资产租赁" : "阿里司法拍卖";
  const openedPrefix = options.opened ? "检索页已在当前浏览器打开，但" : "";
  if (/_LOGIN_REQUIRED$/.test(code)) {
    return `${openedPrefix}${productName}页面要求淘宝登录。请在当前浏览器标签页手动完成登录，再回到工具箱点击“开始网络抓取”。`;
  }
  if (/_LOGIN_TIMEOUT$/.test(code)) {
    return `等待${productName}淘宝登录超时，抓取已停止。请在当前浏览器标签页完成登录后重新开始抓取。`;
  }
  if (/_VERIFICATION_REQUIRED$/.test(code)) {
    return `${openedPrefix}阿里页面要求安全验证。请在当前浏览器标签页手动完成验证，再回到工具箱点击“开始网络抓取”。`;
  }
  if (/_VERIFICATION_EXPIRED$/.test(code)) {
    return "阿里验证链接已过期，等待时间已结束。请重新打开列表页，在当前标签页完成登录或验证后重试。";
  }
  if (/_VERIFICATION_TIMEOUT$/.test(code)) {
    return "等待阿里登录/安全验证或页面加载超时。请确认当前标签页仍在目标列表页，完成登录或验证后重试。";
  }
  if (/_SCRIPT_EXECUTION_FAILED$/.test(code)) {
    return "当前阿里页面暂不可读取。请在当前浏览器标签页打开对应列表，等待页面加载后重试。";
  }
  if (/_TAB_REPLACED$/.test(code)) {
    return "抓取用的浏览器标签页已关闭或被替换。请重新打开阿里列表页后再试。";
  }
  if (/_TARGET_MISMATCH$/.test(code)) {
    return `当前标签页不是${productName}列表页。请点击“打开并登录”回到正确列表后重试。`;
  }
  if (/_LIST_EMPTY$/.test(code)) {
    return `没有读取到符合当前筛选条件的${productName}记录。请检查地区、类型、状态、日期和关键词，并确认列表已加载。`;
  }
  let message = String(fallback || "").trim();
  message = message.replace(/^\s*[A-Z][A-Z0-9_]{2,}\s*[:：]\s*/i, "").trim();
  if (message.length > 240 || /Command failed|Traceback|is not defined|[A-Z][A-Z0-9_]{3,}|python.exe|\n|[{}]/.test(message) || !/[\u4e00-\u9fff]/.test(message)) message = "";
  return message || `${productName}操作失败，请检查当前页面和筛选参数后重试。`;
}
