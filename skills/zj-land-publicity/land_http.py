"""浙江土地官网 HTTP 响应严格校验（与 native-helper/land-publicity-http.js 同规则）。

官网在反爬/维护窗口会对同一 JSON 接口返回 HTTP 200 + text/html（SPA 壳），
因此所有响应必须校验：HTTP 状态、Content-Type、JSON 可解析、顶层结构、
业务 code（存在且非 0 即失败）与字段类型。错误码稳定：
LAND_<STAGE>_HTTP_<n> / _RESPONSE_CONTENT_TYPE_INVALID / _RESPONSE_JSON_INVALID /
_RESPONSE_SCHEMA_INVALID / _BUSINESS_CODE_<code> / _SOURCE_UNAVAILABLE / _TIMEOUT。
诊断只含脱敏内容：URL（参数值白名单外替换为 REDACTED）、状态码、Content-Type、
业务 code、响应体类型与截断摘要；不包含任何凭据或个人数据。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, urlparse, parse_qsl

import json

import requests

STAGES = {"REGION", "LIST"}

SAFE_QUERY_KEYS = {
    "currentPage", "pageSize", "resourceStage", "type", "current", "size", "sort",
    "regionCode", "landUse", "tradeMethod", "tradeStage", "startDate", "endDate",
}

REQUEST_HEADERS: Dict[str, str] = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    # 官网 WAF 对非常规 UA 可能返回 HTML 壳页；统一浏览器 UA 并附 Referer。
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.zjzrzyjy.com/landView/land-bidding",
}


class LandSourceError(RuntimeError):
    """结构化数据源错误：errorCode 稳定可判别，diagnostics 仅含脱敏内容。"""

    def __init__(self, error_code: str, message: str = "", diagnostics: Optional[Dict[str, Any]] = None):
        super().__init__(message or error_code)
        self.errorCode = error_code
        self.diagnostics = diagnostics or {}


def sanitize_url(url: str) -> Dict[str, str]:
    parsed = urlparse(str(url or ""))
    kept: List[str] = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        kept.append(f"{key}={value if key in SAFE_QUERY_KEYS else 'REDACTED'}")
    query = f"?{'&'.join(kept)}" if kept else ""
    return {"url": f"{parsed.scheme}://{parsed.netloc}{parsed.path}{query}", "host": parsed.netloc}


def body_kind(content_type: str, body: str) -> str:
    ct = str(content_type or "").lower()
    if "json" in ct:
        return "json"
    text = str(body or "")
    if not text.strip():
        return "empty"
    low = text.lstrip()[:64].lower()
    if low.startswith("<!doctype") or low.startswith("<html"):
        return "html"
    return "text"


def build_diagnostics(
    stage: str,
    url: str,
    status: Optional[int] = None,
    content_type: str = "",
    body: str = "",
    business_code: Any = None,
    error: str = "",
) -> Dict[str, Any]:
    sanitized = sanitize_url(url)
    return {
        "stage": stage,
        "url": sanitized["url"],
        "host": sanitized["host"],
        "httpStatus": status,
        "contentType": str(content_type or ""),
        "businessCode": business_code,
        "bodyKind": body_kind(content_type, body),
        "bodyBytes": len(str(body or "").encode("utf-8")),
        "snippet": " ".join(str(body or "").split())[:200],
        "error": str(error or "")[:160],
    }


def _business_code_of(payload: Any) -> Tuple[bool, Any]:
    if not isinstance(payload, dict):
        return False, None
    if "code" in payload:
        return True, payload.get("code")
    # 部分接口（如 preApply/preAnnouncement/districtList）只回 data，不带 code。
    return False, None


def validate_response(
    stage: str,
    url: str,
    status: Optional[int],
    content_type: str,
    body: str,
    allow_missing_business_code: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """严格校验官网响应；失败抛 LandSourceError，成功返回 (payload, diagnostics)。"""
    if stage not in STAGES:
        raise ValueError(f"LAND_STAGE_INVALID:{stage}")
    prefix = f"LAND_{stage}"

    try:
        status_value = int(status)
    except (TypeError, ValueError):
        status_value = 0
    if status_value < 200 or status_value >= 300:
        raise LandSourceError(
            f"{prefix}_HTTP_{status_value}",
            f"{prefix}_HTTP_{status_value}",
            build_diagnostics(stage, url, status, content_type, body, error=f"HTTP {status_value}"),
        )

    ct = str(content_type or "").lower()
    kind = body_kind(content_type, body)
    if "json" in ct:
        pass  # 声明 JSON：继续走解析校验
    elif ct:
        # 服务端明确声明非 JSON（如 text/html 反爬壳页）：必须拒绝。
        raise LandSourceError(
            f"{prefix}_RESPONSE_CONTENT_TYPE_INVALID",
            f"{prefix}_RESPONSE_CONTENT_TYPE_INVALID: HTTP {status_value} 返回 {ct}，疑似反爬 HTML 壳页",
            build_diagnostics(stage, url, status, content_type, body, error="content-type not json"),
        )
    elif kind == "html":
        # 未声明 Content-Type 但响应体是 HTML：同样拒绝，不允许把壳页当数据。
        raise LandSourceError(
            f"{prefix}_RESPONSE_CONTENT_TYPE_INVALID",
            f"{prefix}_RESPONSE_CONTENT_TYPE_INVALID: 响应体为 HTML 壳页",
            build_diagnostics(stage, url, status, content_type, body, error="html body without json content-type"),
        )

    try:
        payload = json.loads(str(body or ""))
    except ValueError as error:
        raise LandSourceError(
            f"{prefix}_RESPONSE_JSON_INVALID",
            f"{prefix}_RESPONSE_JSON_INVALID: {error}",
            build_diagnostics(stage, url, status, content_type, body, error="json parse failed"),
        ) from error

    if not isinstance(payload, dict):
        raise LandSourceError(
            f"{prefix}_RESPONSE_SCHEMA_INVALID",
            f"{prefix}_RESPONSE_SCHEMA_INVALID: 顶层不是对象（{type(payload).__name__}）",
            build_diagnostics(stage, url, status, content_type, "", error="top-level not object"),
        )

    present, code = _business_code_of(payload)
    if present and code != 0:
        message = str(payload.get("message") or payload.get("msg") or "")[:120]
        raise LandSourceError(
            f"{prefix}_BUSINESS_CODE_{code}",
            f"{prefix}_BUSINESS_CODE_{code}: {message or '业务失败'}",
            build_diagnostics(stage, url, status, content_type, body, business_code=code, error=message),
        )
    if not present and not allow_missing_business_code:
        raise LandSourceError(
            f"{prefix}_RESPONSE_SCHEMA_INVALID",
            f"{prefix}_RESPONSE_SCHEMA_INVALID: 缺少业务 code 字段",
            build_diagnostics(stage, url, status, content_type, body, error="business code missing"),
        )

    diagnostics = build_diagnostics(
        stage, url, status, content_type, body,
        business_code=code if present else None,
    )
    return payload, diagnostics


def fetch_json(
    url: str,
    stage: str,
    *,
    timeout: float = 30.0,
    allow_missing_business_code: bool = False,
    session: Optional[requests.Session] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """GET 官网 JSON 接口并严格校验；网络/超时异常归一为 _SOURCE_UNAVAILABLE/_TIMEOUT。"""
    try:
        response = (session or requests).get(
            url,
            headers=REQUEST_HEADERS,
            timeout=timeout,
        )
    except requests.exceptions.Timeout as error:
        raise LandSourceError(
            f"LAND_{stage}_TIMEOUT",
            f"LAND_{stage}_TIMEOUT",
            build_diagnostics(stage, url, None, "", "", error=str(error)),
        ) from error
    except requests.exceptions.RequestException as error:
        raise LandSourceError(
            f"LAND_{stage}_SOURCE_UNAVAILABLE",
            f"LAND_{stage}_SOURCE_UNAVAILABLE: {error}",
            build_diagnostics(stage, url, None, "", "", error=str(error)),
        ) from error

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as error:
        headers = getattr(response, "headers", None)
        content_type = ""
        if headers is not None:
            try:
                content_type = headers.get("Content-Type", "")
            except AttributeError:
                content_type = str(headers)
        raise LandSourceError(
            f"LAND_{stage}_HTTP_{getattr(response, 'status_code', 0)}",
            f"LAND_{stage}_HTTP_{getattr(response, 'status_code', 0)}",
            build_diagnostics(stage, url, getattr(response, "status_code", None), content_type, "", error=str(error)),
        ) from error

    # 兼容测试替身/非标准响应对象：状态码缺失视为 200（raise_for_status 已把
    # 真实 HTTP 错误挡在前面）；优先 text，缺失时从 json() 序列化。
    status_code = getattr(response, "status_code", None)
    if status_code is None:
        status_code = 200
    body = getattr(response, "text", None)
    if body is None:
        try:
            body = json.dumps(response.json(), ensure_ascii=False)
        except Exception:
            body = ""
    body = body or ""

    headers = getattr(response, "headers", None)
    content_type = ""
    if headers is not None:
        try:
            content_type = headers.get("Content-Type", "")
        except AttributeError:
            content_type = str(headers)
    return validate_response(
        stage,
        url,
        status_code,
        content_type,
        body,
        allow_missing_business_code=allow_missing_business_code,
    )


def validate_region_catalog(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """行政区树校验：data 为非空对象数组，节点含 districtCode/districtName 字符串。"""
    data = (payload or {}).get("data")
    if not isinstance(data, list) or not data:
        raise LandSourceError(
            "LAND_REGION_RESPONSE_SCHEMA_INVALID",
            "LAND_REGION_RESPONSE_SCHEMA_INVALID: data 不是非空数组",
        )

    def _node(node: Any, path: str, depth: int) -> None:
        if not isinstance(node, dict):
            raise LandSourceError(
                "LAND_REGION_RESPONSE_SCHEMA_INVALID",
                f"LAND_REGION_RESPONSE_SCHEMA_INVALID: {path} 不是对象",
            )
        code = node.get("districtCode")
        name = node.get("districtName")
        if not isinstance(code, str) or not code.strip() or not isinstance(name, str) or not name.strip():
            raise LandSourceError(
                "LAND_REGION_RESPONSE_SCHEMA_INVALID",
                f"LAND_REGION_RESPONSE_SCHEMA_INVALID: {path} 缺少 districtCode/districtName 字符串",
            )
        children = node.get("children")
        if children not in (None,) and not isinstance(children, list):
            raise LandSourceError(
                "LAND_REGION_RESPONSE_SCHEMA_INVALID",
                f"LAND_REGION_RESPONSE_SCHEMA_INVALID: {path}.children 不是数组",
            )
        if isinstance(children, list) and depth < 4:
            for index, child in enumerate(children):
                _node(child, f"{path}.children[{index}]", depth + 1)

    for index, node in enumerate(data):
        _node(node, f"data[{index}]", 0)
    return data


def validate_list_payload(payload: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
    """成交列表校验：data 为对象且 records 为对象数组、total 为非负整数。"""
    data = (payload or {}).get("data")
    if not isinstance(data, dict):
        raise LandSourceError(
            "LAND_LIST_RESPONSE_SCHEMA_INVALID",
            f"LAND_LIST_RESPONSE_SCHEMA_INVALID: data 不是对象（{type(data).__name__}）",
        )
    records = data.get("records")
    if not isinstance(records, list):
        raise LandSourceError(
            "LAND_LIST_RESPONSE_SCHEMA_INVALID",
            f"LAND_LIST_RESPONSE_SCHEMA_INVALID: records 不是数组（{type(records).__name__}）",
        )
    for index, record in enumerate(records):
        if record is not None and not isinstance(record, dict):
            raise LandSourceError(
                "LAND_LIST_RESPONSE_SCHEMA_INVALID",
                f"LAND_LIST_RESPONSE_SCHEMA_INVALID: records[{index}] 不是对象",
            )
    total_raw = data.get("total")
    try:
        total = int(total_raw)
    except (TypeError, ValueError) as error:
        raise LandSourceError(
            "LAND_LIST_RESPONSE_SCHEMA_INVALID",
            f"LAND_LIST_RESPONSE_SCHEMA_INVALID: total 不是整数（{total_raw!r}）",
        ) from error
    if total < 0:
        raise LandSourceError(
            "LAND_LIST_RESPONSE_SCHEMA_INVALID",
            f"LAND_LIST_RESPONSE_SCHEMA_INVALID: total 为负数（{total}）",
        )
    return records, total
