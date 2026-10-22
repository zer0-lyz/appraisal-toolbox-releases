"use strict";

// 浙江土地官网响应严格校验。设计与约定：
// - 官网在反爬/维护窗口会对同一 JSON 接口返回 HTTP 200 + text/html（SPA 壳），
//   因此 HTTP 200 不代表成功，必须校验 Content-Type、JSON 可解析、
//   顶层结构、业务 code 与字段类型。
// - 错误码稳定可判别：LAND_<STAGE>_HTTP_<n> / _CONTENT_TYPE_INVALID /
//   _JSON_INVALID / _SCHEMA_INVALID / _BUSINESS_CODE_<code> / _EMPTY / _TIMEOUT。
// - 诊断信息只含脱敏内容：请求 URL（参数值白名单外一律替换）、HTTP 状态、
//   Content-Type、业务 code、响应体类型与截断摘要。不含任何凭据或个人数据。
const https = require("node:https");

const STAGES = new Set(["REGION", "LIST"]);

// 官网接口无敏感参数；白名单只保留分页与业务筛选参数名，其余参数值脱敏。
const SAFE_QUERY_KEYS = new Set([
  "currentPage", "pageSize", "resourceStage", "type", "current", "size", "sort",
  "regionCode", "landUse", "tradeMethod", "tradeStage", "startDate", "endDate",
]);

const REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  // 官网 WAF 对非常规 UA（如 "Mozilla/5.0 TianyuanWorkbench"）可能返回 HTML 壳，
  // 统一使用与浏览器一致的 UA 并附带 Referer。
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://www.zjzrzyjy.com/landView/land-bidding",
};

class LandPublicityHttpError extends Error {
  constructor(errorCode, message, diagnostics) {
    super(message || errorCode);
    this.name = "LandPublicityHttpError";
    this.errorCode = errorCode;
    this.diagnostics = diagnostics || null;
  }
}

function sanitizeUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return { url: "", host: "" };
  }
  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const safe = SAFE_QUERY_KEYS.has(key);
    kept.push(`${key}=${safe ? value : "REDACTED"}`);
  }
  parsed.search = kept.length ? `?${kept.join("&")}` : "";
  parsed.hash = "";
  return { url: parsed.href, host: parsed.host };
}

function bodyKind(contentType, body) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("json")) return "json";
  const text = String(body || "");
  if (!text.trim()) return "empty";
  if (/^\s*<(!doctype|html)/i.test(text)) return "html";
  return "text";
}

function truncatedSnippet(body, limit = 200) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  return text.slice(0, limit);
}

function buildDiagnostics({ stage, url, status, contentType, body, businessCode = null, error = "" }) {
  const sanitized = sanitizeUrl(url);
  return {
    stage,
    url: sanitized.url,
    host: sanitized.host,
    httpStatus: status ?? null,
    contentType: String(contentType || ""),
    businessCode,
    bodyKind: bodyKind(contentType, body),
    bodyBytes: Buffer.byteLength(String(body || ""), "utf8"),
    snippet: truncatedSnippet(body),
    error: String(error || "").slice(0, 160),
  };
}

function businessCodeOf(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { present: false, value: null };
  if (Object.prototype.hasOwnProperty.call(payload, "code")) {
    return { present: true, value: payload.code };
  }
  // 部分接口（如 preApply/preAnnouncement/districtList）只回 data，不带 code。
  return { present: false, value: null };
}

