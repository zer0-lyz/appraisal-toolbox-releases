"""Explicit, source-paired land-price normalization for Zhejiang land records."""

from __future__ import annotations

import copy
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional


CENT = Decimal("0.01")
NUMBER_PATTERN = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNIT_PATTERN = r"(?:万元(?:总价)?|万元/(?:宗|地块)|元\s*/\s*(?:平方米|平米|㎡)|元每平方米)"
PRICE_TEXT_PATTERN = re.compile(
    rf"(?P<amount>{NUMBER_PATTERN})\s*(?P<unit>{UNIT_PATTERN})(?![\w/])",
    re.IGNORECASE,
)
NUMBER_ONLY_PATTERN = re.compile(rf"^{NUMBER_PATTERN}$")
UNSUPPORTED_PRICE_TEXT_PATTERN = re.compile(
    rf"(?P<amount>{NUMBER_PATTERN})\s*(?P<unit>(?:人民币)?(?:万元|元|万)[^\s，,；;。]*)",
    re.IGNORECASE,
)

TOTAL_UNIT_ALIASES = {
    "万元",
    "万元总价",
    "万元/宗",
    "万元/地块",
}
UNIT_PRICE_ALIASES = {
    "元/平方米",
    "元/平米",
    "元/㎡",
    "元每平方米",
}

STATUS_LABELS = {
    "verified": "已核验",
    "verified_partial": "已核验（仅保留原计价项）",
    "missing_amount": "缺少金额",
    "missing_unit": "缺少单位",
    "unknown_unit": "单位未知",
    "invalid_amount": "金额无法解析",
    "unit_conflict": "单位冲突",
    "source_conflict": "列表与详情不一致",
    "invalid_area": "面积无效",
    "legacy_unverified": "旧历史未核验",
}


def _is_present(value: Any) -> bool:
    return value is not None and value != ""


def _normalise_unit_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().replace("\u3000", "")
    text = re.sub(r"\s+", "", text)
    text = text.replace("／", "/").replace("㎡", "㎡")
    return text


def classify_price_unit(value: Any) -> Optional[str]:
    """Return a supported unit only for explicit, textual aliases."""
    unit = _normalise_unit_text(value)
    if unit in TOTAL_UNIT_ALIASES:
        return "wan_total"
    if unit in UNIT_PRICE_ALIASES:
        return "yuan_per_sqm"
    return None


