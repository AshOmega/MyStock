from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class Stock(InputModel):
    symbol: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9&._-]+$")
    name: str = Field(min_length=1, max_length=200)
    sector: str = Field(min_length=1, max_length=100)
    business: str = Field(min_length=1, max_length=2000)
    company_type: str = Field(pattern=r"^(non_financial|bank|nbfc|insurer)$")
    market_cap_category: str = Field(pattern=r"^(large|mid|small)$")
    price: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    price_date: date
    source: str = Field(min_length=1, max_length=500)
    financial_period: Optional[date] = None
    published_on: Optional[date] = None
    revenue_growth_3y_pct: Optional[float] = None
    eps_growth_3y_pct: Optional[float] = None
    roe_pct: Optional[float] = None
    debt_equity: Optional[float] = Field(default=None, ge=0)
    operating_cash_flow: Optional[float] = None
    net_profit: Optional[float] = None
    promoter_pledge_pct: Optional[float] = Field(default=None, ge=0, le=100)
    governance_red_flag: Optional[bool] = None
    avg_daily_traded_value: Optional[float] = Field(default=None, ge=0)
    fair_value: Optional[Decimal] = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    fair_value_date: Optional[date] = None
    fair_value_source: Optional[str] = Field(default=None, min_length=1, max_length=500)
    fair_value_method: Optional[str] = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def dates_and_values(self):
        today = date.today()
        for key in ("price_date", "financial_period", "published_on", "fair_value_date"):
            value = getattr(self, key)
            if value and value > today:
                raise ValueError(f"{key} cannot be in the future")
        if self.financial_period and self.published_on and self.published_on < self.financial_period:
            raise ValueError("published_on cannot precede financial_period")
        if self.fair_value is not None and not all(
            (self.fair_value_date, self.fair_value_source, self.fair_value_method)
        ):
            raise ValueError("fair value requires a date, source and method")
        return self


class ImportRequest(InputModel):
    csv_text: str = Field(min_length=1, max_length=2_000_000)


class Contribution(InputModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    date: date


class Buy(InputModel):
    symbol: str = Field(min_length=1, max_length=40)
    quantity: int = Field(gt=0, le=1_000_000, strict=True)
    price: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    date: date