// stage: "REGION" | "LIST"。requireBusinessCode=false 时 code 缺失不视为失败
// （对无 code 字段的接口），但出现 code 且非 0 仍必须失败。
function validateLandPublicityResponse({ stage, url, status, contentType, body, allowMissingBusinessCode = false }) {
  if (!STAGES.has(stage)) throw new Error(`LAND_STAGE_INVALID:${stage}`);
  const prefix = `LAND_${stage}`;

  if (!Number.isFinite(Number(status)) || Number(status) < 200 || Number(status) >= 300) {
    const statusText = Number(status) || 0;
    throw new LandPublicityHttpError(
      `${prefix}_HTTP_${statusText}`,
      `${prefix}_HTTP_${statusText}`,
      buildDiagnostics({ stage, url, status, contentType, body, error: `HTTP ${statusText}` }),
    );
  }

  const ct = String(contentType || "").toLowerCase();
  const kind = bodyKind(contentType, body);
  if (ct.includes("json")) {
    // 声明 JSON：继续走解析校验
  } else if (ct) {
    // 服务端明确声明非 JSON（如 text/html 反爬壳页）：必须拒绝。
    throw new LandPublicityHttpError(
      `${prefix}_RESPONSE_CONTENT_TYPE_INVALID`,
      `${prefix}_RESPONSE_CONTENT_TYPE_INVALID: HTTP 200 返回 ${ct}，疑似反爬 HTML 壳页`,
      buildDiagnostics({ stage, url, status, contentType, body, error: "content-type not json" }),
    );
  } else if (kind === "html") {
    // 未声明 Content-Type 但响应体是 HTML：同样拒绝。
    throw new LandPublicityHttpError(
      `${prefix}_RESPONSE_CONTENT_TYPE_INVALID`,
      `${prefix}_RESPONSE_CONTENT_TYPE_INVALID: 响应体为 HTML 壳页`,
      buildDiagnostics({ stage, url, status, contentType, body, error: "html body without json content-type" }),
    );
  }

  let payload;
  try {
    payload = JSON.parse(String(body || ""));
  } catch (error) {
    throw new LandPublicityHttpError(
      `${prefix}_RESPONSE_JSON_INVALID`,
      `${prefix}_RESPONSE_JSON_INVALID: ${error?.message || String(error)}`,
      buildDiagnostics({ stage, url, status, contentType, body, error: "json parse failed" }),
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LandPublicityHttpError(
      `${prefix}_RESPONSE_SCHEMA_INVALID`,
      `${prefix}_RESPONSE_SCHEMA_INVALID: 顶层不是对象（${Array.isArray(payload) ? "array" : typeof payload}）`,
      buildDiagnostics({ stage, url, status, contentType, body: "", businessCode: null, error: "top-level not object" }),
    );
  }

  const code = businessCodeOf(payload);
  if (code.present && Number(code.value) !== 0) {
    const message = String(payload.message || payload.msg || "").slice(0, 120);
    throw new LandPublicityHttpError(
      `${prefix}_BUSINESS_CODE_${code.value}`,
      `${prefix}_BUSINESS_CODE_${code.value}: ${message || "业务失败"}`,
      buildDiagnostics({ stage, url, status, contentType, body, businessCode: code.value, error: message }),
    );
  }
  if (!code.present && !allowMissingBusinessCode) {
    throw new LandPublicityHttpError(
      `${prefix}_RESPONSE_SCHEMA_INVALID`,
      `${prefix}_RESPONSE_SCHEMA_INVALID: 缺少业务 code 字段`,
      buildDiagnostics({ stage, url, status, contentType, body, error: "business code missing" }),
    );
  }
  if (payload.ok === false) {
    throw new LandPublicityHttpError(
      `${prefix}_BUSINESS_OK_FALSE`,
      `${prefix}_BUSINESS_OK_FALSE: ${String(payload.message || payload.msg || "").slice(0, 120)}`,
      buildDiagnostics({ stage, url, status, contentType, body, error: "ok=false" }),
    );
  }

  return { payload, diagnostics: buildDiagnostics({ stage, url, status, contentType, body, businessCode: code.present ? code.value : null }) };
}

// 行政区树校验：data 必须是非空数组，节点为 {districtCode, districtName, children?}。
function validateLandRegionCatalog(payload) {
  const data = payload?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new LandPublicityHttpError(
      "LAND_REGION_RESPONSE_SCHEMA_INVALID",
      "LAND_REGION_RESPONSE_SCHEMA_INVALID: data 不是非空数组",
      null,
    );
  }
  const validateNode = (node, path, depth) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new LandPublicityHttpError(
        "LAND_REGION_RESPONSE_SCHEMA_INVALID",
        `LAND_REGION_RESPONSE_SCHEMA_INVALID: ${path} 不是对象`,
        null,
      );
    }
    if (typeof node.districtCode !== "string" || !node.districtCode.trim()
      || typeof node.districtName !== "string" || !node.districtName.trim()) {
      throw new LandPublicityHttpError(
        "LAND_REGION_RESPONSE_SCHEMA_INVALID",
        `LAND_REGION_RESPONSE_SCHEMA_INVALID: ${path} 缺少 districtCode/districtName 字符串`,
        null,
      );
    }
    if (node.children !== undefined && node.children !== null) {
      if (!Array.isArray(node.children)) {
        throw new LandPublicityHttpError(
          "LAND_REGION_RESPONSE_SCHEMA_INVALID",
          `LAND_REGION_RESPONSE_SCHEMA_INVALID: ${path}.children 不是数组`,
          null,
        );
      }
      if (depth < 4) {
        for (const [index, child] of node.children.entries()) {
          validateNode(child, `${path}.children[${index}]`, depth + 1);
        }
      }
    }
  };
  for (const [index, node] of data.entries()) validateNode(node, `data[${index}]`, 0);
  return data;
}

function fetchLandPublicityJson(url, { stage, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const request = https.get(url, { headers: REQUEST_HEADERS }, (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = chunks.join("");
        try {
          resolve(validateLandPublicityResponse({
            stage,
            url,
            status: response.statusCode,
            contentType: response.headers["content-type"] || "",
            body,
            allowMissingBusinessCode: stage === "REGION",
          }));
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new LandPublicityHttpError(
        `LAND_${stage}_TIMEOUT`,
        `LAND_${stage}_TIMEOUT`,
        buildDiagnostics({ stage, url, status: null, contentType: "", body: "", error: "timeout" }),
      ));
    });
    request.on("error", (error) => {
      finish(reject, error instanceof LandPublicityHttpError
        ? error
        : new LandPublicityHttpError(
          `LAND_${stage}_SOURCE_UNAVAILABLE`,
          `LAND_${stage}_SOURCE_UNAVAILABLE: ${error?.message || String(error)}`,
          buildDiagnostics({ stage, url, status: null, contentType: "", body: "", error: error?.message || String(error) }),
        ));
    });
  });
}

module.exports = {
  REQUEST_HEADERS,
  LandPublicityHttpError,
  validateLandPublicityResponse,
  validateLandRegionCatalog,
  fetchLandPublicityJson,
  buildDiagnostics,
  sanitizeUrl,
  bodyKind,
};
