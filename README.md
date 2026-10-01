# MyStock

Local Indian equity research workspace: Python/FastAPI, React/TypeScript/Vite,
and SQLite. CSV-first, manual paper tracking, no orders or market-data feeds.

## Run on your Mac

Python 3.9+ and Node.js 20.19+ or 22.12+ are required.

From `/Users/karollil/AppTrial/MyStock`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd /Users/karollil/AppTrial/MyStock/frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The frontend proxies `/api` to the local backend.
Both processes must remain running. Stop each with Ctrl-C.
API documentation is at <http://127.0.0.1:8000/docs>.
Do not expose either server to a public network: authentication is not included.

Screenshot OCR requires macOS with Xcode Command Line Tools (`swift`) and
Apple Vision. If unavailable, install the tools with `xcode-select --install`.
OCR runs locally; there is no cloud vision API. XLSX parsing uses openpyxl,
image validation uses Pillow, and uploads use python-multipart, all installed
from `backend/requirements.txt`. Restart the backend after updating the app.

SQLite is created at `data/mystock.sqlite3` in the MyStock directory; no real holdings are
preloaded. Set `MYSTOCK_DB` to an alternative path before starting the backend
if needed. Stop the backend before copying the database for backup. Ledger
events and imported snapshots persist across restarts. There is no deletion,
sell, correction, or migration UI in this first release. Use an explicitly
separate database for experimentation; don't silently rewrite recorded events.

## Import workflow

Download the header template from **Import data**, fill it with sourced records,
then upload or paste it. No fictional data is preloaded. All rows are validated
before any are saved. Limit: 1,000 rows / 2 million text characters per request.
The file picker additionally limits files to 2 MB.

Amounts use INR; dates use `YYYY-MM-DD`. Do not include commas in numeric values.
CSV quoting is required for text containing commas, quotes or newlines.
UTF-8 text, spaces, `%`, `&`, `/`, semicolons and Unicode are preserved as text.
The source fields are descriptive text, not executable URLs.

| Field | Meaning / format |
|---|---|
| `symbol` | Unique uppercase identifier; letters, digits, `&`, `.`, `_`, `-`. Use one canonical exchange identifier per security, not both NSE and BSE listings. |
| `name`, `sector`, `business` | Company name, consistent sector name, beginner-readable business description. Sectors are trimmed and case-normalised for exposure accounting. |
| `company_type` | `non_financial`, `bank`, `nbfc`, `insurer`. Financial sectors are explicitly unsupported. |
| `market_cap_category` | `large`, `mid`, `small`, sourced by you. |
| `price`, `price_date`, `source` | Positive end-of-day INR price (max 2 decimal places), observation date, and source attribution. |
| `financial_period`, `published_on` | Financial reporting period end and actual publication date. Publication must not precede the period end. |
| `revenue_growth_3y_pct`, `eps_growth_3y_pct` | Three-year annualised growth in percentage points: `10` means 10%. Leave blank when a meaningful growth rate cannot be computed, especially with negative bases. |
| `roe_pct` | Return on equity in percentage points. |
| `debt_equity` | Non-negative debt/equity ratio, not a percentage. |
| `operating_cash_flow`, `net_profit` | INR amounts for the same financial measurement window and consolidation basis. Use comparable, preferably trailing-12-month figures; never mix units or periods. |
| `promoter_pledge_pct` | Pledged promoter holdings percentage, 0-100. Zero must be verified, not substituted for missing data. |
| `governance_red_flag` | Exactly `true`, `false`, or blank. Blank means unknown. `false` is your verified assertion, not independent clearance by the app. |
| `avg_daily_traded_value` | INR average daily traded value; use a consistent disclosed window such as the last 20 trading sessions and state the window in `source`. |
| `fair_value`, `fair_value_date`, `fair_value_source`, `fair_value_method` | Positive user-supplied INR valuation with date, source and method. This app does not estimate intrinsic value. Providing a fair value without its provenance is invalid. |

