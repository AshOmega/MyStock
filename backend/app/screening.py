from datetime import date

from .models import Stock


RISK_WARNING = (
    "Unvalidated research heuristic, not a buy instruction or success probability. "
    "Losses can exceed your 10% tolerance, especially in small-cap stocks."
)


def assess(stock: Stock, today: date):
    reasons = []
    missing = []
    score = 0
    if stock.company_type != "non_financial":
        return {"status": "unsupported_sector", "score": None,
                "reasons": ["Separate financial-sector rules have not been approved."],
                "warning": RISK_WARNING}
    fields = (
        "financial_period", "published_on", "revenue_growth_3y_pct", "eps_growth_3y_pct",
        "roe_pct", "debt_equity", "operating_cash_flow", "net_profit",
        "promoter_pledge_pct", "governance_red_flag", "avg_daily_traded_value",
        "fair_value", "fair_value_date", "fair_value_source", "fair_value_method",
    )
    for field in fields:
        if getattr(stock, field) is None:
            missing.append(field)
    tests = [
        ("Positive 3-year revenue growth", stock.revenue_growth_3y_pct,
         lambda v: v > 0),
        ("Positive 3-year EPS growth", stock.eps_growth_3y_pct, lambda v: v > 0),
        ("ROE at least 15%", stock.roe_pct, lambda v: v >= 15),
        ("Debt/equity at most 1", stock.debt_equity, lambda v: v <= 1),
        ("Positive operating cash flow", stock.operating_cash_flow, lambda v: v > 0),
    ]
    for label, value, check in tests:
        if value is not None:
            passed = check(value)
            score += int(passed)
            reasons.append(f"{'PASS' if passed else 'FAIL'}: {label}")
    if stock.operating_cash_flow is not None and stock.net_profit is not None:
        passed = stock.net_profit > 0 and stock.operating_cash_flow / stock.net_profit >= 0.8
        score += int(passed)
        reasons.append(f"{'PASS' if passed else 'FAIL'}: Positive profit and cash flow/profit at least 0.8")
    blockers = []
    if (today - stock.price_date).days > 7:
        blockers.append("Price is older than 7 calendar days.")
    if stock.financial_period and (today - stock.financial_period).days > 180:
        blockers.append("Financial period is older than 180 days.")
    if stock.published_on and stock.published_on > stock.price_date:
        blockers.append("Financial publication is later than the supplied price date.")
    if stock.fair_value_date and stock.fair_value_date > stock.price_date:
        blockers.append("Fair value date is later than the supplied price date.")
    if stock.fair_value is not None and stock.fair_value <= stock.price:
        blockers.append("Price is not below the user-supplied fair value.")
    if stock.governance_red_flag:
        blockers.append("A governance red flag was reported.")
    if stock.promoter_pledge_pct is not None and stock.promoter_pledge_pct != 0:
        blockers.append("Promoter pledge is not zero.")
    if stock.avg_daily_traded_value is not None and stock.avg_daily_traded_value < 10_000_000:
        blockers.append("Average daily traded value is below INR 1 crore.")
    if score < 5:
        blockers.append("Quality score is below 5 of 6.")
    if missing:
        status = "insufficient_data"
        reasons.append("Missing required data: " + ", ".join(missing))
    elif blockers:
        status = "watchlist"
    else:
        status = "research_candidate"
    return {"status": status, "score": score, "reasons": reasons + blockers,
            "warning": RISK_WARNING}
