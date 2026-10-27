#!/usr/bin/env python3
"""受控运行器：复用浙江土地成交公示 Skill，并生成 Excel/独立结果页。

核心列表抓取和 HTML 详情解析继续来自 scrape_zj_land.py。本文件只负责
参数契约、列表候选过滤、详情复核、结果页和安全的原子输出，避免把业务逻辑塞进 Native Host。
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

# The portable Windows interpreter runs in isolated mode (python314._pth), so
# Python does not automatically add this script's directory to sys.path.
SCRIPT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPT_DIRECTORY)

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from land_http import LandSourceError
from scrape_zj_land import (
    build_map_assets,
    calc_total_price_wan,
    clean_text,
    extract_number,
    fetch_land_bidding_records as skill_fetch_land_bidding_records,
    fetch_resource_detail,
    normalize_resource_coordinate,
    parse_content_fields,
)


TRADE_FORMS = ("国有土地", "国有土地（组合）")
TRADE_METHODS = ("挂牌出让", "挂牌租赁", "拍卖出让", "拍卖租赁")
TRADE_STAGES = ("结果公示",)
LAND_USES = ("住宅用地", "商服用地", "工矿仓储", "其他用地")
TRADE_METHOD_CODES = {
    "挂牌出让": ("GP",),
    "拍卖出让": ("PM",),
    "挂牌租赁": ("GPZL",),
    "拍卖租赁": ("PMZL",),
}
TRADE_METHOD_QUERY_CODES = {
    "挂牌出让": {"tradeMode": 1, "transactionType": "CR"},
    "挂牌租赁": {"tradeMode": 1, "transactionType": "ZL"},
    "拍卖出让": {"tradeMode": 2, "transactionType": "CR"},
    "拍卖租赁": {"tradeMode": 2, "transactionType": "ZL"},
}
LAND_USE_QUERY_CODES = {
    "住宅用地": 1,
    "商服用地": 2,
    "工矿仓储": 3,
    "其他用地": 4,
}
QUOTE_PRESETS = ("all", "today", "future_3_days", "future_7_days", "future_30_days", "custom")
DISPLAY_NUMBER_COLUMNS = frozenset({
    "土地面积(亩)", "土地面积(平方米)",
    "成交单价(元/平方米)", "成交总价(万元)",
    "坐标中心经度", "坐标中心纬度", "X坐标起点", "Y坐标起点",
    "边界点组数", "边界点总数",
})
EXCEL_NUMBER_FORMAT = "#,##0.##"
DISTRICTS = ("杭州市", "宁波市", "温州市", "湖州市", "嘉兴市", "绍兴市", "金华市", "衢州市", "舟山市", "台州市", "丽水市")
CITY_CODE_PREFIXES = {
    "杭州": "3301",
    "宁波": "3302",
    "温州": "3303",
    "嘉兴": "3304",
    "湖州": "3305",
    "绍兴": "3306",
    "金华": "3307",
    "衢州": "3308",
    "舟山": "3309",
    "台州": "3310",
    "丽水": "3311",
}


def emit_progress(phase: str, percent: int, message: str, **counts: Any) -> None:
    payload = {
        "phase": str(phase),
        "percent": max(0, min(100, int(percent))),
        "message": str(message),
        **counts,
    }
    print("TY_LAND_PROGRESS:" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def emit_result(payload: Dict[str, Any]) -> None:
    print("TY_LAND_RESULT:" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def _text(value: Any, limit: int = 300) -> str:
    return clean_text(str(value or ""))[:limit]


def _number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?", str(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _format_number_display(value: Any) -> str:
    """为结果页显示数字添加千位分隔符，同时去掉无意义的尾随零。"""
    if value is None or value == "":
        return ""
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return str(value)
    return format(parsed, ",f").rstrip("0").rstrip(".") or "0"


def _display_cell_value(column: str, value: Any) -> str:
    if column in DISPLAY_NUMBER_COLUMNS:
        return _format_number_display(value)
    return "" if value is None else str(value)


def _date(value: Any) -> Optional[dt.date]:
    text = _text(value, 80)
    if not text:
        return None
    text = text.replace("年", "-").replace("月", "-").replace("日", "")
    text = text.replace("/", "-").replace(".", "-")
    match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if not match:
        return None
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _date_text(value: Any) -> str:
    parsed = _date(value)
    return parsed.isoformat() if parsed else _text(value, 80)


def _record_filter_date(record: Dict[str, Any]) -> Optional[dt.date]:
    """Use the same date field as the source endpoint uses for filtering."""
    value = record.get("_queryDate") if record.get("_sourceEndpoint") == "landbidding" else record.get("releaseTime")
    return _date(value)


def _normalise_district_name(value: Any) -> str:
    return re.sub(r"\s+", "", _text(value, 100)).casefold()


def _city_code_for_district(value: Any) -> str:
    name = _normalise_district_name(value)
    if name.endswith("市"):
        name = name[:-1]
    return CITY_CODE_PREFIXES.get(name, "")


def _district_code_prefix(value: Any) -> str:
    digits = re.sub(r"\D", "", _text(value, 40))
    return digits[:4] if len(digits) >= 4 else ""


def _district_matches(request: Dict[str, Any], record: Dict[str, Any]) -> bool:
    if request.get("provinceWide"):
        return True
    district_name = _normalise_district_name(record.get("districtName"))
    if request.get("district"):
        requested = _normalise_district_name(request["district"])
        city_code = _city_code_for_district(request["district"])
        if city_code:
            actual_code = _district_code_prefix(record.get("districtCode"))
            if actual_code:
                if actual_code != city_code:
                    return False
            else:
                # Older captures may omit districtCode. Keep the name fallback
                # for those records, while a present code remains authoritative.
                requested_city = requested[:-1] if requested.endswith("市") else requested
                actual_city = district_name[:-1] if district_name.endswith("市") else district_name
                if requested_city != actual_city:
                    # 旧工作簿的行政区列通常只存区县名（无 districtCode）。
                    # 请求的区县与该记录行政区完全一致时，视为市级条件已满足，
                    # 交由下方区县检查最终裁决；其余仍按城市名不匹配排除。
                    county_requested = _normalise_district_name(request.get("county"))
                    if not (county_requested and county_requested == district_name):
                        return False
        elif request.get("districtExact"):
            if requested != district_name:
                return False
        elif requested not in district_name:
            return False
    if request.get("county"):
        requested_county = _normalise_district_name(request["county"])
        if request.get("districtExact"):
            return requested_county == district_name
        return requested_county in district_name
    return True


def _list_district_filter(request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """减少详情请求：列表接口先按已知行政区代码/名称预筛选。"""
    if request.get("provinceWide"):
        return None
    county = _text(request.get("county"), 100)
    location = _text(request.get("location"), 160)
    # 区县/市级位置关键词本身就是明确的行政区条件。
    if county:
        return {"name": county, "exact": bool(request.get("districtExact"))}
    if re.search(r"(市|区|县)$", location):
        return {"name": location, "exact": bool(request.get("districtExact"))}
    district = _text(request.get("district"), 100)
    if district:
        city_code = _city_code_for_district(district)
        if city_code:
            return {"code": city_code, "exact": False}
        return {"name": district, "exact": bool(request.get("districtExact"))}
    return None


def _list_record_matches_request(request: Dict[str, Any], record: Dict[str, Any]) -> bool:
    """在列表记录阶段安全收窄候选，缺失字段一律留给详情阶段复核。"""
    release_date = _record_filter_date(record)
    start_boundary = _date(request.get("startDate"))
    if start_boundary is None and request.get("startYear"):
        start_boundary = dt.date(int(request["startYear"]), 1, 1)
    end_boundary = _date(request.get("endDate"))
    if release_date and start_boundary and release_date < start_boundary:
        return False
    if release_date and end_boundary and release_date > end_boundary:
        return False

    content_fields = parse_content_fields(record.get("content", ""))
    if request.get("landUses") and not _land_use_matches_request(request, record, content_fields, allow_unknown=True):
        return False

    if request.get("tradeMethods"):
        values = _field_values(record, {}, ("tradeType", "tradeMethod", "tradeWay", "dealType", "交易方式"))
        if values and not _contains_any(values, request["tradeMethods"]):
            return False

    if request.get("tradeForm"):
        values = _field_values(record, {}, ("tradeForm", "transactionForm", "交易形式"))
        if values and not _contains_any(values, (request["tradeForm"],)):
            return False

    if request.get("county"):
        record_district = _text(record.get("districtName"), 100)
        requested_county = _normalise_district_name(request["county"])
        actual_county = _normalise_district_name(record_district)
        if request.get("districtExact"):
            if requested_county != actual_county:
                return False
        elif requested_county not in actual_county:
            return False

    raw_location = _text(request.get("location"), 160)
    location_value = "" if request.get("provinceWide") and re.fullmatch(r".+(?:市|区|县)", raw_location) else raw_location
    location_keyword = location_value.lower()
    if location_keyword:
        record_district = _text(record.get("districtName"), 100)
        if re.fullmatch(r".+(?:市|区|县)", location_value) and record_district:
            requested_region = _normalise_district_name(location_value)
            actual_region = _normalise_district_name(record_district)
            if request.get("districtExact"):
                if requested_region != actual_region:
                    return False
            elif requested_region not in actual_region:
                return False
        list_location = _text(content_fields.get("地块位置"), 300)
        if list_location and location_keyword not in f"{record_district} {list_location}".lower():
            return False
    return True


def _list_stop_before(request: Dict[str, Any]) -> str:
    start_boundary = _date(request.get("startDate"))
    if start_boundary is None and request.get("startYear"):
        start_boundary = dt.date(int(request["startYear"]), 1, 1)
    return start_boundary.isoformat() if start_boundary else ""


def _date_epoch_ms(value: Any, end_of_day: bool = False) -> Optional[int]:
    parsed = _date(value)
    if parsed is None:
        return None
    boundary = dt.time.max if end_of_day else dt.time.min
    moment = dt.datetime.combine(parsed, boundary, tzinfo=dt.timezone(dt.timedelta(hours=8)))
    return int(moment.timestamp() * 1000)


def _list_server_filters(request: Dict[str, Any]) -> Dict[str, Any]:
    """生成 land-bidding 列表 API 已验证支持的查询参数。"""
    filters: Dict[str, Any] = {}
    if request.get("provinceWide"):
        return filters
    region_name = _text(request.get("district"), 100)
    county = _text(request.get("county"), 100)
    location = _text(request.get("location"), 160)
    if county:
        filters["regionName"] = county
        if region_name and region_name != county:
            filters["fallbackRegionName"] = region_name
    elif re.fullmatch(r".+(?:市|区|县)", location):
        filters["regionName"] = location
        if region_name and region_name != location:
            filters["fallbackRegionName"] = region_name
    elif not request.get("provinceWide") and region_name:
        filters["regionName"] = region_name
    start_ms = _date_epoch_ms(request.get("startDate"))
    end_ms = _date_epoch_ms(request.get("endDate"), end_of_day=True)
    if start_ms is not None:
        filters["enrollStartTime"] = start_ms
    elif request.get("startYear"):
        filters["enrollStartTime"] = _date_epoch_ms(f"{request['startYear']}-01-01")
    if end_ms is not None:
        filters["nowTime"] = end_ms
    return filters


def _website_server_filters(request: Dict[str, Any]) -> Dict[str, Any]:
    """生成与 land-bidding 页面一致的列表接口参数。"""
    filters = _list_server_filters(request)
    methods = request.get("tradeMethods") or []
    if len(methods) == 1 and methods[0] in TRADE_METHOD_QUERY_CODES:
        filters.update(TRADE_METHOD_QUERY_CODES[methods[0]])

    # 官网 land-bidding 页面一次只提交一个 landUse 编码；多选时保留
    # 本地复核，避免把多个选择错误压缩成一个服务端条件。
    land_uses = request.get("landUses") or []
    if len(land_uses) == 1 and land_uses[0] in LAND_USE_QUERY_CODES:
        filters["landUse"] = LAND_USE_QUERY_CODES[land_uses[0]]

    filters["sortField"] = "ZYKSSJ"
    filters["sortWay"] = "desc"
    return filters


def _list(value: Any, allowed: Iterable[str], field: str) -> List[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field}_MUST_BE_ARRAY")
    values = [_text(item, 40) for item in value]
    if len(values) > len(tuple(allowed)):
        raise ValueError(f"{field}_TOO_MANY")
    allowed_set = set(allowed)
    if any(item not in allowed_set for item in values):
        raise ValueError(f"{field}_INVALID")
    return list(dict.fromkeys(values))


def validate_request(request: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("LAND_REQUEST_INVALID")
    for boolean_field in ("districtExact", "generateMap", "provinceWide", "historyRefresh"):
        if boolean_field in request and not isinstance(request[boolean_field], bool):
            raise ValueError(f"{boolean_field.upper()}_MUST_BE_BOOLEAN")
    output_directory = _text(request.get("outputDirectory"), 2000)
    if not output_directory or "\x00" in output_directory or not os.path.isabs(output_directory):
        raise ValueError("LAND_OUTPUT_DIRECTORY_INVALID")
    output_directory = os.path.realpath(output_directory)
    if not os.path.isdir(output_directory):
        raise ValueError("LAND_OUTPUT_DIRECTORY_NOT_DIRECTORY")
    history_path = _text(request.get("historyPath"), 2000)
    if history_path:
        if "\x00" in history_path or not os.path.isabs(history_path):
            raise ValueError("LAND_HISTORY_PATH_INVALID")
        history_path = os.path.realpath(history_path)
        if not os.path.isfile(history_path) or Path(history_path).suffix.lower() not in (".json", ".xlsx"):
            raise ValueError("LAND_HISTORY_PATH_NOT_FOUND")

    start_year = request.get("startYear", "")
    if start_year not in (None, ""):
        start_year = _text(start_year, 4)
        if not re.fullmatch(r"(?:19|20)\d{2}", start_year):
            raise ValueError("LAND_START_YEAR_INVALID")
    else:
        start_year = ""
    start_date = _text(request.get("startDate"), 20)
    if start_date and (_date(start_date) is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date)):
        raise ValueError("LAND_START_DATE_INVALID")
    end_date = _text(request.get("endDate"), 20)
    if end_date and (_date(end_date) is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date)):
        raise ValueError("LAND_END_DATE_INVALID")
    if start_date and end_date and _date(start_date) > _date(end_date):
        raise ValueError("LAND_DATE_RANGE_INVALID")
    trade_form = _text(request.get("tradeForm"), 40)
    if trade_form and trade_form not in TRADE_FORMS:
        raise ValueError("LAND_TRADE_FORM_INVALID")
    quote_preset = _text(request.get("quotePreset") or "all", 30)
    if quote_preset not in QUOTE_PRESETS:
        raise ValueError("LAND_QUOTE_PRESET_INVALID")
    quote_start = _text(request.get("quoteStartDate"), 20)
    quote_end = _text(request.get("quoteEndDate"), 20)
    for label, value in (("LAND_QUOTE_START_DATE_INVALID", quote_start), ("LAND_QUOTE_END_DATE_INVALID", quote_end)):
        if value and (_date(value) is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)):
            raise ValueError(label)
    if quote_preset == "custom" and not quote_start and not quote_end:
        raise ValueError("LAND_QUOTE_CUSTOM_RANGE_REQUIRED")
    if quote_start and quote_end and _date(quote_start) > _date(quote_end):
        raise ValueError("LAND_QUOTE_RANGE_INVALID")

    area_unit = _text(request.get("areaUnit") or "sqm", 8)
    if area_unit not in ("sqm", "mu"):
        raise ValueError("LAND_AREA_UNIT_INVALID")

    def range_value(key: str) -> Optional[float]:
        value = request.get(key, "")
        if value in (None, ""):
            return None
        number = _number(value)
        if number is None or number < 0:
            raise ValueError(f"{key.upper()}_INVALID")
        if number > 10**12:
            raise ValueError(f"{key.upper()}_TOO_LARGE")
        return number

    price_min = range_value("startPriceMin")
    price_max = range_value("startPriceMax")
    area_min = range_value("areaMin")
    area_max = range_value("areaMax")
    if price_min is not None and price_max is not None and price_min > price_max:
        raise ValueError("LAND_START_PRICE_RANGE_INVALID")
    if area_min is not None and area_max is not None and area_min > area_max:
        raise ValueError("LAND_AREA_RANGE_INVALID")

    max_pages = request.get("maxPages", 200)
    try:
        max_pages = int(max_pages)
    except (TypeError, ValueError):
        raise ValueError("LAND_MAX_PAGES_INVALID")
    if isinstance(request.get("maxPages"), bool) or max_pages < 1 or max_pages > 200:
        raise ValueError("LAND_MAX_PAGES_INVALID")

    district = _text(request.get("district"), 100)
    county = _text(request.get("county"), 100)
    location = _text(request.get("location"), 160)
    province_wide = bool(request.get("provinceWide", False))
    if province_wide:
        district = ""
        if re.fullmatch(r".+(?:市|区|县)", location):
            location = ""
        district_exact = False
    else:
        district_exact = bool(request.get("districtExact", False))
    if not province_wide and not district and not county and not location:
        raise ValueError("LAND_DISTRICT_OR_LOCATION_REQUIRED")
    if district and len(district) > 100:
        raise ValueError("LAND_DISTRICT_TOO_LONG")
    if county and len(county) > 100:
        raise ValueError("LAND_COUNTY_TOO_LONG")
    return {
        "tradeForm": trade_form,
        "tradeMethods": _list(request.get("tradeMethods"), TRADE_METHODS, "tradeMethods"),
        "tradeStages": _list(request.get("tradeStages"), TRADE_STAGES, "tradeStages"),
        "district": district,
        "county": county,
        "location": location,
        "landUses": _list(request.get("landUses"), LAND_USES, "landUses"),
        "startDate": start_date,
        "endDate": end_date,
        "startYear": start_year,
        "quotePreset": quote_preset,
        "quoteStartDate": quote_start,
        "quoteEndDate": quote_end,
        "startPriceMin": price_min,
        "startPriceMax": price_max,
        "areaMin": area_min,
        "areaMax": area_max,
        "areaUnit": area_unit,
        "districtExact": district_exact,
        "provinceWide": province_wide,
        "generateMap": bool(request.get("generateMap", False)),
        "maxPages": max_pages,
        "outputDirectory": output_directory,
        "historyPath": history_path,
        "historyRefresh": bool(request.get("historyRefresh", True)),
    }


def _query_signature(request: Dict[str, Any]) -> str:
    """为同一组有效筛选条件生成稳定指纹，不把输出目录纳入范围。"""
    query_fields = {
        key: request.get(key)
        for key in (
            "tradeForm", "tradeMethods", "tradeStages", "district", "county", "provinceWide", "location",
            "landUses", "startDate", "endDate", "startYear", "quotePreset", "quoteStartDate",
            "quoteEndDate", "startPriceMin", "startPriceMax", "areaMin", "areaMax", "areaUnit",
            "districtExact", "maxPages",
        )
    }
    for key in ("tradeMethods", "tradeStages", "landUses"):
        query_fields[key] = sorted(query_fields.get(key) or [])
    canonical = json.dumps(query_fields, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:10]


def _safe_filename_fragment(value: str, fallback: str) -> str:
    fragment = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value, flags=re.UNICODE).strip("-_.")
    return fragment[:48] or fallback


def _result_stem(request: Dict[str, Any]) -> str:
    """生成可读且稳定的结果文件名；指纹保证相近条件不会互相覆盖。"""
    scope = "全省" if request.get("provinceWide") else (request.get("county") or request.get("district") or request.get("location") or "指定范围")
    uses = "、".join(sorted(request.get("landUses") or [])) or "全部用途"
    if request.get("startDate") or request.get("endDate"):
        date_scope = f"{request.get('startDate') or '不限'}至{request.get('endDate') or '不限'}"
    elif request.get("startYear"):
        date_scope = f"{request['startYear']}年以来"
    else:
        date_scope = "不限日期"
    label = "_".join(
        _safe_filename_fragment(value, fallback)
        for value, fallback in ((scope, "范围"), (uses, "用途"), (date_scope, "日期"))
    )
    return f"浙江土地成交公示_{label}_{_query_signature(request)}"


def _field_values(record: Dict[str, Any], detail: Dict[str, Any], names: Iterable[str]) -> List[str]:
    values: List[str] = []
    for name in names:
        for source in (record, detail):
            value = source.get(name) if isinstance(source, dict) else None
            text = _text(value)
            if text and text not in values:
                values.append(text)
    return values


def _contains_any(values: Iterable[str], choices: Iterable[str]) -> bool:
    normalised_values = [str(value).strip().lower() for value in values if str(value).strip()]
    haystack = " ".join(normalised_values)
    aliases = {
        "挂牌出让": ("挂牌出让", "挂牌"),
        "拍卖出让": ("拍卖出让", "拍卖"),
        "挂牌租赁": ("挂牌租赁",),
        "拍卖租赁": ("拍卖租赁",),
        "工矿仓储": ("工矿仓储", "工业用地", "仓储用地", "工业"),
        "商服用地": ("商服用地", "商服", "商业", "商业服务", "商务金融", "金融用地"),
        "住宅用地": ("住宅用地", "住宅", "居住"),
        "其他用地": ("其他用地", "其他"),
        "结果公示": ("结果公示", "成交公示", "成交"),
    }
    for choice in choices:
        if any(code.lower() == value for code in TRADE_METHOD_CODES.get(choice, ()) for value in normalised_values):
            return True
        if any(alias.lower() in haystack for alias in aliases.get(choice, (choice,))):
            return True
    return False


def _land_use_code_category(code: Any) -> Optional[str]:
    value = re.sub(r"\s+", "", str(code or "").upper())
    if not value:
        return None
    modern = value.startswith("V3-")
    family = value[3:] if modern else value
    if family.startswith("07"):
        return "住宅用地"
    if (modern and family.startswith("09")) or (not modern and family.startswith("05")):
        return "商服用地"
    if (modern and family.startswith(("10", "11"))) or (not modern and family.startswith("06")):
        return "工矿仓储"
    if (modern and family.startswith(("08", "12", "13", "14", "15"))) or (not modern and family.startswith(("08", "09", "10", "12", "15"))):
        return "其他用地"
    return None


def _land_use_categories(record: Dict[str, Any], detail: Dict[str, Any]) -> set[str]:
    coded_categories: set[str] = set()
    names: List[str] = []
    plan_use = record.get("planUse") if isinstance(record, dict) else None
    if isinstance(plan_use, str):
        try:
            plan_use = json.loads(plan_use)
        except (TypeError, json.JSONDecodeError):
            plan_use = []
    for item in plan_use if isinstance(plan_use, list) else []:
        if isinstance(item, dict):
            name = _text(item.get("NAME_") or item.get("name"), 100)
            if name:
                names.append(name)
            for code in (item.get("PARENTKEY_"), item.get("KEY_"), item.get("parentKey"), item.get("key")):
                category = _land_use_code_category(code)
                if category:
                    coded_categories.add(category)
        elif item:
            names.append(_text(item, 100))
    for source in (record, detail):
        if not isinstance(source, dict):
            continue
        for name in (source.get("landUse"), source.get("assignmentPurpose"), source.get("use"), source.get("用途"), source.get("土地用途")):
            text = _text(name, 200)
            if text:
                names.append(text)
    if coded_categories:
        return coded_categories
    categories: set[str] = set()
    for name in names:
        if any(term in name for term in ("住宅", "住房", "商品房", "居住")):
            categories.add("住宅用地")
        elif any(term in name for term in ("商服", "商业", "商务金融", "零售商业", "批发市场", "餐饮", "旅馆", "服务业")):
            categories.add("商服用地")
        elif any(term in name for term in ("工业", "工矿", "仓储", "物流仓储")):
            categories.add("工矿仓储")
        elif any(term in name for term in ("其他用地", "公共管理与公共服务", "教育用地", "文化设施", "体育场馆", "医疗卫生", "机关团体", "公用设施", "公园与绿地", "风景名胜", "港口码头", "殡葬", "社会停车场", "福利用地")):
            categories.add("其他用地")
    return categories


def _land_use_matches_request(
    request: Dict[str, Any], record: Dict[str, Any], detail: Dict[str, Any], allow_unknown: bool,
) -> bool:
    choices = request.get("landUses") or []
    if not choices:
        return True
    if record.get("_sourceEndpoint") == "landbidding" and len(choices) == 1:
        # The official list API's landUse=1..4 filter is authoritative for a single selection.
        return True
    categories = _land_use_categories(record, detail)
    if categories:
        return bool(categories.intersection(choices))
    values = _field_values(record, detail, ("landUse", "use", "assignmentPurpose", "用途", "土地用途"))
    if values:
        return _contains_any(values, choices)
    return allow_unknown


def _quote_window(request: Dict[str, Any], today: Optional[dt.date] = None) -> Tuple[Optional[dt.date], Optional[dt.date]]:
    today = today or dt.date.today()
    preset = request["quotePreset"]
    if preset == "all":
        return None, None
    if preset == "today":
        return today, today
    if preset == "future_3_days":
        return today, today + dt.timedelta(days=3)
    if preset == "future_7_days":
        return today, today + dt.timedelta(days=7)
    if preset == "future_30_days":
        return today, today + dt.timedelta(days=30)
    return _date(request.get("quoteStartDate")), _date(request.get("quoteEndDate"))


def filter_records(
    enriched: List[Dict[str, Any]],
    request: Dict[str, Any],
    today: Optional[dt.date] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    warnings: List[str] = []
    unsupported: List[str] = []
    counts: Dict[str, int] = {"unknownStartPrice": 0, "unknownArea": 0, "unknownQuoteStart": 0}
    if request.get("tradeForm"):
        unsupported.append("交易形式：目标列表/详情 API 未提供稳定字段，仅在返回字段存在时作候选复核。")

    quote_start, quote_end = _quote_window(request, today=today)
    output: List[Dict[str, Any]] = []
    start_boundary = _date(request.get("startDate"))
    if start_boundary is None and request.get("startYear"):
        start_boundary = dt.date(int(request["startYear"]), 1, 1)
    end_boundary = _date(request.get("endDate"))

    for item in enriched:
        record = item["record"]
        detail = item["detail"]
        release_date = _record_filter_date(record)
        if start_boundary and (release_date is None or release_date < start_boundary):
            continue
        if end_boundary and (release_date is None or release_date > end_boundary):
            continue

        district = _text(record.get("districtName"))
        location = _text(item.get("location") or detail.get("地块位置"))
        if request["district"] and not request.get("provinceWide") and not _district_matches(request, record):
            continue
        if request["location"] and request["location"].lower() not in f"{district} {location}".lower():
            continue

        if request["landUses"] and not _land_use_matches_request(request, record, detail, allow_unknown=False):
            continue

        if request["tradeMethods"]:
            values = _field_values(record, detail, ("tradeType", "tradeMethod", "tradeWay", "dealType", "交易方式"))
            if not values:
                continue
            if not _contains_any(values, request["tradeMethods"]):
                continue

        # This runner uses the Skill's type=3成交公示 endpoint. The source
        # itself is authoritative for the result-publicity stage even when an
        # individual record omits a tradeStage field.
        if request["tradeStages"] and request["tradeStages"] != ["结果公示"]:
            continue

        if request["tradeForm"]:
            values = _field_values(record, detail, ("tradeForm", "transactionForm", "交易形式"))
            if values and not _contains_any(values, (request["tradeForm"],)):
                continue

        if quote_start or quote_end:
            values = _field_values(record, detail, ("quoteStartTime", "quoteStartDate", "quoteBeginTime", "offerStartTime", "startTime", "报价开始时间"))
            quote_date = _date(values[0]) if values else None
            if quote_date is None:
                counts["unknownQuoteStart"] += 1
                continue
            if quote_start and quote_date < quote_start:
                continue
            if quote_end and quote_date > quote_end:
                continue

        start_price = item.get("start_price")
        if request["startPriceMin"] is not None or request["startPriceMax"] is not None:
            if start_price is None:
                counts["unknownStartPrice"] += 1
                continue
            if request["startPriceMin"] is not None and start_price < request["startPriceMin"]:
                continue
            if request["startPriceMax"] is not None and start_price > request["startPriceMax"]:
                continue

        area = item.get("area_sqm") if request["areaUnit"] == "sqm" else item.get("area_mu")
        if request["areaMin"] is not None or request["areaMax"] is not None:
            if area is None:
                counts["unknownArea"] += 1
                continue
            if request["areaMin"] is not None and area < request["areaMin"]:
                continue
            if request["areaMax"] is not None and area > request["areaMax"]:
                continue

        output.append(item)

    if counts["unknownStartPrice"]:
        warnings.append(f"{counts['unknownStartPrice']} 条记录缺少起始价，已从起始价区间筛选中排除。")
    if counts["unknownArea"]:
        warnings.append(f"{counts['unknownArea']} 条记录缺少出让面积，已从面积区间筛选中排除。")
    if counts["unknownQuoteStart"]:
        warnings.append(f"{counts['unknownQuoteStart']} 条记录缺少报价开始时间，已从报价时间筛选中排除。")
    if request["landUses"] and len(request["landUses"]) > 1:
        unsupported.append("官网用途接口一次只接受一个分类码；多选由本地按官网用途编码复核。")
    if request["tradeMethods"] or request["tradeStages"]:
        unsupported.append("交易方式或阶段等条件未全部由列表接口支持，系统在候选列表和详情阶段复核。")
    return output, {
        "warnings": warnings,
        "unsupportedFilters": unsupported,
        "unknown": counts,
        "filtered": len(output),
    }


def _unit_price_from_total(total_wan: Optional[float], area_sqm: Optional[float]) -> Optional[float]:
    if total_wan is None or area_sqm in (None, 0):
        return None
    return round(total_wan * 10000 / area_sqm, 2)


def _land_bidding_term(record: Dict[str, Any], detail_data: Dict[str, Any]) -> str:
    value = detail_data.get("transferPeriodTo") or record.get("transferPeriodTo")
    if value not in (None, ""):
        text = _text(value, 40)
        return text if "年" in text else f"{text}年"
    assignment_period = _text(detail_data.get("assignmentPeriod"), 100)
    match = re.search(r"(\d+(?:\.\d+)?)\s*年", assignment_period)
    return f"{match.group(1)}年" if match else ""


def _plot_ratio_text(*sources: Any) -> str:
    for raw in sources:
        if raw in (None, ""):
            continue
        value = raw
        if isinstance(raw, str):
            try:
                value = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                return _text(raw, 160)
        if isinstance(value, dict):
            parts = []
            for marker in ("X", "S"):
                ratio = _text(value.get(f"RJL_{marker}"), 40)
                if ratio:
                    operator = _text(value.get(f"RJL_{marker}_FH"), 8)
                    parts.append(f"{marker}{operator}{ratio}")
            if parts:
                return "；".join(parts)
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))[:160]
        return _text(value, 160)
    return ""


def enrich_record(record: Dict[str, Any], detail_fetcher: Callable[[str], Dict[str, Any]]) -> Dict[str, Any]:
    detail = parse_content_fields(record.get("content", ""))
    source_id = _text(record.get("sourceId"), 200)
    detail_data: Dict[str, Any] = {}
    if source_id:
        try:
            detail_data = detail_fetcher(source_id) or {}
        except Exception:
            detail_data = {}
    coordinate = normalize_resource_coordinate(detail_data.get("resourceCoordinate", ""))
    is_land_bidding = record.get("_sourceEndpoint") == "landbidding"
    area_mu = _number(
        record.get("landAreaForAre") if is_land_bidding else detail.get("土地面积(亩)")
    )
    area_sqm = _number(
        (record.get("landArea") if is_land_bidding else None)
        or detail_data.get("assignmentArea")
        or detail_data.get("transferArea")
        or detail_data.get("出让面积")
    )
    if area_sqm is None and area_mu is not None:
        area_sqm = round(area_mu * 666.67, 2)
    if is_land_bidding:
        start_total_price_value = _number(record.get("startPrice") or detail_data.get("startPrice"))
        deal_total_price_value = _number(record.get("cjj") or detail_data.get("dealPrice") or detail_data.get("成交价"))
        start_price = _unit_price_from_total(start_total_price_value, area_sqm)
        deal_price = _unit_price_from_total(deal_total_price_value, area_sqm)
        start_total_price = start_total_price_value if start_total_price_value is not None else ""
        deal_total_price = deal_total_price_value if deal_total_price_value is not None else ""
    else:
        start_price = _number(detail_data.get("startPrice") or detail_data.get("startingPrice") or detail_data.get("起始价"))
        deal_price = _number(detail_data.get("dealPrice") or detail_data.get("成交价"))
        if deal_price is None:
            deal_price = _number(detail.get("成交结果"))
        start_total_price = calc_total_price_wan(start_price, area_sqm=area_sqm) if start_price is not None else ""
        deal_total_price = calc_total_price_wan(deal_price, area_sqm=area_sqm) if deal_price is not None else ""
    detail_url = (
        f"https://www.zjzrzyjy.com/landView/land-bidding/source-detail?resourceId={source_id}"
        if source_id else ""
    )
    location = _text(record.get("resourceLocation") if is_land_bidding else "") or _text(detail_data.get("resourceLocation") or detail.get("地块位置"))
    land_use = _text(record.get("landUse") if is_land_bidding else "") or _text(detail_data.get("assignmentPurpose") or detail_data.get("landUse") or detail.get("土地用途"))
    return {
        "record": record,
        "detail": detail,
        "detail_data": detail_data,
        "coord": coordinate,
        "source_id": source_id,
        "detail_url": detail_url,
        "location": location,
        "land_use": land_use,
        "plot_ratio": _plot_ratio_text(record.get("rjl"), detail_data.get("plotRatio"), detail.get("容积率")),
        "area_mu": area_mu,
        "area_sqm": area_sqm,
        "start_price": start_price,
        "start_total_price": start_total_price,
        "deal_price": deal_price,
        "deal_total_price": deal_total_price,
        "term": _land_bidding_term(record, detail_data) if is_land_bidding else _text(detail.get("出让年限")),
        "transferee": _text(detail_data.get("theUnit") or detail_data.get("受让单位") or detail.get("受让单位")),
        "trade_form": _text(record.get("tradeForm") or detail_data.get("tradeForm") or ""),
    }


def _coord_fields(item: Dict[str, Any]) -> Dict[str, Any]:
    coord = item.get("coord") or {}
    center = coord.get("center") or {}
    has_center = center.get("lng") not in (None, "") and center.get("lat") not in (None, "")
    return {
        "坐标状态": "有坐标" if has_center else "无坐标（详情接口未返回）",
        "坐标类型": coord.get("locationType", ""),
        "坐标中心经度": center.get("lng", "") if has_center else "",
        "坐标中心纬度": center.get("lat", "") if has_center else "",
        "X坐标起点": center.get("originLng", "") if has_center else "",
        "Y坐标起点": center.get("originLat", "") if has_center else "",
        "边界点组数": coord.get("group_count", "") if has_center else "",
        "边界点总数": coord.get("point_count", "") if has_center else "",
    }


OUTPUT_COLUMNS = [
    "公示编号", "公示标题", "行政区", "地块编号（宗地编码）", "地块位置", "土地用途", "容积率",
    "土地面积(亩)", "土地面积(平方米)", "出让年限",
    "成交单价(元/平方米)", "成交总价(万元)", "受让单位", "发布时间", "详情页网址",
    "交易形式", "交易方式", "交易阶段", "坐标状态", "坐标类型",
    "坐标中心经度", "坐标中心纬度", "X坐标起点", "Y坐标起点", "边界点组数", "边界点总数",
    "坐标数据文件", "地图文件",
]


def row_from_item(item: Dict[str, Any], coord_path: str = "", map_path: str = "") -> Dict[str, Any]:
    record = item["record"]
    detail = item["detail"]
    detail_data = item["detail_data"]
    row = {
        "公示编号": _text(record.get("publicityId")),
        "公示标题": _text(record.get("sourceCode")),
        "行政区": _text(record.get("districtName")),
        "地块编号（宗地编码）": _text(record.get("sourceCode")),
        "地块位置": item["location"],
        "土地用途": item["land_use"],
        "容积率": item.get("plot_ratio") or _plot_ratio_text(record.get("rjl"), detail_data.get("plotRatio"), detail.get("容积率")),
        "土地面积(亩)": item["area_mu"] if item["area_mu"] is not None else "",
        "土地面积(平方米)": item["area_sqm"] if item["area_sqm"] is not None else "",
        "出让年限": item.get("term") or _text(detail.get("出让年限")),
        "起始单价(元/平方米)": item["start_price"] if item["start_price"] is not None else "",
        "起始总价(万元)": item["start_total_price"],
        "成交单价(元/平方米)": item["deal_price"] if item["deal_price"] is not None else "",
        "成交总价(万元)": item["deal_total_price"],
        "受让单位": item.get("transferee") or _text(detail.get("受让单位")),
        "发布时间": _date_text(record.get("releaseTime")),
        "详情页网址": item["detail_url"],
        "交易形式": item.get("trade_form") or _text(record.get("tradeForm") or detail_data.get("tradeForm") or ""),
        "交易方式": _text(record.get("tradeType") or detail_data.get("tradeType") or ""),
        "交易阶段": _text(record.get("tradeStage") or detail_data.get("tradeStage") or ""),
        "报价开始时间": _date_text(record.get("quoteStartTime") or detail_data.get("quoteStartTime") or ""),
        "坐标数据文件": coord_path,
        "地图文件": map_path,
    }
    row.update(_coord_fields(item))
    return row


def _filter_condition_summary(request: Dict[str, Any]) -> str:
    conditions: List[str] = []
    if request.get("provinceWide"):
        conditions.append("行政区=全省/不限制行政区")
    elif request.get("district"):
        district = _text(request.get("district"), 100)
        suffix = "（districtName精确匹配）" if request.get("districtExact") else ""
        conditions.append(f"行政区={district}{suffix}")
    if request.get("county"):
        county = _text(request.get("county"), 100)
        suffix = "（districtName精确匹配）" if request.get("districtExact") else ""
        conditions.append(f"区县={county}{suffix}")
    if request.get("location"):
        conditions.append(f"位置关键词={_text(request.get('location'), 160)}")
    if request.get("tradeForm"):
        conditions.append(f"交易形式={_text(request.get('tradeForm'), 40)}")
    if request.get("tradeMethods"):
        conditions.append(f"交易方式={'、'.join(request['tradeMethods'])}")
    if request.get("tradeStages"):
        conditions.append(f"交易阶段={'、'.join(request['tradeStages'])}")
    if request.get("landUses"):
        conditions.append(f"土地用途={'、'.join(request['landUses'])}")
    if request.get("startDate") or request.get("endDate"):
        start_date = request.get("startDate") or "不限"
        end_date = request.get("endDate") or "不限"
        conditions.append(f"官网查询日期={start_date}至{end_date}")
    if request.get("startYear"):
        conditions.append(f"起始年份≥{request['startYear']}")
    quote_preset = request.get("quotePreset") or "all"
    if quote_preset != "all":
        quote_labels = {
            "today": "今天",
            "future_3_days": "未来三天",
            "future_7_days": "未来七天",
            "future_30_days": "未来三十天",
            "custom": "自定义",
        }
        quote_text = quote_labels.get(quote_preset, quote_preset)
        if request.get("quoteStartDate") or request.get("quoteEndDate"):
            quote_text += f"({_text(request.get('quoteStartDate'), 20) or '不限'}至{_text(request.get('quoteEndDate'), 20) or '不限'})"
        conditions.append(f"报价开始时间={quote_text}")
    if request.get("startPriceMin") is not None or request.get("startPriceMax") is not None:
        price_min = request.get("startPriceMin") if request.get("startPriceMin") not in (None, "") else "不限"
        price_max = request.get("startPriceMax") if request.get("startPriceMax") not in (None, "") else "不限"
        conditions.append(f"起始价={price_min}至{price_max}")
    if request.get("areaMin") is not None or request.get("areaMax") is not None:
        unit = "亩" if request.get("areaUnit") == "mu" else "平方米"
        area_min = request.get("areaMin") if request.get("areaMin") not in (None, "") else "不限"
        area_max = request.get("areaMax") if request.get("areaMax") not in (None, "") else "不限"
        conditions.append(f"出让面积={area_min}至{area_max}{unit}")
    if request.get("maxPages"):
        conditions.append(f"抓取页数上限={request['maxPages']}")
    return "；".join(conditions) or "未设置额外筛选条件"


def write_excel(path: Path, rows: List[Dict[str, Any]], request: Dict[str, Any], summary: Dict[str, Any]) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "成交公示"
    header_fill = PatternFill("solid", fgColor="E8EEF8")
    for index, column in enumerate(OUTPUT_COLUMNS, 1):
        cell = sheet.cell(1, index, column)
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row_index, row in enumerate(rows, 2):
        for column_index, column in enumerate(OUTPUT_COLUMNS, 1):
            value = row.get(column, "")
            cell = sheet.cell(row_index, column_index, value)
            if column in DISPLAY_NUMBER_COLUMNS and isinstance(value, (int, float)) and not isinstance(value, bool):
                cell.number_format = EXCEL_NUMBER_FORMAT
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(OUTPUT_COLUMNS))}{max(1, len(rows) + 1)}"
    for column_index, column in enumerate(OUTPUT_COLUMNS, 1):
        max_length = max([len(str(column))] + [len(str(sheet.cell(i, column_index).value or "")) for i in range(2, len(rows) + 2)])
        sheet.column_dimensions[get_column_letter(column_index)].width = min(max(12, max_length + 2), 42)

    summary_sheet = workbook.create_sheet("筛选说明")
    summary_sheet.append(["字段", "值"])
    for cell in summary_sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = header_fill
    for key, value in [
        ("抓取页数上限", request["maxPages"]),
        ("抓取后记录数", summary.get("fetched", 0)),
        ("写出记录数", len(rows)),
        ("当前筛选条件", _filter_condition_summary(request)),
        ("过滤说明", "行政区和官网查询日期先作为列表查询条件；土地用途、位置关键词、交易方式和交易阶段等条件再由候选列表及详情复核。"),
        ("限制与警告", "；".join(summary.get("warnings", []) + summary.get("unsupportedFilters", [])) or "无"),
    ]:
        summary_sheet.append([key, value])
    summary_sheet.column_dimensions["A"].width = 22
    summary_sheet.column_dimensions["B"].width = 100
    workbook.save(path)
    with zipfile.ZipFile(path, "r") as archive:
        if archive.testzip():
            raise ValueError("LAND_EXCEL_ARCHIVE_INVALID")


def _table_cell(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def write_result_html(path: Path, rows: List[Dict[str, Any]], request: Dict[str, Any], summary: Dict[str, Any], file_names: Dict[str, str]) -> None:
    columns = [
        "公示编号", "公示标题", "行政区", "地块编号（宗地编码）", "地块位置", "土地用途", "容积率",
        "土地面积(亩)", "土地面积(平方米)", "出让年限",
        "成交单价(元/平方米)", "成交总价(万元)", "受让单位", "发布时间", "详情页网址",
        "交易方式", "交易阶段", "坐标状态",
    ]
    header = "".join(
        f'<th><div class="table-header-cell"><span>{_table_cell(column)}</span><button class="column-filter-trigger" type="button" data-column="{index + 1}" aria-label="筛选{_table_cell(column)}" title="筛选{_table_cell(column)}"><span class="filter-funnel" aria-hidden="true"></span></button></div></th>'
        for index, column in enumerate(columns)
    )
    body_parts: List[str] = []
    for row in rows:
        no_coord = row.get("坐标状态", "").startswith("无坐标")
        css = " class=\"no-coordinate\"" if no_coord else ""
        map_key = _table_cell(row.get("公示标题") or row.get("公示编号") or "")
        select_control = (
            f'<input class="detail-select" type="checkbox" data-map-key="{map_key}" aria-label="选择 {map_key}">'
            if not no_coord and map_key
            else '<input class="detail-select" type="checkbox" disabled title="该记录没有坐标，无法在地图上定位">'
        )
        cells_parts = []
        for column in columns:
            value = row.get(column, "")
            if column == "详情页网址" and value:
                safe_url = _table_cell(value)
                cells_parts.append(f'<td><a href="{safe_url}" target="_blank" rel="noopener">打开详情</a></td>')
            else:
                cell_class = ' class="numeric-cell"' if column in DISPLAY_NUMBER_COLUMNS or column == "出让年限" else ""
                cells_parts.append(f"<td{cell_class}>{_table_cell(_display_cell_value(column, value))}</td>")
        cells = "".join(cells_parts)
        body_parts.append(f'<tr{css} data-map-key="{map_key}"><td class="select-cell">{select_control}</td>{cells}</tr>')
    body = "".join(body_parts) or f'<tr><td colspan="{len(columns) + 1}" class="empty">没有符合条件的记录</td></tr>'
    empty_notice = ""
    if not rows:
        conditions = _table_cell(_filter_condition_summary(request))
        advice = "建议检查成交公示日期、行政区或位置关键词，以及接口返回是否存在记录。"
        if request.get("maxPages") == 1 and (request.get("district") or request.get("location")):
            advice = "当前只抓第1页；列表按发布时间倒序，目标行政区可能不在最新50条中，请改为50页（行政区推荐）后重试。"
        empty_notice = (
            '<div class="inline-notice empty-result-notice"><strong>结果为 0 条</strong>'
            f'<p>当前筛选条件：{conditions}</p>'
            f'<p>{advice}</p></div>'
        )
    coordinate_count = sum(1 for row in rows if row.get("坐标状态") == "有坐标")
    missing_coordinate_count = sum(1 for row in rows if row.get("坐标状态", "").startswith("无坐标"))
    warnings = summary.get("warnings", []) + summary.get("unsupportedFilters", [])
    warning_html = "".join(f"<li>{_table_cell(item)}</li>" for item in warnings)
    warning_block = (
        f'<details class="filter-notes"><summary>查看筛选说明</summary><ul>{warning_html}</ul></details>'
        if warnings else ""
    )
    map_name = file_names.get("map", "")
    map_action = (
        f'<a class="button" href="{_table_cell(map_name)}" target="_blank" rel="noopener">查看地图</a>'
        if map_name else '<button class="button secondary" type="button" disabled>查看地图（本次未生成）</button>'
    )
    map_preview = (
        f'<div class="map-frame-shell" aria-label="可调整大小的地图区域"><iframe id="land-map-frame" title="地图预览" src="{_table_cell(map_name)}"></iframe><div id="map-resize-handle" class="map-resize-handle" role="separator" aria-orientation="vertical" aria-label="拖动调整地图高度" title="拖动调整地图高度"></div></div>'
        if map_name else '<div class="map-empty">未勾选生成地图；结果中仍标注每条记录的坐标状态。</div>'
    )
    excel_name = file_names["excel"]
    excel_actions = f'<div class="actions"><a class="button" href="{_table_cell(excel_name)}" download>下载 Excel</a><a class="button secondary" href="{_table_cell(excel_name)}" target="_blank" rel="noopener">打开 Excel</a></div>'
    detail_script = """<script>
