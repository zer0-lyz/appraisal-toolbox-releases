from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Literal


AssetKind = Literal["存量", "新增"]
DepreciationKind = Literal["折旧", "摊销"]

METRICS = (
    "折旧摊销",
    "追加资本性支出",
    "更新资本性支出",
    "资本性支出",
    "更新支出进项税",
    "残值回收",
    "残值回收销项税",
)


def money(value: float) -> float:
    """The prototype workbook uses Excel's precision-as-displayed setting."""
    return round(value + 0.0, 2)


def as_date(value: date | datetime) -> date:
    return value.date() if isinstance(value, datetime) else value


def eomonth(value: date | datetime, months: int = 0) -> date:
    value = as_date(value)
    month_index = value.year * 12 + value.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, calendar.monthrange(year, month)[1])


def completed_months(start: date | datetime, end: date | datetime) -> int:
    """Match Excel's month-boundary logic used by the prototype workbook."""
    start = as_date(start)
    end = as_date(end)
    months = (end.year - start.year) * 12 + end.month - start.month
    return months - (1 if end.day < start.day else 0)


def datedif_months(start: date | datetime, end: date | datetime) -> int:
    start = as_date(start)
    end = as_date(end)
    if end < start:
        raise ValueError(f"结束日期 {end} 早于起始日期 {start}")
    return completed_months(start, end)


def month_ends_after(start: date, end: date) -> list[date]:
    cursor = eomonth(start, 1)
    values: list[date] = []
    while cursor <= end:
        values.append(cursor)
        cursor = eomonth(cursor, 1)
    return values


def annuity_value(monthly_amount: float, months: int, monthly_rate: float, annual_rate: float) -> float:
    if monthly_amount == 0 or months <= 0:
        return 0.0
    if monthly_rate == 0:
        return monthly_amount * months
    return monthly_amount * (1 - (1 + monthly_rate) ** (-months)) / monthly_rate * annual_rate


def replacement_depreciation_annuity(
    monthly_amount: float,
    depreciation_months: int,
    economic_months: int,
    prior_used_months: int,
    monthly_rate: float,
    annual_rate: float,
) -> float:
    if monthly_amount == 0 or depreciation_months <= 0 or economic_months <= 0:
        return 0.0
    if monthly_rate == 0:
        return monthly_amount * depreciation_months / economic_months * 12
    pv_depreciation = monthly_amount * (1 - (1 + monthly_rate) ** (-depreciation_months)) / monthly_rate
    chain_payment = pv_depreciation * monthly_rate / (1 - (1 + monthly_rate) ** (-economic_months))
    return chain_payment / monthly_rate * annual_rate / (1 + monthly_rate) ** (
        economic_months - prior_used_months
    )


def replacement_annuity(amount: float, annual_rate: float, prior_used_months: int, economic_months: int) -> float:
    if amount == 0 or economic_months <= 0:
        return 0.0
    if annual_rate == 0:
        return amount * 12 / economic_months
    return amount * annual_rate * (1 + annual_rate) ** (prior_used_months / 12) / (
        (1 + annual_rate) ** (economic_months / 12) - 1
    )


@dataclass
class ForecastParams:
    valuation_date: date
    end_date: date
    discount_rate: float
    minimum_remaining_years: float = 1.0

    @property
    def monthly_discount_rate(self) -> float:
        return round((1 + self.discount_rate) ** (1 / 12) - 1, 6)

    @property
    def years(self) -> list[int]:
        return list(range(self.valuation_date.year, self.end_date.year + 1))


@dataclass
class StockAsset:
    asset_id: str
    company: str
    account: str
    name: str
    original_cost: float
    net_book_value: float
    appraised_original_value: float
    in_service_date: date
    depreciation_years: float
    economic_years: float
    expected_remaining_years: float
    renewed_depreciation_years: float
    renewed_economic_years: float
    salvage_rate: float
    expense_account: str
    depreciation_kind: DepreciationKind
    input_tax_rate: float
    renew: bool
    scenario: str = ""


@dataclass
class AddedAsset:
    asset_id: str
    company: str
    account: str
    name: str
    construction_book_value: float
    total_investment: float
    in_service_date: date
    renewed_depreciation_years: float
    renewed_economic_years: float
    salvage_rate: float
    expense_account: str
    depreciation_kind: DepreciationKind
    input_tax_rate: float
    renew: bool
    scenario: str = ""


@dataclass
class MonthlyValue:
    month: date
    depreciation: float = 0.0
    added_capex: float = 0.0
    renewal_capex: float = 0.0
    input_tax: float = 0.0
    salvage_recovery: float = 0.0
    output_tax: float = 0.0


