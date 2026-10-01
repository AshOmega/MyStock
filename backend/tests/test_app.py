import csv
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.models import Stock
from app.screening import assess


def record(**changes):
    today = date.today()
    value = {
        "symbol": "TEST&CO", "name": "Example % & ; / company",
        "sector": "industrial", "business": "Synthetic test business; not a real security.",
        "company_type": "non_financial", "market_cap_category": "small",
        "price": "100.00", "price_date": str(today),
        "source": "Test only: /path with space/भारत?x=1&y=2%",
        "financial_period": str(today - timedelta(days=60)),
        "published_on": str(today - timedelta(days=30)),
        "revenue_growth_3y_pct": 10, "eps_growth_3y_pct": 12,
        "roe_pct": 15, "debt_equity": 1, "operating_cash_flow": 80,
        "net_profit": 100, "promoter_pledge_pct": 0,
        "governance_red_flag": False, "avg_daily_traded_value": 10_000_000,
        "fair_value": "120.00", "fair_value_date": str(today),
        "fair_value_source": "User test source % & ; / space भारत",
        "fair_value_method": "Synthetic estimate, not a recommendation.",
    }
    value.update(changes)
    return value


def csv_text(*records):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=main.HEADERS)
    writer.writeheader()
    for item in records:
        writer.writerow({k: ("true" if v else "false") if isinstance(v, bool) else v
                         for k, v in item.items()})
    return output.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.sqlite3")
    with TestClient(main.app, base_url="http://localhost") as client:
        yield client


def import_rows(client, *rows):
    return client.post("/api/import", json={"csv_text": csv_text(*rows)})


def post_buy(client, **changes):
    data = {"symbol": "TEST&CO", "quantity": 100, "price": "100.00",
            "cost": "10.00", "date": str(date.today())}
    data.update(changes)
    return client.post("/api/buys", json=data)


def test_candidate_and_boundaries():
    result = assess(Stock(**record()), date.today())
    assert result["status"] == "research_candidate"
    assert result["score"] == 6
    assert assess(Stock(**record(roe_pct=14.99)), date.today())["score"] == 5
    assert assess(Stock(**record(roe_pct=14.99, eps_growth_3y_pct=0)), date.today())["status"] == "watchlist"
    for age in (0, 7):
        assert assess(Stock(**record(price_date=str(date.today() - timedelta(days=age)),
                                     fair_value_date=str(date.today() - timedelta(days=age)))),
                      date.today())["status"] == "research_candidate"
    assert assess(Stock(**record(financial_period=str(date.today() - timedelta(days=180)))),
                  date.today())["status"] == "research_candidate"


@pytest.mark.parametrize("changes", [
    {"revenue_growth_3y_pct": 0, "eps_growth_3y_pct": 0},
    {"roe_pct": 14, "debt_equity": 1.01},
    {"operating_cash_flow": -1, "net_profit": 0},
    {"operating_cash_flow": 0, "net_profit": -1},
    {"promoter_pledge_pct": 0.1},
    {"governance_red_flag": True},
    {"avg_daily_traded_value": 9_999_999},
    {"fair_value": "100.00"}, {"fair_value": "99.00"},
    {"price_date": str(date.today() - timedelta(days=8)),
     "fair_value_date": str(date.today() - timedelta(days=8))},
    {"financial_period": str(date.today() - timedelta(days=181))},
    {"price_date": str(date.today() - timedelta(days=1))},
    {"price_date": str(date.today() - timedelta(days=1)),
     "fair_value_date": str(date.today() - timedelta(days=1)),
     "published_on": str(date.today())},
])
def test_watchlist_gates(changes):
    assert assess(Stock(**record(**changes)), date.today())["status"] == "watchlist"


@pytest.mark.parametrize("field", [
    "financial_period", "published_on", "revenue_growth_3y_pct", "eps_growth_3y_pct",
    "roe_pct", "debt_equity", "operating_cash_flow", "net_profit",
    "promoter_pledge_pct", "governance_red_flag", "avg_daily_traded_value", "fair_value",
])
def test_missing_data(field):
    changes = {field: None}
    if field == "fair_value":
        changes.update(fair_value_date=None, fair_value_source=None, fair_value_method=None)
    result = assess(Stock(**record(**changes)), date.today())
    assert result["status"] == "insufficient_data"


@pytest.mark.parametrize("kind", ["bank", "nbfc", "insurer"])
def test_unsupported(kind):
    result = assess(Stock(**record(company_type=kind)), date.today())
    assert result["status"] == "unsupported_sector"
    assert result["score"] is None


