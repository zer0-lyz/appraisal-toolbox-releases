"""Depreciation, amortization and capital expenditure forecast tool."""

from .model import (
    AddedAsset,
    ForecastParams,
    ForecastResult,
    StockAsset,
    forecast_portfolio,
)

__all__ = [
    "AddedAsset",
    "ForecastParams",
    "ForecastResult",
    "StockAsset",
    "forecast_portfolio",
]