@dataclass
class AssetForecast:
    asset_kind: AssetKind
    asset_id: str
    company: str
    account: str
    name: str
    expense_account: str
    scenario: str
    monthly: dict[date, MonthlyValue]
    perpetual: dict[str, float]
    debug: dict[str, float | int | str | bool | date] = field(default_factory=dict)


@dataclass
class ForecastResult:
    params: ForecastParams
    assets: list[AssetForecast]
    warnings: list[str] = field(default_factory=list)

    def annual_totals(self) -> dict[tuple[str, int], float]:
        result: dict[tuple[str, int], float] = defaultdict(float)
        for asset in self.assets:
            for value in asset.monthly.values():
                result["折旧摊销", value.month.year] += value.depreciation
                result["追加资本性支出", value.month.year] += value.added_capex
                result["更新资本性支出", value.month.year] += value.renewal_capex
                result["更新支出进项税", value.month.year] += value.input_tax
                result["残值回收", value.month.year] += value.salvage_recovery
                result["残值回收销项税", value.month.year] += value.output_tax
        for year in self.params.years:
            result["资本性支出", year] = result["追加资本性支出", year] + result["更新资本性支出", year]
        return defaultdict(float, {key: money(value) for key, value in result.items()})

    def perpetual_totals(self) -> dict[str, float]:
        result: dict[str, float] = defaultdict(float)
        for asset in self.assets:
            for metric, amount in asset.perpetual.items():
                result[metric] += amount
        result["资本性支出"] = result["追加资本性支出"] + result["更新资本性支出"]
        return defaultdict(float, {key: money(value) for key, value in result.items()})

    def expense_totals(self) -> dict[tuple[str, int | str], float]:
        result: dict[tuple[str, int | str], float] = defaultdict(float)
        for asset in self.assets:
            for value in asset.monthly.values():
                result[asset.expense_account, value.month.year] += value.depreciation
            result[asset.expense_account, "永续期"] += asset.perpetual["折旧摊销"]
        return defaultdict(float, {key: money(value) for key, value in result.items()})


def _value(monthly: dict[date, MonthlyValue], month: date) -> MonthlyValue:
    if month not in monthly:
        monthly[month] = MonthlyValue(month)
    return monthly[month]


def _add_depreciation(
    monthly: dict[date, MonthlyValue], start: date, months: int, amount: float, end_date: date
) -> None:
    if amount == 0:
        return
    if months <= 0:
        first = eomonth(start, 1)
        if first <= end_date:
            _value(monthly, first).depreciation += money(amount)
        return
    for offset in range(months):
        month = eomonth(start, offset)
        if month > end_date:
            break
        _value(monthly, month).depreciation += money(amount)