@pytest.mark.parametrize("changes", [
    {"price": "0"}, {"price": "NaN"}, {"price": "1.001"},
    {"roe_pct": float("inf")}, {"eps_growth_3y_pct": float("nan")},
    {"debt_equity": -1}, {"promoter_pledge_pct": 101},
    {"fair_value_source": ""}, {"fair_value_method": None}, {"fair_value_date": None},
    {"price_date": str(date.today() + timedelta(days=1))},
    {"financial_period": str(date.today() + timedelta(days=1))},
    {"published_on": str(date.today() + timedelta(days=1))},
    {"fair_value_date": str(date.today() + timedelta(days=1))},
    {"financial_period": str(date.today()), "published_on": str(date.today() - timedelta(days=1))},
    {"symbol": "ABC; DROP TABLE snapshots"},
    {"unknown": "x"},
])
def test_model_rejects_invalid(changes):
    with pytest.raises(ValidationError):
        Stock(**record(**changes))


def test_import_roundtrip_and_history(client):
    original = record(name='Name, "quoted" % & ; / भारत')
    assert import_rows(client, original).status_code == 200
    rows = client.get("/api/stocks").json()
    assert rows[0]["source"] == original["source"]
    assert rows[0]["name"] == original["name"]
    assert rows[0]["assessment"]["status"] == "research_candidate"
    assert import_rows(client, record(price="101.00")).status_code == 200
    with main.db() as connection:
        assert connection.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 2
    assert client.get("/api/stocks").json()[0]["price"] == "101.00"


def test_atomic_import_and_duplicate_symbols(client):
    response = import_rows(client, record(), record(symbol="OTHER", price="-1"))
    assert response.status_code == 422
    assert client.get("/api/stocks").json() == []
    assert import_rows(client, record(), record(symbol="test&co")).status_code == 422
    assert client.get("/api/stocks").json() == []


@pytest.mark.parametrize("text", [
    "", "symbol,symbol\nX,X\n", "unknown\nx\n", ",".join(main.HEADERS) + "\n",
    ",".join(main.HEADERS) + "\nX,Y\n",
    csv_text(record()).replace("false", "yes"),
    '"unterminated header', csv_text(record()).rstrip() + ',"unterminated',
])
def test_bad_csv(client, text):
    assert client.post("/api/import", json={"csv_text": text}).status_code == 422


def test_import_limits_and_rollback(client):
    assert import_rows(client, *(record(symbol=f"S{i}") for i in range(1001))).status_code == 422
    assert client.get("/api/stocks").json() == []
    assert import_rows(client, record()).status_code == 200
    assert import_rows(client, record(price_date=str(date.today() - timedelta(days=1)),
                                    fair_value_date=str(date.today() - timedelta(days=1)))).status_code == 422
    assert import_rows(client, record(sector="new sector")).status_code == 422
    assert import_rows(client, record(financial_period=str(date.today() - timedelta(days=61)))).status_code == 422
    assert client.get("/api/stocks").json()[0]["sector"] == "industrial"


def test_blank_fields_and_sector_normalisation(client):
    assert import_rows(client, record(sector=" INDUSTRIAL ", fair_value=None,
                                     fair_value_date=None, fair_value_source=None,
                                     fair_value_method=None)).status_code == 200
    result = client.get("/api/stocks").json()[0]
    assert result["sector"] == "industrial"
    assert result["assessment"]["status"] == "insufficient_data"


def test_buy_and_contribution_accounting(client):
    assert client.get("/api/portfolio").json()["cash"] == 300_000
    assert import_rows(client, record()).status_code == 200
    assert post_buy(client).status_code == 200
    state = client.get("/api/portfolio").json()
    assert state["cash"] == 289_990
    assert state["total_value"] == 299_990
    assert state["unrealised_pnl"] == -10
    assert state["positions"][0]["cost_basis"] == 10_010
    assert client.post("/api/contributions", json={"amount": "50000.00", "date": str(date.today())}).status_code == 200
    state = client.get("/api/portfolio").json()
    assert state["cash"] == 339_990
    assert state["total_value"] == 349_990
    assert state["unrealised_pnl"] == -10
    assert client.post("/api/contributions", json={"amount": "0.01", "date": str(date.today())}).status_code == 422


def test_stock_limit_boundary_and_zero_cost(client):
    assert import_rows(client, record()).status_code == 200
    response = post_buy(client, quantity=300, cost="0")
    assert response.status_code == 200
    assert "Zero" in response.json()["warning"]
    assert post_buy(client, quantity=1).status_code == 422
    assert len(client.get("/api/portfolio").json()["events"]) == 1