Identity, business, company type, size, price, price date and source are
mandatory. Other columns can be blank, but required screening evidence must
be complete for candidate status. Unknown columns, duplicate headers/symbols,
future dates, non-finite numbers and malformed values are rejected.
New snapshots are retained, but older price/financial dates cannot replace newer
ones and sector reclassification requires review. The source's accuracy,
accounting consistency and licensing remain the user's responsibility.

## Approved assessment rules

### Excel and chart evidence workspace

Open **Excel & charts**:

1. Upload a Screener-format `.xlsx`. Preview the company name and sheet/period
   coverage, then explicitly confirm its reporting basis, INR-crore units,
   company type and source/identity. No symbol entry is required.
2. Upload the corresponding PNG/JPEG chart. Inspect the image and raw local OCR
   text, confirm the matching workbook company, and correct/confirm the company,
   timeframe, capture timestamp with offset, displayed bar price/volume, SMAs
   and whether the bar is complete. Missing indicators remain blank.
3. Inspect that company's correlated fundamentals and chart evidence. Original
   files, extraction payloads and confirmations persist in SQLite. Previews are
   unassigned drafts until confirmed; confirmed records cannot be reassigned.

Uploads are limited to 10 MB. Expanded XLSX content is limited to 20 MB and
images to 20 million pixels. Macros and unsupported workbook layouts are
rejected. The Screener `Data Sheet` labels are validated before values are read.
Display sheets often contain formulas without cached values; the importer does
not execute formulas or invent zero values. It calculates the six fundamental
metrics from the raw annual series and shows source-cell references. Financial
amounts are converted from crore to INR for the displayed cash-flow metric.
EPS uses the template's adjusted shares, not verified diluted EPS. ROE uses
closing equity, not average equity. Ratios requiring matched statements remain
unknown if source period dates do not align.

Annual and quarterly periods and ages are shown separately. Unlike the original
CSV candidate gate below, the fundamentals workspace does not apply the blanket
180-day blocker. Age disclosure is not an assertion that the latest required
filings exist. No revised automatic buy eligibility has been approved.

Charts are descriptive snapshot evidence, not reconstructed price histories.
Only daily (`1D`) and weekly (`1W`) label confirmation is supported. A weekly
20-period SMA is not a 20-day SMA. Bar volume is not average daily traded value.
Capture time is not proof of the quote's observation time, bar end date or
completion. OCR reads the top chart labels using Apple Vision; custom indicators,
drawn trend lines, support/resistance and individual candle histories are not
interpreted. Unreadable fields require manual transcription from visible
labels, not guesses. Trend context reports price above/below the confirmed
20/50/200 SMAs; it is not a model trained to predict returns.

Identity linking rejects mismatched company names, inconsistent reporting
bases/company types, and replacement of newer financial periods or chart
captures with older ones. `Ltd`/`Limited`, case and punctuation differences are
normalised; substantive name changes require review. A unique exact normalised
OCR name match preselects the workbook company, but does not save the link until
you confirm. With no match, select a company manually and check the OCR name.
The company dropdown includes both confirmed companies and the name from the
current workbook preview. A matching pending workbook is preselected and labelled
**workbook confirmation pending**; finish **Confirm workbook company** before
saving the chart link. Uploading one file no longer discards the other preview or
its in-progress form entries. You can upload files in either order.
Latest unfinished workbook/chart previews are recovered from SQLite when you
reopen the workspace; confirmation fields must still be explicitly supplied.
Filenames and fuzzy matching are not used, and OCR alone cannot create a company.

Company records have stable internal IDs; names are displayed, not used as URL
paths. Existing symbol-keyed Excel/chart evidence is migrated to company IDs
without deleting files, confirmations or links. Previously recorded symbols
remain as optional metadata; the compatibility API can still accept them.
CSV/paper portfolios continue using symbols, and established symbol/name
conflicts are rejected.

Missing valuation, governance, pledges, publication dates and verified daily
liquidity remain explicit. Excel/chart evidence does **not** overwrite CSV
snapshots, become a paper-portfolio quote or unlock paper buys. The two
assessments are separate: fundamentals can be available while entry suitability
is not established. No buy instruction or loss-cap guarantee is generated.