def forecast_stock(asset: StockAsset, params: ForecastParams) -> AssetForecast:
    monthly: dict[date, MonthlyValue] = {}
    used_months = completed_months(asset.in_service_date, params.valuation_date)
    remaining_useful = (
        int(round(asset.expected_remaining_years * 12))
        if asset.expected_remaining_years > 0
        else max(
            int(round(asset.economic_years * 12)) - used_months,
            int(round(params.minimum_remaining_years * 12)),
        )
    )
    dep_start = eomonth(asset.in_service_date, 1 if asset.depreciation_kind == "折旧" else 0)
    dep_start = min(dep_start, params.end_date)
    used_dep = (
        min(datedif_months(dep_start, params.valuation_date) + 1, int(round(asset.depreciation_years * 12)))
        if dep_start <= params.valuation_date
        else 0
    )
    initial_dep_months = min(
        max(int(round(min(asset.depreciation_years, asset.economic_years) * 12)) - used_dep, 0),
        remaining_useful,
    )
    salvage = asset.original_cost * asset.salvage_rate
    initial_dep_amount = max(asset.net_book_value - salvage, 0)
    initial_monthly_dep = money(initial_dep_amount / initial_dep_months) if initial_dep_months else money(initial_dep_amount)
    first_forecast_month = max(eomonth(params.valuation_date, 1), dep_start)
    _add_depreciation(monthly, first_forecast_month, initial_dep_months, initial_monthly_dep, params.end_date)

    renewed_dep_months = int(round(min(asset.renewed_depreciation_years, asset.renewed_economic_years) * 12))
    renewed_economic_months = int(round(asset.renewed_economic_years * 12))
    renewed_salvage = asset.appraised_original_value * asset.salvage_rate if asset.renew else 0.0
    renewed_dep_amount = asset.appraised_original_value - renewed_salvage if asset.renew else 0.0
    renewed_monthly_dep = money(renewed_dep_amount / renewed_dep_months) if renewed_dep_months else 0.0
    renewal_date = eomonth(params.valuation_date, remaining_useful)
    if renewal_date <= params.end_date:
        target = _value(monthly, renewal_date)
        target.renewal_capex += money((asset.appraised_original_value if asset.renew else 0.0) - salvage)
        target.input_tax += money(asset.appraised_original_value * asset.input_tax_rate) if asset.renew else 0.0
        target.salvage_recovery += money(salvage)
        target.output_tax += money(salvage * asset.input_tax_rate)
        if asset.renew:
            start = eomonth(renewal_date, 1 if asset.depreciation_kind == "折旧" else 0)
            _add_depreciation(monthly, start, renewed_dep_months, renewed_monthly_dep, params.end_date)
            renewal_date = eomonth(renewal_date, renewed_economic_months)
            while renewal_date <= params.end_date:
                target = _value(monthly, renewal_date)
                target.renewal_capex += money(asset.appraised_original_value - renewed_salvage)
                target.input_tax += money(asset.appraised_original_value * asset.input_tax_rate)
                target.salvage_recovery += money(renewed_salvage)
                target.output_tax += money(renewed_salvage * asset.input_tax_rate)
                start = eomonth(renewal_date, 1 if asset.depreciation_kind == "折旧" else 0)
                _add_depreciation(monthly, start, renewed_dep_months, renewed_monthly_dep, params.end_date)
                renewal_date = eomonth(renewal_date, renewed_economic_months)

    total_months = datedif_months(params.valuation_date, params.end_date)
    prior_used = (
        (total_months - remaining_useful) % renewed_economic_months
        if asset.renew and renewed_economic_months
        else datedif_months(asset.in_service_date, params.end_date)
    )
    used_dep_perpetual = min(prior_used if asset.depreciation_kind == "折旧" else prior_used + 1, renewed_dep_months)
    remaining_dep = renewed_dep_months - used_dep_perpetual
    perpetual_monthly_dep = initial_monthly_dep if eomonth(params.valuation_date, remaining_useful) > params.end_date else renewed_monthly_dep
    mr = params.monthly_discount_rate
    depreciation_perpetual = money(annuity_value(perpetual_monthly_dep, remaining_dep, mr, params.discount_rate))
    if asset.renew:
        depreciation_perpetual += money(replacement_depreciation_annuity(
            renewed_monthly_dep,
            renewed_dep_months,
            renewed_economic_months,
            prior_used,
            mr,
            params.discount_rate,
        ))
    renewal_annuity = (
        replacement_annuity(asset.appraised_original_value, params.discount_rate, prior_used, renewed_economic_months)
        if asset.renew
        else 0.0
    )
    renewal_annuity = money(renewal_annuity)
    salvage_annuity = money(renewal_annuity * asset.salvage_rate)
    perpetual = {
        "折旧摊销": money(depreciation_perpetual),
        "追加资本性支出": 0.0,
        "更新资本性支出": money(renewal_annuity - salvage_annuity),
        "更新支出进项税": money(renewal_annuity * asset.input_tax_rate),
        "残值回收": salvage_annuity,
        "残值回收销项税": money(salvage_annuity * asset.input_tax_rate),
    }
    debug = {
        "账面原值": asset.original_cost,
        "账面净值": asset.net_book_value,
        "评估原值": asset.appraised_original_value,
        "启用时间": asset.in_service_date,
        "折旧年限": asset.depreciation_years,
        "经济耐用年限": asset.economic_years,
        "预计尚可使用年限": asset.expected_remaining_years,
        "更新后折旧年限": asset.renewed_depreciation_years,
        "更新后经济耐用年限": asset.renewed_economic_years,
        "残值率": asset.salvage_rate,
        "折旧摊销方式": asset.depreciation_kind,
        "进项税率": asset.input_tax_rate,
        "是否需要更新": asset.renew,
        "已使用月份": used_months,
        "剩余尚可使用月份": remaining_useful,
        "初始折旧月数": initial_dep_months,
        "初始每月折旧": initial_monthly_dep,
        "折旧开始月": dep_start,
        "残值": salvage,
        "更新折旧月数": renewed_dep_months,
        "更新后每月折旧": renewed_monthly_dep,
        "更新节点": renewal_date if renewal_date <= params.end_date else None,
        "永续期月折现率": mr,
        "永续期折旧": depreciation_perpetual,
        "永续期更新资本性支出": perpetual["更新资本性支出"],
        "永续期进项税": perpetual["更新支出进项税"],
        "永续期残值回收": perpetual["残值回收"],
    }
    return AssetForecast("存量", asset.asset_id, asset.company, asset.account, asset.name, asset.expense_account, asset.scenario, monthly, perpetual, debug)