(() => {
  const frame = document.getElementById('land-map-frame');
  const mapFrameShell = document.querySelector('.map-frame-shell');
  const mapResizeHandle = document.getElementById('map-resize-handle');
  const filter = document.getElementById('detail-filter');
  const columnFilterTriggers = Array.from(document.querySelectorAll('.column-filter-trigger'));
  const columnFilterPopover = document.getElementById('column-filter-popover');
  const columnFilterLabel = document.getElementById('column-filter-label');
  const columnFilterInput = document.getElementById('column-filter-input');
  const clearColumnFilterButton = document.getElementById('clear-column-filter');
  const closeColumnFilterButton = document.getElementById('close-column-filter');
  const count = document.getElementById('detail-count');
  const clearButton = document.getElementById('clear-selection');
  const distanceButton = document.getElementById('show-selected-distances');
  const clearFiltersButton = document.getElementById('clear-table-filters');
  const rows = Array.from(document.querySelectorAll('#detail-table tbody tr[data-map-key]'));
  const selected = new Set();
  const columnFilterValues = new Map();
  let activeColumnIndex = null;
  let resizeState = null;
  function send(message) { if (frame?.contentWindow) frame.contentWindow.postMessage(message, '*'); }
  function minimumMapHeight() { return window.matchMedia('(max-width: 820px)').matches ? 360 : 440; }
  function stopMapResize(event) {
    if (!resizeState) return;
    if (event && mapResizeHandle?.releasePointerCapture && mapResizeHandle.hasPointerCapture(event.pointerId)) mapResizeHandle.releasePointerCapture(event.pointerId);
    resizeState = null;
    document.body.classList.remove('resizing-map');
  }
  mapResizeHandle?.addEventListener('pointerdown', (event) => {
    if (!mapFrameShell) return;
    event.preventDefault();
    resizeState = { startY: event.clientY, startHeight: mapFrameShell.getBoundingClientRect().height };
    mapResizeHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing-map');
  });
  mapResizeHandle?.addEventListener('pointermove', (event) => {
    if (!resizeState || !mapFrameShell) return;
    const nextHeight = Math.max(minimumMapHeight(), Math.round(resizeState.startHeight + event.clientY - resizeState.startY));
    mapFrameShell.style.height = `${nextHeight}px`;
  });
  mapResizeHandle?.addEventListener('pointerup', stopMapResize);
  mapResizeHandle?.addEventListener('pointercancel', stopMapResize);
  function syncColumnFilterState() {
    columnFilterTriggers.forEach((trigger) => {
      const index = Number(trigger.dataset.column);
      trigger.classList.toggle('active', Boolean(columnFilterValues.get(index)));
    });
  }
  function closeColumnFilter() {
    if (!columnFilterPopover) return;
    columnFilterPopover.hidden = true;
    columnFilterTriggers.forEach((trigger) => trigger.closest('th')?.classList.remove('filter-open'));
    activeColumnIndex = null;
  }
  function openColumnFilter(trigger) {
    if (!columnFilterPopover || !columnFilterInput) return;
    activeColumnIndex = Number(trigger.dataset.column);
    columnFilterLabel.textContent = `筛选${trigger.getAttribute('aria-label')?.replace(/^筛选/, '') || '本列'}`;
    columnFilterInput.value = columnFilterValues.get(activeColumnIndex) || '';
    columnFilterTriggers.forEach((item) => item.closest('th')?.classList.toggle('filter-open', item === trigger));
    columnFilterPopover.hidden = false;
    const rect = trigger.getBoundingClientRect();
    const width = 230;
    const left = Math.min(Math.max(8, rect.left - 150), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 86));
    columnFilterPopover.style.left = `${left}px`;
    columnFilterPopover.style.top = `${top}px`;
    columnFilterInput.focus();
    columnFilterInput.select();
  }
  function updateSelection() {
    document.querySelectorAll('.detail-select').forEach((input) => input.closest('tr')?.classList.toggle('selected-row', input.checked));
    if (count) count.textContent = `显示 ${rows.filter((row) => !row.hidden).length} 条，已选 ${selected.size} 条`;
    if (clearButton) clearButton.disabled = selected.size === 0;
    if (distanceButton) distanceButton.disabled = selected.size === 0 || !frame?.contentWindow;
    send({ type: 'ZJ_LAND_MAP_SET_SELECTED', sourceCodes: [...selected] });
  }
  function applyFilter() {
    const query = String(filter?.value || '').trim().toLowerCase();
    const activeColumnFilters = [...columnFilterValues.entries()]
      .map(([index, value]) => ({ index, value: String(value || '').trim().toLowerCase() }))
      .filter(({ value }) => value);
    rows.forEach((row) => {
      const matchesGlobal = !query || row.textContent.toLowerCase().includes(query);
      const matchesColumns = activeColumnFilters.every(({ index, value }) => String(row.cells[index]?.textContent || '').toLowerCase().includes(value));
      row.hidden = !(matchesGlobal && matchesColumns);
    });
    updateSelection();
  }
  rows.forEach((row) => {
    const checkbox = row.querySelector('.detail-select');
    checkbox?.addEventListener('change', (event) => {
      const key = event.currentTarget.dataset.mapKey;
      if (!key) return;
      if (event.currentTarget.checked) selected.add(key); else selected.delete(key);
      updateSelection();
    });
    row.addEventListener('click', (event) => {
      if (event.target.closest('input, a, button')) return;
      const key = row.dataset.mapKey;
      if (key) send({ type: 'ZJ_LAND_MAP_FOCUS', sourceCodes: [key] });
    });
  });
  filter?.addEventListener('input', applyFilter);
  columnFilterTriggers.forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!columnFilterPopover.hidden && activeColumnIndex === Number(trigger.dataset.column)) closeColumnFilter();
    else openColumnFilter(trigger);
  }));
  columnFilterInput?.addEventListener('input', () => {
    if (activeColumnIndex === null) return;
    const value = columnFilterInput.value.trim();
    if (value) columnFilterValues.set(activeColumnIndex, value);
    else columnFilterValues.delete(activeColumnIndex);
    syncColumnFilterState();
    applyFilter();
  });
  clearColumnFilterButton?.addEventListener('click', () => {
    if (activeColumnIndex !== null) columnFilterValues.delete(activeColumnIndex);
    if (columnFilterInput) columnFilterInput.value = '';
    syncColumnFilterState();
    applyFilter();
  });
  closeColumnFilterButton?.addEventListener('click', closeColumnFilter);
  clearFiltersButton?.addEventListener('click', () => {
    if (filter) filter.value = '';
    columnFilterValues.clear();
    if (columnFilterInput) columnFilterInput.value = '';
    syncColumnFilterState();
    closeColumnFilter();
    applyFilter();
  });
  clearButton?.addEventListener('click', () => {
    selected.clear();
    document.querySelectorAll('.detail-select').forEach((input) => { input.checked = false; });
    updateSelection();
  });
  distanceButton?.addEventListener('click', () => {
    if (!selected.size) return;
    send({ type: 'ZJ_LAND_MAP_DISTANCE_REQUEST', sourceCodes: [...selected] });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.column-filter-popover, .column-filter-trigger')) closeColumnFilter();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeColumnFilter(); });
  frame?.addEventListener('load', () => { send({ type: 'ZJ_LAND_MAP_SET_SELECTED', sourceCodes: [...selected] }); if (distanceButton) distanceButton.disabled = selected.size === 0; });
  window.addEventListener('message', (event) => {
    if (event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'ZJ_LAND_MAP_READY') updateSelection();
    if (event.data?.type === 'ZJ_LAND_MAP_STATUS' && typeof event.data.message === 'string') {
      const notice = document.getElementById('land-map-status');
      if (notice) { notice.textContent = event.data.message; notice.dataset.kind = event.data.kind === 'ok' ? 'ok' : 'warn'; }
    }
  });
  applyFilter();
})();
</script>"""
    html_content = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>浙江土地成交公示结果</title>
<style>
body{{margin:0;background:#f5f7fb;color:#1c2430;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
html{{box-sizing:border-box}}*,*::before,*::after{{box-sizing:inherit}}body{{overflow-x:hidden}}main{{width:100%;min-width:0;margin:0;padding:16px clamp(12px,1.2vw,20px)}}h1{{margin:0 0 8px;font-size:21px}}h2{{margin:0 0 10px;font-size:17px}}.muted{{color:#667085}}
.card{{min-width:0;max-width:100%;background:#fff;border:1px solid #e5e9f0;border-radius:10px;box-shadow:0 3px 12px #1d29390a;padding:11px;margin:8px 0}}.map-setup-notice{{padding:9px 12px;margin-bottom:10px;border:1px solid #f6d58a;border-radius:8px;background:#fff8e6;color:#854d0e;line-height:1.6;overflow-wrap:anywhere}}.map-setup-notice[data-kind="ok"]{{border-color:#bbdfc6;background:#effaf3;color:#166534}}
.actions{{display:flex;gap:7px;flex-wrap:wrap}}.button{{display:inline-block;padding:6px 10px;border-radius:7px;background:#2457c5;color:#fff;text-decoration:none;font-size:13px;white-space:nowrap}}.button.secondary{{background:#eef3ff;color:#2457c5}}.section-heading{{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}}.section-heading h2{{margin:0}}
.filter-notes{{margin:0 0 8px;color:#8b5e00;font-size:12px}}.filter-notes summary{{cursor:pointer;color:#667085}}.filter-notes ul{{margin:6px 0 0;padding-left:18px}}.inline-notice{{margin:0 0 8px;padding:8px 10px;border-radius:7px;background:#fff8e6;color:#8b5e00;font-size:12px;line-height:1.4}}.inline-notice p{{margin:3px 0 0}}
.detail-toolbar{{display:flex;align-items:center;gap:8px;margin:-2px 0 8px}}.detail-filter{{width:280px;max-width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d0d7e2;border-radius:7px;font:inherit;font-size:12px}}.detail-filter:focus{{outline:2px solid #c7d7ff;border-color:#2457c5}}.detail-count{{color:#667085;font-size:12px}}.clear-selection,.clear-table-filters,.show-selected-distances{{border:0;background:#eef3ff;color:#2457c5;border-radius:7px;padding:6px 9px;font-size:12px;cursor:pointer}}.clear-selection{{margin-left:auto}}.clear-selection:disabled,.show-selected-distances:disabled{{opacity:.45;cursor:default}}.table-wrap{{overflow:auto}}table{{border-collapse:collapse;width:100%;min-width:1020px}}th,td{{border-bottom:1px solid #edf0f5;padding:7px 8px;text-align:left;white-space:nowrap}}th{{background:#f8fafc;position:sticky;top:0;z-index:3}}thead tr.filter-row th{{top:34px;z-index:2;background:#fff;padding:4px 5px}}.column-filter{{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid #d0d7e2;border-radius:6px;font:inherit;font-size:11px;color:#344054;background:#fff}}.column-filter:focus{{outline:2px solid #c7d7ff;border-color:#2457c5}}.select-filter-cell{{width:34px}}th:first-child,td.select-cell{{width:34px;text-align:center;padding-left:6px;padding-right:6px}}td.numeric-cell{{text-align:right;font-variant-numeric:tabular-nums}}tr[data-map-key]{{cursor:pointer}}tr[data-map-key]:hover{{background:#f5f8ff}}tr.selected-row{{background:#fff4df!important}}tr.no-coordinate{{background:#fff8e6}}.detail-select{{width:14px;height:14px;accent-color:#f97316}}.empty{{text-align:center;color:#667085;padding:24px}}
.table-header-cell{{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}}.table-header-cell>span{{overflow:hidden;text-overflow:ellipsis}}.column-filter-trigger{{display:inline-flex;align-items:center;justify-content:center;flex:0 0 20px;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:#98a2b3;cursor:pointer}}.column-filter-trigger:hover,.column-filter-trigger.active{{background:#eaf1ff;color:#2457c5}}.filter-funnel{{position:relative;display:block;width:11px;height:12px}}.filter-funnel::before{{content:"";position:absolute;left:1px;top:1px;width:9px;height:5px;background:currentColor;clip-path:polygon(0 0,100% 0,62% 100%,38% 100%)}}.filter-funnel::after{{content:"";position:absolute;left:5px;top:6px;width:2px;height:5px;background:currentColor;border-radius:1px}}.column-filter-popover{{position:fixed;z-index:10000;width:230px;box-sizing:border-box;padding:9px;background:#fff;border:1px solid #dbe3ef;border-radius:8px;box-shadow:0 10px 26px rgba(15,23,42,.18)}}.column-filter-popover[hidden]{{display:none}}.column-filter-popover-head{{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;color:#344054;font-size:12px;font-weight:700}}.column-filter-popover-close{{border:0;background:transparent;color:#98a2b3;font-size:17px;line-height:1;cursor:pointer}}.column-filter-popover input{{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;font-size:12px}}.column-filter-popover input:focus{{outline:2px solid #c7d7ff;border-color:#2457c5}}.column-filter-popover-actions{{display:flex;justify-content:flex-end;gap:6px;margin-top:7px}}.column-filter-popover-actions button{{border:0;border-radius:6px;padding:5px 8px;background:#eef3ff;color:#2457c5;font-size:11px;cursor:pointer}}
.map-frame-shell{{position:relative;width:100%;height:440px;min-height:440px;max-width:100%;overflow:hidden;border:1px solid #e5e9f0;border-radius:8px;background:#f8fafc}}.map-frame-shell iframe{{display:block;width:100%;height:100%;border:0;border-radius:inherit}}.map-resize-handle{{position:absolute;z-index:4;left:0;right:0;bottom:0;height:14px;cursor:ns-resize;touch-action:none;background:linear-gradient(to bottom,transparent 0,transparent 45%,rgba(36,87,197,.16) 46%,rgba(36,87,197,.16) 54%,transparent 55%);}}.map-resize-handle::after{{content:"";position:absolute;left:50%;bottom:4px;width:34px;height:3px;transform:translateX(-50%);border-radius:4px;background:#98a2b3;opacity:.85}}body.resizing-map{{user-select:none;cursor:ns-resize}}body.resizing-map iframe{{pointer-events:none}}.map-empty{{padding:16px;color:#667085;background:#f8fafc;border-radius:8px}}li{{margin:5px 0;color:#8b5e00}}@media (max-width:820px){{main{{padding:12px}}.section-heading{{align-items:flex-start}}.section-heading .actions{{flex-shrink:0}}.map-frame-shell{{height:360px;min-height:360px}}}}
.detail-toolbar{{flex-wrap:wrap}}.section-heading{{flex-wrap:wrap}}.table-wrap{{width:100%;max-width:100%;min-width:0}}.map-frame-shell{{height:clamp(360px,50dvh,720px);min-height:320px;box-sizing:border-box}}@media(max-width:820px){{.map-frame-shell{{height:clamp(280px,45dvh,480px);min-height:280px}}.detail-filter{{flex:1 1 220px}}}}
</style></head><body><main>
<h1>浙江土地成交公示</h1>
<section class="card"><div class="section-heading"><h2>地图（{coordinate_count} 条可定位结果）</h2><div class="map-actions">{map_action}</div></div><div id="land-map-status" class="map-setup-notice" role="status">地图未配置时，请前往首页 → 地图基础配置，填写高德 JS API Key 并保存，再重新生成地图。</div>{map_preview}</section>
<section class="card"><div class="section-heading"><h2>成交公示明细</h2>{excel_actions}</div>{empty_notice}{warning_block}<div class="detail-toolbar"><input id="detail-filter" class="detail-filter" type="search" placeholder="筛选编号、位置、用途、行政区……"><span id="detail-count" class="detail-count"></span><button id="clear-table-filters" class="clear-table-filters" type="button">清除筛选</button><button id="show-selected-distances" class="show-selected-distances" type="button" disabled>显示到标记距离</button><button id="clear-selection" class="clear-selection" type="button" disabled>清除勾选</button></div><div id="column-filter-popover" class="column-filter-popover" hidden><div class="column-filter-popover-head"><span id="column-filter-label">列筛选</span><button id="close-column-filter" class="column-filter-popover-close" type="button" aria-label="关闭">×</button></div><input id="column-filter-input" type="search" placeholder="输入关键词"><div class="column-filter-popover-actions"><button id="clear-column-filter" type="button">清除当前列</button></div></div><div class="table-wrap"><table id="detail-table"><thead><tr><th>选择</th>{header}</tr></thead><tbody>{body}</tbody></table></div></section>
{detail_script}</main></body></html>"""
    path.write_text(html_content, encoding="utf-8")