### Original CSV-based paper eligibility

One point each: positive three-year revenue growth; positive three-year EPS
growth; ROE >=15%; debt/equity <=1; positive operating cash flow; positive net
profit and cash flow/profit >=0.8.

`research_candidate` requires at least 5 of 6, supplied fair value above price,
zero promoter pledge, no reported governance red flag, and average traded value
>= INR 10 million (1 crore). Prices older than 7 calendar days or financial
periods older than 180 days block candidate status. Publication and valuation
dates later than the observed price date also block candidates.

Missing required evidence => `insufficient_data`; failing gates => `watchlist`;
financial companies => `unsupported_sector`. Equal-ranked stocks are sorted by
symbol, not an implied finer ranking. Every business description is shown for
review because the app cannot infer which businesses are familiar to you.

These are approved but **unvalidated research heuristics**, not buy signals,
success probabilities, or guaranteed entry timing. Fair values are unverified
inputs. Losses can exceed the user's 10% tolerance; small caps increase risk.
There is no backtest, performance claim, drawdown-cap guarantee or exit advice.
Retained import snapshots do not establish a point-in-time historical dataset.

## Paper portfolio

Starting cash: INR 300,000. Contributions: up to INR 50,000 per calendar month.
Manual whole-share buys require an imported, current research candidate, today's
event date, an explicit entry price and non-negative transaction cost. A zero
cost is accepted but flagged. Only today's events are supported; no historical
execution or slippage is inferred. An entered price is a hypothetical assumption,
not evidence that execution at that price was possible.

Cash and fees are recorded in integer paise. Enforce <=10% per stock and <=25%
per sector using post-trade portfolio value and the latest supplied prices;
entered fees reduce that value. Missing/stale prices for existing positions
block buys and make aggregate value/P&L unavailable. Later price drift above
limits produces warnings, not automatic sales.

P&L excludes contributed capital and includes entered costs. It is not
annualised or adjusted for personal taxes, dividends or corporate actions;
splits/dividends in held securities require future ledger support. Accordingly,
these are paper marks, not validated total investment returns. Nifty 500 TRI is
the agreed future benchmark; comparison is explicitly unavailable until dated
index data and cash-flow-aware calculations are implemented.

## Checks

```sh
cd /Users/karollil/AppTrial/MyStock/backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm run build
```

Tests cover exact thresholds, missing/stale data, unsupported sectors, hostile
text, non-finite values, atomic imports, source preservation, position limits,
cash/fee accounting and persistence.

For browser workflow checks, use a **fresh, dedicated test database**:

```sh
cd /Users/karollil/AppTrial/MyStock/frontend
npx playwright install chromium
MYSTOCK_DB="$(mktemp -t mystock-e2e)" npm run test:e2e
```

Alternatively, use installed Chrome in an isolated temporary browser profile:

```sh
MYSTOCK_DB="$(mktemp -t mystock-e2e)" \
MYSTOCK_TEST_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
npm run test:e2e
```

The tests start their own servers on ports 8001 and 5174 and shut them down
afterward. Test imports are synthetic and do not touch the normal database.
`MYSTOCK_API_URL` can override the frontend's proxy target for these checks.

To also exercise the supplied real-sample Excel/chart confirmation workflow,
set `MYSTOCK_SAMPLE_DIR=/Users/karollil/AppTrial` in the browser-test command.
That test expects `TCS.xlsx` and `TCS_chart.png` there and uses their existing
labels; it does not copy samples into the repository. Without that variable,
the optional sample test is explicitly skipped. Always use a fresh test DB.

## Privacy and next-stage boundaries

The app uses local SQLite and same-origin frontend requests. No broker, telemetry,
external font or market-data API is configured. Dependency installation contacts
package registries. Free automatic providers, historical evaluation, tax handling,
sector-specific models and exit guidance are deferred. See
`../knowledge.md` for confirmed requirements and remaining decisions.