def _decimal(value: Any) -> Optional[Decimal]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    text = str(value).strip()
    if text.startswith(("=", "+", "@")) or (text.startswith("-") and not NUMBER_ONLY_PATTERN.fullmatch(text)):
        return None
    if not text:
        return None
    if NUMBER_ONLY_PATTERN.fullmatch(text):
        text = text.replace(",", "")
    else:
        matches = list(PRICE_TEXT_PATTERN.finditer(text))
        if len(matches) == 1:
            text = matches[0].group("amount").replace(",", "")
        elif not matches:
            numeric_tokens = re.findall(NUMBER_PATTERN, text)
            if len(numeric_tokens) != 1:
                return None
            text = numeric_tokens[0].replace(",", "")
        else:
            return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _decimal_text(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def _display_decimal(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return _decimal_text(rounded)


def _price_candidates_from_text(value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    text = str(value)
    candidates = []
    for match in PRICE_TEXT_PATTERN.finditer(text):
        candidates.append({
            "amount": match.group("amount"),
            "unit": match.group("unit"),
            "text": match.group(0),
        })
    return candidates


def _unsupported_explicit_pairs(value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    unsupported = []
    for match in UNSUPPORTED_PRICE_TEXT_PATTERN.finditer(str(value)):
        unit = match.group("unit")
        if classify_price_unit(unit) is None:
            unsupported.append({
                "amount": match.group("amount"),
                "unit": unit,
                "text": match.group(0),
            })
    return unsupported


def _evidence(meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "rawAmount": meta.get("rawAmount"),
        "rawUnit": meta.get("rawUnit"),
        "source": meta.get("source", ""),
        "amountField": meta.get("amountField", ""),
        "unitField": meta.get("unitField", ""),
        "normalizedUnit": meta.get("normalizedUnit"),
        "totalPriceWanExact": meta.get("totalPriceWanExact"),
        "unitPriceYuanSqmExact": meta.get("unitPriceYuanSqmExact"),
        "verificationStatus": meta.get("verificationStatus", "unknown_unit"),
        "warning": meta.get("warning", ""),
    }


def normalize_land_price(
    amount: Any,
    unit: Any = None,
    area_sqm: Any = None,
    *,
    source: str = "",
    amount_field: str = "",
    unit_field: str = "",
) -> Dict[str, Any]:
    """Normalize one explicit amount/unit pair without inferring its meaning.

    If ``amount`` contains a supported explicit unit (for example
    ``900元/平方米``), that unit is used only when the separate unit is absent.
    A supplied but unsupported unit never gets overridden by embedded text.
    """
    raw_amount = amount
    raw_unit = unit
    amount_decimal = _decimal(amount)
    inline = _price_candidates_from_text(amount)
    inline_unit = classify_price_unit(inline[0]["unit"]) if len(inline) == 1 else None
    inline_amount = _decimal(inline[0]["amount"]) if len(inline) == 1 else None
    unsupported_inline = _unsupported_explicit_pairs(amount)
    unsupported_first = unsupported_inline[0] if unsupported_inline else None
    unit_from_text = inline[0]["unit"] if len(inline) == 1 else (
        unsupported_first["unit"] if unsupported_first else None
    )
    separate_unit_present = _is_present(unit)
    if not separate_unit_present and unit_from_text:
        raw_unit = unit_from_text
    raw_unit_present = _is_present(raw_unit)
    unit_kind = classify_price_unit(raw_unit) if raw_unit_present else None
    status = "verified"
    warning = ""

    if len(inline) > 1 or (inline and unsupported_inline):
        status = "unit_conflict"
        warning = "同一金额文本含多个显式计价项，无法唯一确定成交价。"
    elif amount_decimal is None:
        status = "missing_amount" if not _is_present(amount) else "invalid_amount"
        warning = "未取得可解析的价格金额。"
    elif amount_decimal < 0:
        status = "invalid_amount"
        warning = "价格金额为负值，未换算。"
    elif separate_unit_present and unsupported_inline and (
        _normalise_unit_text(raw_unit) != _normalise_unit_text(unsupported_inline[0]["unit"])
    ):
        status = "unit_conflict"
        warning = f"金额文本显式单位“{unsupported_inline[0]['unit']}”与配对单位字段“{raw_unit}”冲突，未换算。"
    elif raw_unit_present and unit_kind is None:
        status = "unknown_unit"
        warning = f"接口原单位“{raw_unit}”不在已确认的支持范围内，未换算。"
    elif separate_unit_present and inline_unit and unit_kind != inline_unit:
        status = "unit_conflict"
        warning = f"金额文本单位“{inline[0]['unit']}”与配对单位字段“{raw_unit}”冲突，未换算。"
    elif raw_unit_present and inline_amount is not None and inline_amount != amount_decimal:
        status = "unit_conflict"
        warning = "金额字段与金额文本中的显式数字不一致，未换算。"
    elif not raw_unit_present and unit_kind is None:
        status = "unknown_unit" if unsupported_first else "missing_unit"
        explicit_text = unsupported_first["unit"] if unsupported_first else ""
        warning = (f"文本单位“{explicit_text}”不在已确认的支持范围内，未换算。"
                   if explicit_text else "缺少已确认的明确计价单位，未按数值、用途或地区推断。")

    exact_total = None
    exact_unit = None
    if status == "verified":
        area = _decimal(area_sqm)
        if area is not None and area < 0:
            status = "verified_partial"
            warning = "平方米面积为负值，未用于换算；只保留原始计价项。"
        if unit_kind == "wan_total":
            exact_total = amount_decimal
            if area is not None and area > 0:
                exact_unit = amount_decimal * Decimal("10000") / area
            elif area == 0:
                status = "verified_partial"
                warning = "面积为0，保留明确万元总价，不执行除法换算。"
            elif area is not None and area < 0:
                exact_unit = None
            else:
                status = "verified_partial"
                warning = "缺少可用的平方米面积，保留明确万元总价，不换算单价。"
        elif unit_kind == "yuan_per_sqm":
            exact_unit = amount_decimal
            if area is not None and area >= 0:
                exact_total = amount_decimal * area / Decimal("10000")
            else:
                status = "verified_partial"
                warning = warning or "缺少可用的平方米面积，保留明确元/平方米单价，不换算总价。"

    if status in ("verified", "verified_partial"):
        calculation = _calculation_text(
            amount_decimal,
            unit_kind,
            area_sqm,
            exact_total,
            exact_unit,
            warning,
        )
    else:
        calculation = "未进行标准化换算；保留原始金额和单位，需回到来源核验。"

    return {
        "rawAmount": raw_amount,
        "rawUnit": raw_unit,
        "source": source,
        "amountField": amount_field,
        "unitField": unit_field or ("金额文本显式单位" if unit_from_text and not separate_unit_present else ""),
        "normalizedUnit": unit_kind if status in ("verified", "verified_partial") else None,
        "inputValueExact": _decimal_text(amount_decimal),
        "totalPriceWanExact": _decimal_text(exact_total),
        "totalPriceWanDisplay": _display_decimal(exact_total),
        "unitPriceYuanSqmExact": _decimal_text(exact_unit),
        "unitPriceYuanSqmDisplay": _display_decimal(exact_unit),
        "areaSqm": str(area_sqm) if _is_present(area_sqm) else None,
        "verificationStatus": status,
        "statusLabel": STATUS_LABELS.get(status, "待核验"),
        "calculation": calculation,
        "warning": warning,
        "evidence": [],
        "corroboratingSources": [],
    }


def normalize_price_text(
    text: Any,
    area_sqm: Any = None,
    *,
    source: str = "",
    amount_field: str = "",
) -> Dict[str, Any]:
    """Parse explicit amount/unit text; multiple prices must reconcile."""
    candidates = _price_candidates_from_text(text)
    if not candidates:
        return normalize_land_price(
            text,
            None,
            area_sqm,
            source=source,
            amount_field=amount_field,
        )
    normalized = [
        normalize_land_price(
            candidate["amount"],
            candidate["unit"],
            area_sqm,
            source=source,
            amount_field=amount_field or candidate["text"],
            unit_field="金额文本显式单位",
        )
        for candidate in candidates
    ]
    normalized.extend(
        normalize_land_price(
            candidate["amount"],
            candidate["unit"],
            area_sqm,
            source=source,
            amount_field=amount_field or candidate["text"],
            unit_field="金额文本显式单位",
        )
        for candidate in _unsupported_explicit_pairs(text)
    )
    return merge_price_candidates(normalized, area_sqm, require_all=True)


def normalize_price_content(
    value: Any,
    unit: Any = None,
    area_sqm: Any = None,
    *,
    source: str = "",
    amount_field: str = "",
    unit_field: str = "HTML标签单位",
) -> Dict[str, Any]:
    """Normalize an HTML price value with a unit only when the label supplies one.

    A recognized or unknown explicit label unit is paired with the value and
    passed through the same validation as API amount/unit fields. When the
    label has no unit, the value is accepted only if it contains an explicit
    supported unit itself.
    """
    if _is_present(unit):
        return normalize_land_price(
            value,
            unit,
            area_sqm,
            source=source,
            amount_field=amount_field,
            unit_field=unit_field,
        )
    return normalize_price_text(
        value,
        area_sqm,
        source=source,
        amount_field=amount_field,
    )


def is_price_resolved(meta: Optional[Dict[str, Any]]) -> bool:
    return bool(
        meta
        and meta.get("normalizedUnit") in ("wan_total", "yuan_per_sqm")
        and meta.get("inputValueExact") is not None
        and meta.get("verificationStatus") in ("verified", "verified_partial")
    )


def _equivalent(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_total = _decimal(left.get("totalPriceWanExact"))
    right_total = _decimal(right.get("totalPriceWanExact"))
    left_unit = _decimal(left.get("unitPriceYuanSqmExact"))
    right_unit = _decimal(right.get("unitPriceYuanSqmExact"))
    tolerance = CENT
    comparisons = []
    if left_total is not None and right_total is not None:
        comparisons.append(abs(left_total - right_total) <= tolerance)
    if left_unit is not None and right_unit is not None:
        comparisons.append(abs(left_unit - right_unit) <= tolerance)
    if comparisons:
        return all(comparisons)
    if left.get("normalizedUnit") == right.get("normalizedUnit"):
        left_value = _decimal(left.get("inputValueExact"))
        right_value = _decimal(right.get("inputValueExact"))
        return left_value is not None and right_value is not None and abs(left_value - right_value) <= tolerance
    return False


def merge_price_candidates(
    candidates: Iterable[Optional[Dict[str, Any]]],
    area_sqm: Any = None,
    *,
    require_all: bool = False,
) -> Dict[str, Any]:
    """Choose only complete source pairs and reject non-equivalent evidence."""
    available = [copy.deepcopy(candidate) for candidate in candidates if candidate]
    if not available:
        return normalize_land_price(None, None, area_sqm)
    fatal = [
        candidate for candidate in available
        if candidate.get("verificationStatus") in ("unit_conflict", "source_conflict")
    ]
    if fatal:
        return _conflict_meta(
            available,
            area_sqm,
            "存在明确金额/单位或来源冲突，已停止标准化换算。",
        )
    resolved = [candidate for candidate in available if is_price_resolved(candidate)]
    unresolved = [candidate for candidate in available if not is_price_resolved(candidate)]

    if require_all and unresolved:
        return _conflict_meta(available, area_sqm, "同一来源的多个计价项并非全部可核验，未选择其中一项。")
    if not resolved:
        if len(available) == 1:
            return available[0]
        if any(candidate.get("verificationStatus") == "unit_conflict" for candidate in available):
            return _conflict_meta(available, area_sqm, "同一来源包含冲突的价格单位或金额，未换算。")
        return available[0]

    first = resolved[0]
    if any(not _equivalent(first, candidate) for candidate in resolved[1:]):
        return _conflict_meta(resolved, area_sqm, "不同明确价格来源按同一面积标准化后不一致，未选择任一结果。")

    merged = first
    corroborating = [
        _source_label(candidate)
        for candidate in resolved[1:]
        if _source_label(candidate) and _source_label(candidate) != _source_label(first)
    ]
    merged["corroboratingSources"] = list(dict.fromkeys(corroborating))
    merged["evidence"] = [_evidence(candidate) for candidate in available]
    if unresolved:
        merged["warning"] = "；".join(filter(None, [
            merged.get("warning", ""),
            "另有来源金额/单位缺失或未识别；当前结果仅采用完整配对且已核验的来源。",
        ]))
    elif len(resolved) > 1:
        merged["crossSourceCheck"] = "consistent"
        merged["calculation"] = (merged.get("calculation", "") + "；列表与详情的明确价格按面积换算后相符。")
    return merged


def _conflict_meta(candidates: List[Dict[str, Any]], area_sqm: Any, warning: str) -> Dict[str, Any]:
    first = candidates[0] if candidates else {}
    return {
        "rawAmount": first.get("rawAmount"),
        "rawUnit": first.get("rawUnit"),
        "source": "；".join(dict.fromkeys(filter(None, (_source_label(item) for item in candidates)))),
        "amountField": first.get("amountField", ""),
        "unitField": first.get("unitField", ""),
        "normalizedUnit": None,
        "inputValueExact": None,
        "totalPriceWanExact": None,
        "totalPriceWanDisplay": None,
        "unitPriceYuanSqmExact": None,
        "unitPriceYuanSqmDisplay": None,
        "areaSqm": str(area_sqm) if _is_present(area_sqm) else None,
        "verificationStatus": "source_conflict",
        "statusLabel": STATUS_LABELS["source_conflict"],
        "calculation": "未生成标准化价格；不同明确来源或多个计价项无法证明为同一报价。",
        "warning": warning,
        "evidence": [_evidence(candidate) for candidate in candidates],
        "corroboratingSources": [],
    }


def _source_label(meta: Dict[str, Any]) -> str:
    source = str(meta.get("source") or "").strip()
    amount_field = str(meta.get("amountField") or "").strip()
    unit_field = str(meta.get("unitField") or "").strip()
    fields = "/".join(field for field in (amount_field, unit_field) if field)
    return f"{source}({fields})" if source and fields else source or fields


def _calculation_text(
    amount: Decimal,
    unit_kind: Optional[str],
    area_sqm: Any,
    total: Optional[Decimal],
    unit_price: Optional[Decimal],
    warning: str,
) -> str:
    area = _decimal(area_sqm)
    if unit_kind == "wan_total":
        base = f"原始值={_decimal_text(amount)}万元"
        if unit_price is not None:
            base += (
                f"；单价={_decimal_text(amount)}×10000÷{_decimal_text(area)}平方米"
                f"={_decimal_text(unit_price)}元/平方米，展示ROUND_HALF_UP保留2位"
            )
        else:
            base += "；未换算单价"
    elif unit_kind == "yuan_per_sqm":
        base = f"原始值={_decimal_text(amount)}元/平方米"
        if total is not None:
            base += (
                f"；总价={_decimal_text(amount)}×{_decimal_text(area)}平方米÷10000"
                f"={_decimal_text(total)}万元，展示ROUND_HALF_UP保留2位"
            )
        else:
            base += "；未换算总价"
    else:
        base = "未换算"
    return f"{base}；{warning}" if warning else base


def resolve_detail_price(
    detail: Dict[str, Any],
    kind: str,
    area_sqm: Any = None,
    *,
    source: str = "queryResourceDetail",
) -> Optional[Dict[str, Any]]:
    """Resolve a complete pair from one detail response, without cross-field guessing."""
    if not isinstance(detail, dict):
        return None
    if kind == "start":
        amount_keys = ("startPrice", "startingPrice", "起始价")
        unit_keys = ("startPriceUnit", "startingPriceUnit", "起始价单位")
        return _resolve_scalar_fields(detail, amount_keys, unit_keys, area_sqm, source)
    if kind != "deal":
        raise ValueError("kind must be 'start' or 'deal'")

    raw_deal = _first_present(detail, ("dealPrice", "成交价", "成交结果"))
    raw_deal_decimal = _decimal(raw_deal)
    list_value = detail.get("dealPriceList")
    if isinstance(list_value, list) and list_value:
        candidates = []
        all_candidates = []
        for index, entry in enumerate(list_value):
            if not isinstance(entry, dict):
                candidate = normalize_land_price(None, None, area_sqm, source=source, amount_field=f"dealPriceList[{index}]")
                all_candidates.append(candidate)
                candidates.append(candidate)
                continue
            amount = _first_present(entry, ("price", "maxPrice", "amount", "value"))
            unit = _first_present(entry, ("unit", "quotationUnit", "priceUnit"))
            candidate = normalize_land_price(
                amount,
                unit,
                area_sqm,
                source=source,
                amount_field=f"dealPriceList[{index}].price",
                unit_field=f"dealPriceList[{index}].unit",
            )
            all_candidates.append(candidate)
            if raw_deal_decimal is not None and _decimal(amount) != raw_deal_decimal:
                continue
            candidates.append(candidate)
        if candidates:
            if len(candidates) == 1:
                if raw_deal_decimal is not None and _decimal(candidates[0].get("inputValueExact")) != raw_deal_decimal:
                    unmatched = normalize_land_price(
                        raw_deal,
                        None,
                        area_sqm,
                        source=source,
                        amount_field="dealPrice",
                    )
                    return _conflict_meta([unmatched, *candidates], area_sqm, "详情dealPrice与dealPriceList金额不匹配，未拼接或择一换算。")
                selected = candidates[0]
                if len(all_candidates) > 1:
                    selected["selectionBasis"] = f"dealPrice={raw_deal}唯一匹配dealPriceList配对金额；未匹配项保留在evidence中。"
                    selected["evidence"] = [_evidence(candidate) for candidate in all_candidates]
                return _cross_check_detail_price(detail, selected, area_sqm, source, raw_deal)
            selected = merge_price_candidates(candidates, area_sqm, require_all=True)
            if raw_deal_decimal is not None:
                selected["selectionBasis"] = f"dealPrice={raw_deal}匹配多个dealPriceList配对项；仅在这些匹配项归一结果一致时采用。"
                selected["evidence"] = [_evidence(candidate) for candidate in all_candidates]
            return _cross_check_detail_price(detail, selected, area_sqm, source, raw_deal)
        unmatched = normalize_land_price(
            raw_deal, None, area_sqm, source=source, amount_field="dealPrice", unit_field=""
        )
        return _conflict_meta([unmatched, *all_candidates], area_sqm, "详情dealPrice无法与dealPriceList中的金额配对，未换算。")

    # A text price is a valid pair only when its explicit amount matches dealPrice,
    # when dealPrice is present. The amount and unit remain within this detail source.
    detail_text = _first_present(detail, ("dealDetail", "成交明细", "成交结果"))
    if _is_present(detail_text):
        text_pairs = _price_candidates_from_text(detail_text)
        unknown_text_pairs = _unsupported_explicit_pairs(detail_text)
        matching_pairs = [
            pair for pair in text_pairs
            if raw_deal_decimal is None or _decimal(pair["amount"]) == raw_deal_decimal
        ]
        if matching_pairs:
            text_meta = merge_price_candidates(
                [normalize_land_price(
                    pair["amount"],
                    pair["unit"],
                    area_sqm,
                    source=source,
                    amount_field="dealDetail",
                    unit_field="金额文本显式单位",
                ) for pair in matching_pairs],
                area_sqm,
                require_all=True,
            )
        else:
            text_meta = None
        if text_meta and raw_deal_decimal is None:
            return _cross_check_detail_price(detail, text_meta, area_sqm, source, raw_deal)
        if text_meta and is_price_resolved(text_meta):
            text_meta["rawAmount"] = raw_deal
            text_meta["amountField"] = "dealPrice"
            text_meta["source"] = source
            return _cross_check_detail_price(detail, text_meta, area_sqm, source, raw_deal)
        matching_unknown = [
            pair for pair in unknown_text_pairs
            if raw_deal_decimal is None or _decimal(pair["amount"]) == raw_deal_decimal
        ]
        if matching_unknown:
            unknown_meta = [normalize_land_price(
                pair["amount"], pair["unit"], area_sqm,
                source=source, amount_field="dealDetail", unit_field="金额文本显式单位",
            ) for pair in matching_unknown]
            return merge_price_candidates(unknown_meta, area_sqm, require_all=True)

    unit = _first_present(detail, ("dealPriceUnit", "dealUnit", "dealPriceUnitName", "cjfs"))
    if _is_present(raw_deal):
        return normalize_land_price(
            raw_deal,
            unit,
            area_sqm,
            source=source,
            amount_field="dealPrice",
            unit_field="dealPriceUnit",
        )
    return None


def _cross_check_detail_price(
    detail: Dict[str, Any],
    selected: Dict[str, Any],
    area_sqm: Any,
    source: str,
    raw_deal: Any,
) -> Dict[str, Any]:
    """Check redundant explicit detail fields against the selected price pair."""
    if not is_price_resolved(selected):
        return selected
    candidates = [selected]
    raw_deal_decimal = _decimal(raw_deal)
    detail_text = _first_present(detail, ("dealDetail", "成交明细", "成交结果"))
    text_pairs = _price_candidates_from_text(detail_text)
    unsupported_pairs = [
        pair for pair in _unsupported_explicit_pairs(detail_text)
        if raw_deal_decimal is None or _decimal(pair["amount"]) == raw_deal_decimal
    ]
    if unsupported_pairs and raw_deal_decimal is not None:
        unresolved = [normalize_land_price(
            pair["amount"], pair["unit"], area_sqm,
            source=source, amount_field="dealDetail", unit_field="金额文本显式单位",
        ) for pair in unsupported_pairs]
        return _conflict_meta(
            [selected, *unresolved],
            area_sqm,
            "详情成交明细对同一金额给出未支持的单位，无法与其他报价核验，未换算。",
        )
    if text_pairs:
        matching_pairs = [
            pair for pair in text_pairs
            if raw_deal_decimal is None or _decimal(pair["amount"]) == raw_deal_decimal
        ]
        if matching_pairs:
            text_meta = merge_price_candidates(
                [normalize_land_price(
                    pair["amount"],
                    pair["unit"],
                    area_sqm,
                    source=source,
                    amount_field="dealDetail",
                    unit_field="金额文本显式单位",
                ) for pair in matching_pairs],
                area_sqm,
                require_all=True,
            )
            candidates.append(text_meta)
        else:
            selected["detailTextOtherPrices"] = text_pairs
            selected["detailTextNote"] = "详情文本另有明确价格项，但金额不等于dealPrice，未作为成交价拼接。"

    unit = _first_present(detail, ("dealPriceUnit", "dealUnit", "dealPriceUnitName", "cjfs"))
    if raw_deal is not None and _is_present(unit):
        candidates.append(normalize_land_price(
            raw_deal,
            unit,
            area_sqm,
            source=source,
            amount_field="dealPrice",
            unit_field="dealPriceUnit",
        ))
    if len(candidates) == 1:
        return selected
    previous_evidence = list(selected.get("evidence") or [])
    merged = merge_price_candidates(candidates, area_sqm)
    if previous_evidence:
        merged["evidence"] = previous_evidence + [_evidence(candidate) for candidate in candidates[1:]]
    if is_price_resolved(merged) and len(candidates) > 1:
        merged["calculation"] = (merged.get("calculation", "") + "；详情冗余单位字段/金额文本核验一致。")
    return merged


def _resolve_scalar_fields(
    data: Dict[str, Any],
    amount_keys: Iterable[str],
    unit_keys: Iterable[str],
    area_sqm: Any,
    source: str,
) -> Optional[Dict[str, Any]]:
    unit = _first_present(data, unit_keys)
    candidates = []
    for key in amount_keys:
        amount = data.get(key)
        if not _is_present(amount):
            continue
        candidate = normalize_land_price(
            amount,
            unit,
            area_sqm,
            source=source,
            amount_field=key,
            unit_field=next((u for u in unit_keys if _is_present(data.get(u))), ""),
        )
        candidates.append(candidate)
    if not candidates:
        return None
    return merge_price_candidates(candidates, area_sqm, require_all=len(candidates) > 1)


def _first_present(data: Dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        value = data.get(key)
        if _is_present(value):
            return value
    return None


def price_value(meta: Optional[Dict[str, Any]], field: str) -> Any:
    """Return the rounded, display-safe numeric value, preserving zero."""
    if not is_price_resolved(meta):
        return ""
    suffix = "unitPriceYuanSqmDisplay" if field in ("unit", "unitPriceYuanSqm") else "totalPriceWanDisplay"
    value = meta.get(suffix)
    return float(Decimal(value)) if value is not None else ""


def _raw_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def price_provenance_fields(meta: Optional[Dict[str, Any]], label: str) -> Dict[str, str]:
    """Build readable spreadsheet columns while retaining detailed metadata in history."""
    if not meta:
        meta = {
            "verificationStatus": "missing_unit",
            "statusLabel": STATUS_LABELS["missing_unit"],
            "warning": "缺少价格来源和明确单位，未换算。",
        }
    sources = [_source_label(meta)]
    sources.extend(str(value) for value in meta.get("corroboratingSources", []) if value)
    evidence = meta.get("evidence") if meta.get("verificationStatus") == "source_conflict" else []
    raw_amount = _raw_text(meta.get("rawAmount"))
    raw_unit = _raw_text(meta.get("rawUnit"))
    if evidence:
        raw_amount = "；".join(
            f"{_source_label(item)}：{_raw_text(item.get('rawAmount'))}"
            for item in evidence
            if item.get("rawAmount") is not None
        ) or raw_amount
        raw_unit = "；".join(
            f"{_source_label(item)}：{_raw_text(item.get('rawUnit'))}"
            for item in evidence
            if item.get("rawUnit") is not None
        ) or raw_unit
    return {
        f"{label}原始金额": raw_amount,
        f"{label}原始单位": raw_unit,
        f"{label}来源": "；".join(dict.fromkeys(filter(None, sources))) or _raw_text(meta.get("source")),
        f"{label}核验状态": _raw_text(meta.get("statusLabel") or STATUS_LABELS.get(meta.get("verificationStatus"), "待核验")),
        f"{label}换算依据": _raw_text(meta.get("calculation")),
        f"{label}警告": _raw_text(meta.get("warning")),
    }


def legacy_unverified_price_meta(
    displayed_value: Any,
    displayed_total: Any,
    *,
    label: str,
) -> Dict[str, Any]:
    """Describe preserved legacy numbers without reclassifying or recalculating them."""
    return {
        "rawAmount": None,
        "rawUnit": None,
        "source": "旧历史价格列",
        "amountField": "",
        "unitField": "",
        "normalizedUnit": None,
        "inputValueExact": None,
        "totalPriceWanExact": None,
        "totalPriceWanDisplay": None,
        "unitPriceYuanSqmExact": None,
        "unitPriceYuanSqmDisplay": None,
        "verificationStatus": "legacy_unverified",
        "statusLabel": STATUS_LABELS["legacy_unverified"],
        "calculation": "旧历史中的已显示数值原样保留；本次未重算或判断原单位。",
        "warning": f"旧历史{label}缺少本次单位核验元数据；已保留历史显示值，请重新抓取详情复核。",
        "legacyDisplayedValue": displayed_value,
        "legacyDisplayedTotal": displayed_total,
        "evidence": [],
        "corroboratingSources": [],
    }