def _legacy_items_from_workbook(path: Path) -> Dict[str, Any]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    values = list(sheet.iter_rows(values_only=True))
    workbook.close()
    if not values:
        return {"items": [], "request": {}, "legacy": True}
    headers = [str(value or "").strip() for value in values[0]]
    rows = [dict(zip(headers, row)) for row in values[1:] if any(value not in (None, "") for value in row)]
    coords = {}
    coord_path_value = next((row.get("坐标数据文件") for row in rows if row.get("坐标数据文件")), "")
    coord_path = Path(str(coord_path_value)) if coord_path_value else path.with_name(f"{path.stem}_coords.json")
    if coord_path.exists():
        try:
            for point in json.loads(coord_path.read_text(encoding="utf-8")):
                for item in point.get("items", []):
                    coords[_text(item.get("sourceCode"))] = {"center": {"lng": point.get("lon"), "lat": point.get("lat")}}
        except (OSError, ValueError, TypeError):
            coords = {}
    items = []
    refreshable = False
    for row in rows:
        source_code = _text(row.get("公示标题") or row.get("地块编号（宗地编码）") or row.get("公示编号"))
        detail_url = _text(row.get("详情页网址"))
        source_id = _text(parse_qs(urlparse(detail_url).query).get("resourceId", [""])[0]) or _text(row.get("公示编号"))
        refreshable = refreshable or bool(parse_qs(urlparse(detail_url).query).get("resourceId"))
        record = {
            "publicityId": _text(row.get("公示编号")),
            "sourceCode": source_code,
            "districtName": _text(row.get("行政区")),
            "releaseTime": _text(row.get("发布时间")),
            "sourceId": source_id,
            "content": "",
            # 旧工作簿显式列出的筛选字段：复用渲染时供 filter_records 复核，
            # 缺列时留空并按 allow-unknown 语义放行，不猜测。
            "landUse": _text(row.get("土地用途")),
            "tradeMethod": _text(row.get("交易方式")),
        }
        items.append({
            "record": record,
            "detail": {},
            "detail_data": {},
            "coord": coords.get(source_code, {}),
            "source_id": _text(row.get("公示编号")),
            "detail_url": detail_url,
            "location": _text(row.get("地块位置")),
            "land_use": _text(row.get("土地用途")),
            "plot_ratio": _text(row.get("容积率")),
            "area_mu": row.get("土地面积(亩)"),
            "area_sqm": row.get("土地面积(平方米)"),
            "start_price": row.get("起始单价(元/平方米)"),
            "start_total_price": row.get("起始总价(万元)"),
            "deal_price": row.get("成交单价(元/平方米)"),
            "deal_total_price": row.get("成交总价(万元)"),
            "term": _text(row.get("出让年限")),
            "transferee": _text(row.get("受让单位")),
            "trade_form": _text(row.get("交易形式")),
        })
    return {"items": items, "request": {}, "legacy": True, "refreshable": refreshable}