def test_costs_in_exposure_limit(client):
    assert import_rows(client, record()).status_code == 200
    assert post_buy(client, quantity=300, cost="1").status_code == 422


def test_sector_limit_and_cash(client):
    assert import_rows(client, record(), record(symbol="SECOND"), record(symbol="THIRD")).status_code == 200
    assert post_buy(client, quantity=300, cost="0").status_code == 200
    assert post_buy(client, symbol="SECOND", quantity=300, cost="0").status_code == 200
    assert post_buy(client, symbol="THIRD", quantity=151, cost="0").status_code == 422
    assert post_buy(client, symbol="THIRD", quantity=150, cost="0").status_code == 200
    assert post_buy(client, quantity=1, price="400000").status_code == 422


@pytest.mark.parametrize("changes", [
    {"quantity": 0}, {"quantity": 1.5}, {"quantity": True}, {"cost": "-1"}, {"cost": "0.001"},
    {"date": str(date.today() - timedelta(days=1))},
    {"date": str(date.today() + timedelta(days=1))}, {"symbol": "MISSING"},
])
def test_reject_invalid_buys(client, changes):
    assert import_rows(client, record()).status_code == 200
    assert post_buy(client, **changes).status_code == 422
    assert client.get("/api/portfolio").json()["events"] == []


def test_candidate_requirement(client):
    assert import_rows(client, record(governance_red_flag=True)).status_code == 200
    assert post_buy(client).status_code == 422


def test_stale_position_blocks_new_buy(client):
    assert import_rows(client, record(), record(symbol="OTHER")).status_code == 200
    assert post_buy(client).status_code == 200
    with main.db() as connection:
        value = record(price_date=str(date.today() - timedelta(days=8)),
                       fair_value_date=str(date.today() - timedelta(days=8)))
        connection.execute("INSERT INTO snapshots(symbol,payload) VALUES (?,?)",
                           ("TEST&CO", Stock(**value).model_dump_json()))
    state = client.get("/api/portfolio").json()
    assert state["total_value"] is None
    assert state["unrealised_pnl"] is None
    assert state["valuation_issues"]
    assert post_buy(client, symbol="OTHER").status_code == 422


def test_price_drift_flagged_not_sold(client):
    assert import_rows(client, record()).status_code == 200
    assert post_buy(client, quantity=300, cost="0").status_code == 200
    assert import_rows(client, record(price="300.00")).status_code == 200
    state = client.get("/api/portfolio").json()
    assert state["positions"][0]["quantity"] == 300
    assert len(state["exposure_warnings"]) == 1
    assert state["total_value"] == 360_000
    assert import_rows(client, record(price="400.00")).status_code == 200
    assert len(client.get("/api/portfolio").json()["exposure_warnings"]) == 2


def test_host_protection_and_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/health", headers={"host": "attacker.example"}).status_code == 400
    assert client.get("/api/template").text.startswith("symbol,name,sector,")


def test_contribution_validity_and_persistence(client):
    for amount in ("0", "-1", "NaN", "50000.01", "0.001"):
        assert client.post("/api/contributions", json={"amount": amount, "date": str(date.today())}).status_code == 422
    assert client.post("/api/contributions", json={
        "amount": "1", "date": str(date.today() - timedelta(days=1))}).status_code == 422
    assert client.post("/api/contributions", json={"amount": "0.01", "date": str(date.today())}).status_code == 200
    with TestClient(main.app, base_url="http://localhost") as another:
        assert another.get("/api/portfolio").json()["cash"] == 300_000.01


def test_sql_and_json_characters_survive(client):
    text = "'; DROP TABLE ledger; -- % & / space भारत"
    assert import_rows(client, record(business=text, fair_value_method=text)).status_code == 200
    assert client.get("/api/stocks").json()[0]["business"] == text
    assert client.get("/api/portfolio").status_code == 200


def test_concurrent_contributions_preserve_monthly_limit(client):
    assert client.get("/api/health").status_code == 200
    payload = {"amount": "30000.00", "date": str(date.today())}
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: client.post("/api/contributions", json=payload).status_code, range(2)))
    assert sorted(statuses) == [200, 422]
    assert client.get("/api/portfolio").json()["contributions"] == 30_000


def test_missing_position_price_blocks_valuation(client):
    assert import_rows(client, record(), record(symbol="OTHER")).status_code == 200
    assert post_buy(client).status_code == 200
    with main.db() as connection:
        connection.execute("DELETE FROM snapshots WHERE symbol=?", ("TEST&CO",))
    state = client.get("/api/portfolio").json()
    assert state["total_value"] is None
    assert state["positions"][0]["value"] is None
    assert post_buy(client, symbol="OTHER").status_code == 422
