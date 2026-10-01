import csv
import io
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse, Response
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool

from .models import Buy, Contribution, ImportRequest, Stock
from .screening import assess
from .evidence import (
    WorkbookConfirmation, ChartConfirmation, company_key, workbook_extract,
    chart_extract, financial_assessment, chart_assessment,
)


DB_PATH = Path(os.environ.get("MYSTOCK_DB", str(Path(__file__).resolve().parents[2] / "data" / "mystock.sqlite3")))
app = FastAPI(title="MyStock", version="0.1.0")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"])
HEADERS = list(Stock.model_fields)


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DB_PATH), timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL,
                imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL, event_date TEXT NOT NULL,
                symbol TEXT, quantity INTEGER, price_paise INTEGER,
                cost_paise INTEGER NOT NULL DEFAULT 0, amount_paise INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS equities (
                symbol TEXT PRIMARY KEY, company TEXT NOT NULL, company_key TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS companies (
                id INTEGER PRIMARY KEY, company TEXT NOT NULL,
                company_key TEXT NOT NULL UNIQUE, symbol TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS evidence (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL, symbol TEXT,
                company_id INTEGER REFERENCES companies(id),
                filename TEXT NOT NULL, content BLOB NOT NULL, payload TEXT NOT NULL,
                confirmation TEXT, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                confirmed_at TEXT
            );
        """)
        if "company_id" not in {row["name"] for row in connection.execute("PRAGMA table_info(evidence)")}:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("ALTER TABLE evidence ADD COLUMN company_id INTEGER REFERENCES companies(id)")
            connection.execute("""
                INSERT INTO companies(company,company_key,symbol)
                SELECT company,company_key,symbol FROM equities
            """)
            connection.execute("""
                UPDATE evidence SET company_id=(SELECT id FROM companies WHERE companies.symbol=evidence.symbol)
                WHERE symbol IS NOT NULL
            """)
            connection.commit()
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def paise(value):
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def rupees(value):
    return value / 100


def latest(connection):
    rows = connection.execute("""
        SELECT payload FROM snapshots WHERE id IN
        (SELECT MAX(id) FROM snapshots GROUP BY symbol)
    """).fetchall()
    return {s.symbol: s for s in (Stock.model_validate_json(row["payload"]) for row in rows)}


def portfolio(connection, stocks):
    cash = 30_000_000
    quantities = {}
    basis = {}
    contributions = 0
    total_costs = 0
    events = connection.execute("SELECT * FROM ledger ORDER BY id").fetchall()
    for event in events:
        if event["kind"] == "contribution":
            cash += event["amount_paise"]
            contributions += event["amount_paise"]
        else:
            cash -= event["amount_paise"]
            symbol = event["symbol"]
            quantities[symbol] = quantities.get(symbol, 0) + event["quantity"]
            basis[symbol] = basis.get(symbol, 0) + event["amount_paise"]
            total_costs += event["cost_paise"]
    positions = []
    stock_values = {}
    issues = []
    exposure_warnings = []
    total = cash
    sectors = {}
    for symbol, quantity in quantities.items():
        stock = stocks.get(symbol)
        if stock is None or (date.today() - stock.price_date).days > 7:
            issues.append(f"Missing or stale current price for {symbol}.")
        value = paise(stock.price) * quantity if stock else None
        if value is not None:
            total += value
            stock_values[symbol] = value
            sectors[stock.sector] = sectors.get(stock.sector, 0) + value
        positions.append({
            "symbol": symbol, "quantity": quantity,
            "sector": stock.sector if stock else None,
            "price_date": str(stock.price_date) if stock else None,
            "value": rupees(value) if value is not None else None,
            "cost_basis": rupees(basis[symbol]),
            "unrealised_pnl": rupees(value - basis[symbol]) if value is not None else None,
        })
    if not issues and total > 0:
        for symbol, value in stock_values.items():
            if value * 10 > total:
                exposure_warnings.append(f"{symbol} exceeds the 10% stock limit after price changes.")
        for sector, value in sectors.items():
            if value * 4 > total:
                exposure_warnings.append(f"{sector} exceeds the 25% sector limit after price changes.")
    return {
        "cash": rupees(cash), "contributions": rupees(contributions),
        "total_costs": rupees(total_costs), "positions": positions,
        "total_value": None if issues else rupees(total),
        "unrealised_pnl": None if issues else rupees(total - 30_000_000 - contributions),
        "valuation_issues": issues, "exposure_warnings": exposure_warnings,
        "benchmark": "Nifty 500 TRI",
        "benchmark_comparison": "Unavailable: no dated index series or validated cash-flow-aware comparison.",
        "events": [dict(e) for e in events],
        "_cash": cash, "_total": total, "_sectors": sectors, "_stock_values": stock_values,
    }


@app.get("/api/health")
def health():
    with db() as connection:
        connection.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/template", response_class=PlainTextResponse)
def template():
    return ",".join(HEADERS) + "\n"


@app.post("/api/import")
def import_csv(request: ImportRequest):
    reader = csv.DictReader(io.StringIO(request.csv_text, newline=""), strict=True)
    try:
        headers = reader.fieldnames
    except csv.Error as error:
        raise HTTPException(422, f"Malformed CSV header: {error}") from error
    if not headers or len(headers) != len(set(headers)):
        raise HTTPException(422, "CSV needs unique column names.")
    unknown = set(headers) - set(HEADERS)
    required = {name for name, field in Stock.model_fields.items() if field.is_required()}
    if unknown or not required.issubset(headers):
        raise HTTPException(422, f"Unknown columns: {sorted(unknown)}; missing columns: {sorted(required - set(headers))}")
    records = []
    errors = []
    seen = set()
    try:
        for line, row in enumerate(reader, 2):
            if line > 1001:
                raise HTTPException(422, "Maximum 1,000 stock rows per import.")
            if None in row or any(v is None for v in row.values()):
                errors.append(f"Row {line}: column count does not match header.")
                continue
            cleaned = {k: (v.strip() or None) for k, v in row.items()}
            if cleaned.get("symbol"):
                cleaned["symbol"] = cleaned["symbol"].upper()
            if cleaned.get("sector"):
                cleaned["sector"] = cleaned["sector"].casefold()
            flag = cleaned.get("governance_red_flag")
            if flag is not None and flag not in ("true", "false"):
                errors.append(f"Row {line}: governance_red_flag must be true, false or blank.")
                continue
            try:
                stock = Stock.model_validate(cleaned)
                if stock.symbol in seen:
                    errors.append(f"Row {line}: duplicate symbol {stock.symbol}.")
                seen.add(stock.symbol)
                records.append(stock)
            except ValidationError as error:
                errors.append(f"Row {line}: " + "; ".join(
                    f"{'.'.join(str(x) for x in e['loc'])}: {e['msg']}" for e in error.errors()
                ))
    except csv.Error as error:
        raise HTTPException(422, f"Malformed CSV: {error}") from error
    if not records and not errors:
        errors.append("CSV contains no stock rows.")
    if errors:
        raise HTTPException(422, errors[:30])
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        current = latest(connection)
        for stock in records:
            identity = connection.execute("SELECT company_key FROM companies WHERE symbol=?", (stock.symbol,)).fetchone()
            if identity and identity["company_key"] != company_key(stock.name):
                raise HTTPException(422, f"{stock.symbol}: company does not match confirmed workbook identity.")
            old = current.get(stock.symbol)
            if old and (stock.price_date < old.price_date or (
                old.financial_period and stock.financial_period and stock.financial_period < old.financial_period
            )):
                raise HTTPException(422, f"{stock.symbol}: import would replace newer data with older data.")
            if old and old.sector != stock.sector:
                raise HTTPException(422, f"{stock.symbol}: sector changes require review; use the existing sector.")
        connection.executemany("INSERT INTO snapshots(symbol,payload) VALUES (?,?)",
                               [(s.symbol, s.model_dump_json()) for s in records])
    return {"imported": len(records), "message": "All rows validated and saved atomically."}


@app.post("/api/evidence/preview/{kind}")
async def evidence_preview(kind: str, file: UploadFile = File(...)):
    if kind not in ("workbook", "chart"):
        raise HTTPException(422, "Evidence kind must be workbook or chart.")
    content = await file.read(10_000_001)
    await file.close()
    if len(content) > 10_000_000:
        raise HTTPException(422, "Evidence upload exceeds 10 MB.")
    try:
        payload = await run_in_threadpool(workbook_extract if kind == "workbook" else chart_extract, content)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    filename = Path(file.filename or "upload").name
    with db() as connection:
        suggested_company = None
        if kind == "chart":
            chart_company = payload["suggestions"].get("company")
            if chart_company:
                match = connection.execute("SELECT id FROM companies WHERE company_key=?",
                                           (company_key(chart_company),)).fetchone()
                suggested_company = match["id"] if match else None
        cursor = connection.execute(
            "INSERT INTO evidence(kind,filename,content,payload) VALUES (?,?,?,?)",
            (kind, filename, content, json.dumps(payload, allow_nan=False)),
        )
        evidence_id = cursor.lastrowid
    return {"id": evidence_id, "kind": kind, "filename": filename, "payload": payload,
            "suggested_company_id": suggested_company}


def draft(connection, evidence_id, kind):
    row = connection.execute("SELECT * FROM evidence WHERE id=?", (evidence_id,)).fetchone()
    if not row or row["kind"] != kind:
        raise HTTPException(404, "Evidence preview not found.")
    if row["confirmed_at"]:
        raise HTTPException(409, "Evidence is already confirmed; it cannot be reassigned.")
    return row, json.loads(row["payload"])


@app.get("/api/evidence/drafts")
def evidence_drafts():
    with db() as connection:
        result = []
        for kind in ("workbook", "chart"):
            row = connection.execute("""
                SELECT id,kind,filename,payload FROM evidence
                WHERE id=(SELECT MAX(id) FROM evidence WHERE kind=?) AND confirmed_at IS NULL
            """, (kind,)).fetchone()
            if row:
                payload = json.loads(row["payload"])
                suggested_company = None
                if kind == "chart" and payload["suggestions"].get("company"):
                    match = connection.execute(
                        "SELECT id FROM companies WHERE company_key=?",
                        (company_key(payload["suggestions"]["company"]),),
                    ).fetchone()
                    suggested_company = match["id"] if match else None
                result.append({"id": row["id"], "kind": kind, "filename": row["filename"],
                               "payload": payload, "suggested_company_id": suggested_company})
    return result


@app.post("/api/evidence/{evidence_id}/workbook")
def confirm_workbook(evidence_id: int, request: WorkbookConfirmation):
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _, payload = draft(connection, evidence_id, "workbook")
        key = company_key(payload["company"])
        existing = connection.execute("SELECT * FROM companies WHERE company_key=?", (key,)).fetchone()
        alias = connection.execute("SELECT * FROM companies WHERE symbol=?", (request.symbol,)).fetchone() if request.symbol else None
        csv_stock = latest(connection).get(request.symbol) if request.symbol else None
        if ((alias and alias["company_key"] != key)
                or (existing and existing["symbol"] and request.symbol and existing["symbol"] != request.symbol)
                or (csv_stock and company_key(csv_stock.name) != key)):
            raise HTTPException(422, "Symbol/company conflict: this workbook cannot be linked to that equity.")
        if not existing:
            cursor = connection.execute("INSERT INTO companies(company,company_key,symbol) VALUES (?,?,?)",
                                        (payload["company"], key, request.symbol))
            company_id = cursor.lastrowid
        else:
            company_id = existing["id"]
            if request.symbol and existing["symbol"] is None:
                connection.execute("UPDATE companies SET symbol=? WHERE id=?", (request.symbol, company_id))
        identity = connection.execute("SELECT * FROM companies WHERE id=?", (company_id,)).fetchone()
        previous = connection.execute(
            "SELECT payload,confirmation FROM evidence WHERE company_id=? AND kind='workbook' AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 1",
            (company_id,),
        ).fetchone()
        if previous:
            old = json.loads(previous["payload"])
            old_confirmation = json.loads(previous["confirmation"])
            if old_confirmation["basis"] != request.basis or old_confirmation["company_type"] != request.company_type:
                raise HTTPException(422, "Reporting basis/company type changed. Do not mix evidence definitions.")
            if payload["annual"][-1]["period"] < old["annual"][-1]["period"] or (
                old["quarterly"] and (not payload["quarterly"] or payload["quarterly"][-1]["period"] < old["quarterly"][-1]["period"])
            ):
                raise HTTPException(422, "Workbook would replace newer financial periods.")
        connection.execute("UPDATE evidence SET company_id=?,symbol=?,confirmation=?,confirmed_at=? WHERE id=?",
                           (company_id, identity["symbol"], request.model_dump_json(), datetime.now(timezone.utc).isoformat(), evidence_id))
    return {"message": f"Workbook confirmed for {payload['company']}.", "company_id": company_id}


@app.post("/api/evidence/{evidence_id}/chart")
def confirm_chart(evidence_id: int, request: ChartConfirmation):
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        draft(connection, evidence_id, "chart")
        equity = (connection.execute("SELECT * FROM companies WHERE id=?", (request.company_id,)).fetchone()
                  if request.company_id is not None else
                  connection.execute("SELECT * FROM companies WHERE symbol=?", (request.symbol,)).fetchone())
        if not equity:
            raise HTTPException(422, "Confirm a workbook for this company before linking its chart.")
        if request.symbol and equity["symbol"] != request.symbol:
            raise HTTPException(422, "Company and symbol selection conflict.")
        if company_key(request.company) != equity["company_key"]:
            raise HTTPException(422, "Chart company does not match the selected workbook company.")
        previous = connection.execute(
            "SELECT confirmation FROM evidence WHERE company_id=? AND kind='chart' AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 1",
            (equity["id"],),
        ).fetchone()
        if previous and request.captured_at < ChartConfirmation.model_validate_json(previous["confirmation"]).captured_at:
            raise HTTPException(422, "Chart capture is older than the current confirmed chart.")
        connection.execute("UPDATE evidence SET company_id=?,symbol=?,confirmation=?,confirmed_at=? WHERE id=?",
                           (equity["id"], equity["symbol"], request.model_dump_json(), datetime.now(timezone.utc).isoformat(), evidence_id))
    return {"message": f"Chart confirmed for {equity['company']}; no paper price or order eligibility changed.",
            "company_id": equity["id"]}


@app.get("/api/evidence")
def get_evidence():
    with db() as connection:
        identities = connection.execute("SELECT * FROM companies ORDER BY company").fetchall()
        result = []
        for equity in identities:
            item = {"id": equity["id"], "symbol": equity["symbol"], "company": equity["company"], "workbook": None, "chart": None,
                    "entry_status": "not_established",
                    "missing_evidence": ["Verified end-of-day price/date", "Actual publication dates", "Governance review",
                                         "Promoter pledge evidence", "Average daily traded value", "Supported fair value"]}
            for kind in ("workbook", "chart"):
                row = connection.execute(
                    "SELECT id,filename,payload,confirmation,confirmed_at FROM evidence WHERE company_id=? AND kind=? AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 1",
                    (equity["id"], kind),
                ).fetchone()
                if row:
                    payload = json.loads(row["payload"])
                    confirmation = json.loads(row["confirmation"])
                    item[kind] = {"id": row["id"], "filename": row["filename"], "payload": payload,
                                  "confirmation": confirmation, "confirmed_at": row["confirmed_at"],
                                  "assessment": financial_assessment(payload, confirmation["company_type"]) if kind == "workbook" else chart_assessment(confirmation)}
            result.append(item)
    return result


@app.get("/api/evidence/{evidence_id}/image")
def evidence_image(evidence_id: int):
    with db() as connection:
        row = connection.execute("SELECT content FROM evidence WHERE id=? AND kind='chart'", (evidence_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Chart not found.")
    content = row["content"]
    return Response(content, media_type="image/png" if content.startswith(b"\x89PNG") else "image/jpeg",
                    headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@app.get("/api/stocks")
def stocks():
    with db() as connection:
        values = latest(connection)
    result = [{**json.loads(s.model_dump_json()), "assessment": assess(s, date.today())}
              for s in values.values()]
    order = {"research_candidate": 0, "watchlist": 1, "insufficient_data": 2, "unsupported_sector": 3}
    return sorted(result, key=lambda s: (order[s["assessment"]["status"]],
                                        -(s["assessment"]["score"] or 0), s["symbol"]))


@app.get("/api/portfolio")
def get_portfolio():
    with db() as connection:
        result = portfolio(connection, latest(connection))
    return {k: v for k, v in result.items() if not k.startswith("_")}


def check_event_date(connection, event_date):
    if event_date != date.today():
        raise HTTPException(422, "First release accepts today's paper events only; historical execution is not simulated.")
    newest = connection.execute("SELECT MAX(event_date) AS d FROM ledger").fetchone()["d"]
    if newest and str(event_date) < newest:
        raise HTTPException(422, "Paper events cannot precede existing events.")


@app.post("/api/contributions")
def contribute(request: Contribution):
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        check_event_date(connection, request.date)
        monthly = connection.execute(
            "SELECT COALESCE(SUM(amount_paise),0) AS amount FROM ledger WHERE kind='contribution' AND substr(event_date,1,7)=?",
            (request.date.strftime("%Y-%m"),),
        ).fetchone()["amount"]
        amount = paise(request.amount)
        if monthly + amount > 5_000_000:
            raise HTTPException(422, "Contributions cannot exceed INR 50,000 per calendar month.")
        connection.execute("INSERT INTO ledger(kind,event_date,amount_paise) VALUES ('contribution',?,?)",
                           (str(request.date), amount))
    return {"message": "Paper contribution recorded."}


@app.post("/api/buys")
def buy(request: Buy):
    with db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        check_event_date(connection, request.date)
        values = latest(connection)
        symbol = request.symbol.upper()
        stock = values.get(symbol)
        if stock is None:
            raise HTTPException(422, "Import this stock before recording a paper buy.")
        if assess(stock, date.today())["status"] != "research_candidate":
            raise HTTPException(422, "Paper buys require a current research-candidate assessment.")
        state = portfolio(connection, values)
        if state["valuation_issues"]:
            raise HTTPException(422, state["valuation_issues"])
        cost = paise(request.cost)
        price = paise(request.price)
        debit = request.quantity * price + cost
        if debit > state["_cash"]:
            raise HTTPException(422, "Insufficient paper cash.")
        market_value = request.quantity * paise(stock.price)
        post_total = state["_total"] - debit + market_value
        stock_value = market_value + state["_stock_values"].get(symbol, 0)
        sector_value = state["_sectors"].get(stock.sector, 0) + market_value
        if post_total <= 0 or stock_value * 10 > post_total:
            raise HTTPException(422, "Paper buy exceeds the 10% stock exposure limit.")
        if sector_value * 4 > post_total:
            raise HTTPException(422, "Paper buy exceeds the 25% sector exposure limit.")
        connection.execute("""
            INSERT INTO ledger(kind,event_date,symbol,quantity,price_paise,cost_paise,amount_paise)
            VALUES ('buy',?,?,?,?,?,?)
        """, (str(request.date), symbol, request.quantity, price, cost, debit))
    return {"message": "Hypothetical buy recorded; not an actual order.",
            "warning": "Zero transaction costs are unrealistic." if cost == 0 else None}