def load_history_file(path: Path) -> Dict[str, Any]:
    if path.suffix.lower() == ".xlsx":
        return _legacy_items_from_workbook(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"LAND_HISTORY_READ_FAILED:{error}") from error
    if not isinstance(payload, dict) or payload.get("type") != "zj-land-publicity-history":
        raise ValueError("LAND_HISTORY_FORMAT_INVALID")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("LAND_HISTORY_ITEMS_INVALID")
    return {"items": items, "request": payload.get("request") or {}, "legacy": False, "payload": payload}


def write_history_manifest(path: Path, request: Dict[str, Any], summary: Dict[str, Any], items: List[Dict[str, Any]], outputs: Dict[str, str], source_mode: str) -> None:
    payload = {
        "type": "zj-land-publicity-history",
        "version": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "querySignature": _query_signature(request),
        "sourceMode": source_mode,
        "request": {key: value for key, value in request.items() if key not in ("historyPath", "historyRefresh")},
        "summary": summary,
        "outputs": outputs,
        "items": items,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def _move_asset(source: Path, target: Path) -> None:
    if not source.exists() or source.stat().st_size <= 0:
        raise ValueError(f"LAND_OUTPUT_EMPTY:{source.name}")
    os.replace(source, target)


def execute_request(
    request: Dict[str, Any],
    fetcher: Callable[..., List[Dict[str, Any]]] = skill_fetch_land_bidding_records,
    detail_fetcher: Callable[[str], Dict[str, Any]] = fetch_resource_detail,
    progress: Callable[..., None] = emit_progress,
) -> Dict[str, Any]:
    config = validate_request(request)
    output_dir = Path(config["outputDirectory"])
    query_signature = _query_signature(config)
    stem = _result_stem(config)
    final_paths = {
        "excel": output_dir / f"{stem}.xlsx",
        "html": output_dir / f"{stem}.html",
        "coords": output_dir / f"{stem}_coords.json",
        "points": output_dir / f"{stem}_points.js",
        "map": output_dir / f"{stem}_map.html",
        "history": output_dir / f"{stem}_history.json",
    }
    output_will_update = final_paths["excel"].exists() or final_paths["html"].exists() or final_paths["history"].exists()
    stage = Path(tempfile.mkdtemp(prefix=".tianyuan-land-", dir=output_dir))
    try:
        history_info = load_history_file(Path(config["historyPath"])) if config.get("historyPath") else None
        source_mode = "live"
        history_refresh = bool(config.get("historyRefresh", True)) and not bool(history_info and history_info.get("legacy") and not history_info.get("refreshable"))
        if history_info:
            source_mode = "history_refresh" if history_refresh else "history_reuse"
            records = [item.get("record", {}) for item in history_info["items"] if isinstance(item, dict) and isinstance(item.get("record"), dict)]
            if not records:
                raise ValueError("LAND_HISTORY_ITEMS_EMPTY")
            progress("fetching", 5, f"已加载历史清单，共 {len(records)} 条，正在{'重新读取详情' if history_refresh else '复用历史详情'}", fetched=0, filtered=0, written=0)
        else:
            progress("fetching", 5, "正在按条件读取浙江土地成交公示候选列表", fetched=0, filtered=0, written=0)
            list_filter = _list_district_filter(config)
            try:
                records = fetcher(
                    district_filter=list_filter,
                    max_pages=config["maxPages"],
                    record_filter=lambda record: _list_record_matches_request(config, record),
                    stop_before=_list_stop_before(config),
                    server_filters=_website_server_filters(config),
                )
            except LandSourceError as error:
                # 数据源请求失败/HTML 壳/schema 不匹配：结构化失败，禁止落入零结果成功。
                raise ValueError(json.dumps({
                    "errorCode": error.errorCode,
                    "reason": str(error),
                    "diagnostics": error.diagnostics,
                }, ensure_ascii=False)) from error
        fetched_count = len(records)
        if fetched_count == 0 and config.get("provinceWide") and not config.get("startDate") and not config.get("endDate"):
            # 全省 + 不限日期的真实接口全年不可能为 0 条；首个有效页为空说明
            # 数据源异常（HTML 壳、风控空数据等），不得默认成功。
            raise ValueError(json.dumps({
                "errorCode": "LAND_LIST_PROVINCEWIDE_EMPTY_SUSPICIOUS",
                "reason": "全省且不限日期的查询返回 0 条，数据源异常或需人工核验",
                "diagnostics": None,
            }, ensure_ascii=False))
        progress("fetching", 38, f"条件候选读取完成，共 {fetched_count} 条，正在复核详情", fetched=fetched_count, filtered=0, written=0)
        enriched: List[Dict[str, Any]] = []
        stored_items = history_info["items"] if history_info else []
        for index, record in enumerate(records, 1):
            if history_info and not history_refresh and index <= len(stored_items):
                enriched.append(stored_items[index - 1])
            else:
                enriched.append(enrich_record(record, detail_fetcher))
            percent = 40 + round(index / max(1, fetched_count) * 28)
            progress("enriching", percent, f"正在读取详情 {index}/{fetched_count}" if history_refresh or not history_info else f"正在复用历史详情 {index}/{fetched_count}", fetched=fetched_count, enriched=index, filtered=0, written=0)
        filtered, filter_summary = filter_records(enriched, config)
        fetched_coordinate_count = sum(
            1 for item in enriched
            if item.get("coord", {}).get("center", {}).get("lng") not in (None, "")
            and item.get("coord", {}).get("center", {}).get("lat") not in (None, "")
        )
        filtered_coordinate_count = sum(
            1 for item in filtered
            if item.get("coord", {}).get("center", {}).get("lng") not in (None, "")
            and item.get("coord", {}).get("center", {}).get("lat") not in (None, "")
        )
        summary = {
            "fetched": fetched_count,
            "enriched": len(enriched),
            "filtered": len(filtered),
            "written": len(filtered),
            "fetchedCoordinateCount": fetched_coordinate_count,
            "filteredCoordinateCount": filtered_coordinate_count,
            **filter_summary,
        }
        progress("filtering", 72, f"候选详情复核完成，保留 {len(filtered)} 条", fetched=fetched_count, filtered=len(filtered), written=0)

        stage_xlsx = stage / "result.xlsx"
        coord_stage = stage / "result_coords.json"
        points_stage = stage / "result_points.js"
        map_stage = stage / "result_map.html"
        rows_without_assets = [row_from_item(item) for item in filtered]
        if config["generateMap"]:
            map_rows = []
            for item in filtered:
                record = item["record"]
                map_rows.append({
                    "sourceCode": record.get("sourceCode", ""),
                    "districtName": record.get("districtName", ""),
                    "releaseTime": record.get("releaseTime", ""),
                    "_detail_url": item["detail_url"],
                    "_location": item["location"],
                    "_area_mu": item["area_mu"] if item["area_mu"] is not None else "",
                    "_use": item["land_use"],
                    "_plot_ratio": item.get("plot_ratio") or _plot_ratio_text(record.get("rjl"), item.get("detail_data", {}).get("plotRatio")),
                    "_trade_method": _text(
                        record.get("tradeType")
                        or record.get("tradeMethod")
                        or record.get("transactionMode")
                        or item.get("detail_data", {}).get("tradeType")
                        or item.get("detail_data", {}).get("tradeMethod")
                        or ""
                    ),
                    "_start_unit_price": item["start_price"] if item["start_price"] is not None else "",
                    "_start_total_price_wan": item["start_total_price"],
                    "_deal_unit_price": item["deal_price"] if item["deal_price"] is not None else "",
                    "_deal_total_price_wan": item["deal_total_price"],
                    "_assignment_area_sqm": item["area_sqm"] if item["area_sqm"] is not None else "",
                    "_coord": item["coord"],
                })
            assets = build_map_assets(map_rows, stage_xlsx)
            stage_coord = Path(assets["coord_json"])
            stage_points = Path(assets["points_js"])
            stage_map = Path(assets["map_html"])
            coord_stage = stage_coord
            points_stage = stage_points
            map_stage = stage_map
            for item, row in zip(filtered, rows_without_assets):
                row["坐标数据文件"] = str(final_paths["coords"])
                row["地图文件"] = str(final_paths["map"])
        write_excel(stage_xlsx, rows_without_assets, config, summary)
        progress("writing", 86, "Excel 已生成，正在校验结果页和地图产物", fetched=fetched_count, filtered=len(filtered), written=0)

        if config["generateMap"]:
            map_text = map_stage.read_text(encoding="utf-8")
            map_text = map_text.replace(points_stage.name, final_paths["points"].name)
            map_stage.write_text(map_text, encoding="utf-8")

        map_name = final_paths["map"].name if config["generateMap"] else ""
        write_result_html(
            stage / "result.html",
            rows_without_assets,
            config,
            summary,
            {"excel": final_paths["excel"].name, "map": map_name},
        )
        history_stage = stage / "result_history.json"
        write_history_manifest(
            history_stage,
            config,
            summary,
            filtered,
            {"excel": final_paths["excel"].name, "html": final_paths["html"].name, "map": map_name},
            source_mode,
        )

        # 所有新文件先在暂存目录中生成并校验，之后才一次性替换目标文件；
        # 抓取或渲染失败时，上一轮已经完成的 Excel/HTML 仍然可用。
        staged_assets = [(stage_xlsx, final_paths["excel"]), (stage / "result.html", final_paths["html"]), (history_stage, final_paths["history"])]
        if config["generateMap"]:
            staged_assets.extend([
                (coord_stage, final_paths["coords"]),
                (points_stage, final_paths["points"]),
                (map_stage, final_paths["map"]),
            ])
        for source, _target in staged_assets:
            if not source.exists() or source.stat().st_size <= 0:
                raise ValueError(f"LAND_OUTPUT_EMPTY:{source.name}")
        for source, target in staged_assets:
            _move_asset(source, target)
        for path in (final_paths["excel"], final_paths["html"]):
            if not path.exists() or path.stat().st_size <= 0:
                raise ValueError(f"LAND_OUTPUT_READBACK_FAILED:{path.name}")
        if not config["generateMap"]:
            for path in (final_paths["coords"], final_paths["points"], final_paths["map"]):
                if path.exists():
                    path.unlink()
        if len(filtered) == 0:
            progress("complete", 100, "查询完成：接口响应有效，当前筛选条件下无匹配结果", fetched=fetched_count, filtered=0, written=0)
        else:
            progress("complete", 100, f"已写出 {len(filtered)} 条，Excel/结果页回读通过", fetched=fetched_count, filtered=len(filtered), written=len(filtered))
        return {
            "ok": True,
            "action": "run_land_publicity",
            "phase": "completed",
            "percent": 100,
            "fetchedCount": fetched_count,
            "filteredCount": len(filtered),
            "writtenCount": len(filtered),
            "querySignature": query_signature,
            "outputAction": "updated_existing" if output_will_update else "created",
            "excelPath": str(final_paths["excel"]),
            "htmlPath": str(final_paths["html"]),
            "coordsPath": str(final_paths["coords"]) if config["generateMap"] else "",
            "pointsJsPath": str(final_paths["points"]) if config["generateMap"] else "",
            "mapPath": str(final_paths["map"]) if config["generateMap"] else "",
            "historyPath": str(final_paths["history"]),
            "historyMode": source_mode,
            "fetchedCoordinateCount": fetched_coordinate_count,
            "filteredCoordinateCount": filtered_coordinate_count,
            "noCoordinateCount": len(filtered) - filtered_coordinate_count,
            "filterSummary": summary,
            "security": {"credentialsReturned": False},
        }
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="运行浙江土地成交公示受控抓取")
    parser.add_argument("--request-json", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(args.request_json)
        result = execute_request(request)
    except Exception as error:
        result = {
            "ok": False,
            "action": "run_land_publicity",
            "phase": "failed",
            "percent": 0,
            "reason": str(error)[:500],
            "security": {"credentialsReturned": False},
        }
        # LandSourceError 与 runner 包装错误以 JSON 载荷携带稳定错误码与脱敏诊断。
        if isinstance(error, LandSourceError):
            result["errorCode"] = error.errorCode
            if error.diagnostics:
                result["diagnostics"] = error.diagnostics
        else:
            text = str(error)
            if text.startswith("{") and '"errorCode"' in text:
                try:
                    payload = json.loads(text)
                    result["errorCode"] = payload.get("errorCode")
                    result["reason"] = payload.get("reason") or text[:500]
                    if payload.get("diagnostics"):
                        result["diagnostics"] = payload.get("diagnostics")
                except ValueError:
                    pass
    emit_result(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