def forecast_added(asset: AddedAsset, params: ForecastParams) -> AssetForecast:
    monthly: dict[date, MonthlyValue] = {}
    in_service_month = eomonth(asset.in_service_date, 0)
    initial_addition = max(asset.total_investment - asset.construction_book_value, 0)
    if params.valuation_date < in_service_month <= params.end_date:
        target = _value(monthly, in_service_month)
        target.added_capex += money(initial_addition)
        target.input_tax += money(initial_addition * asset.input_tax_rate)

    dep_months = int(round(min(asset.renewed_depreciation_years, asset.renewed_economic_years) * 12))
    economic_months = int(round(asset.renewed_economic_years * 12))
    salvage = asset.total_investment * asset.salvage_rate
    monthly_dep = money((asset.total_investment - salvage) / dep_months) if dep_months else 0.0
    dep_start = eomonth(in_service_month, 1 if asset.depreciation_kind == "折旧" else 0)
    _add_depreciation(monthly, dep_start, dep_months, monthly_dep, params.end_date)

    renewal_date = eomonth(in_service_month, economic_months)
    while asset.renew and renewal_date <= params.end_date:
        target = _value(monthly, renewal_date)
        target.renewal_capex += money(asset.total_investment - salvage)
        target.input_tax += money(asset.total_investment * asset.input_tax_rate)
        target.salvage_recovery += money(salvage)
        target.output_tax += money(salvage * asset.input_tax_rate)
        dep_start = eomonth(renewal_date, 1 if asset.depreciation_kind == "折旧" else 0)
        _add_depreciation(monthly, dep_start, dep_months, monthly_dep, params.end_date)
        renewal_date = eomonth(renewal_date, economic_months)

    used_months = completed_months(asset.in_service_date, params.valuation_date)
    remaining_useful = economic_months - used_months
    total_months = datedif_months(params.valuation_date, params.end_date)
    prior_used = (
        (total_months - remaining_useful) % economic_months
        if asset.renew and economic_months
        else datedif_months(in_service_month, params.end_date)
    )
    used_dep_perpetual = min(prior_used if asset.depreciation_kind == "折旧" else prior_used + 1, dep_months)
    remaining_dep = dep_months - used_dep_perpetual
    mr = params.monthly_discount_rate
    depreciation_perpetual = money(annuity_value(monthly_dep, remaining_dep, mr, params.discount_rate))
    if asset.renew:
        depreciation_perpetual += money(replacement_depreciation_annuity(
            monthly_dep, dep_months, economic_months, prior_used, mr, params.discount_rate
        ))
    renewal_annuity = (
        replacement_annuity(asset.total_investment, params.discount_rate, prior_used, economic_months)
        if asset.renew
        else 0.0
    )
    renewal_annuity = money(renewal_annuity)
    salvage_annuity = money(renewal_annuity * asset.salvage_rate)
    perpetual = {
        "折旧摊销": money(depreciation_perpetual),
        "追加资本性支出": 0.0,
        "更新资本性支出": money(renewal_annuity - salvage_annuity),
        "更新支出进项税": money(renewal_annuity * asset.input_tax_rate),
        "残值回收": salvage_annuity,
        "残值回收销项税": money(salvage_annuity * asset.input_tax_rate),
    }
    debug = {
        "在建工程账面价值": asset.construction_book_value,
        "总投资额": asset.total_investment,
        "预计投入使用时间": asset.in_service_date,
        "更新后折旧年限": asset.renewed_depreciation_years,
        "更新后经济耐用年限": asset.renewed_economic_years,
        "残值率": asset.salvage_rate,
        "折旧摊销方式": asset.depreciation_kind,
        "进项税率": asset.input_tax_rate,
        "是否需要更新": asset.renew,
        "投入使用月": in_service_month,
        "追加资本性支出": initial_addition,
        "折旧月数": dep_months,
        "每月折旧": monthly_dep,
        "经济耐用月数": economic_months,
        "残值": salvage,
        "更新节点": renewal_date if renewal_date <= params.end_date else None,
        "剩余尚可使用月份": remaining_useful,
        "永续期月折现率": mr,
        "永续期折旧": depreciation_perpetual,
        "永续期更新资本性支出": perpetual["更新资本性支出"],
        "永续期进项税": perpetual["更新支出进项税"],
        "永续期残值回收": perpetual["残值回收"],
    }
    return AssetForecast("新增", asset.asset_id, asset.company, asset.account, asset.name, asset.expense_account, asset.scenario, monthly, perpetual, debug)


def forecast_portfolio(
    params: ForecastParams,
    stock_assets: Iterable[StockAsset],
    added_assets: Iterable[AddedAsset],
) -> ForecastResult:
    assets = [forecast_stock(asset, params) for asset in stock_assets]
    assets.extend(forecast_added(asset, params) for asset in added_assets)
    return ForecastResult(params, assets)
