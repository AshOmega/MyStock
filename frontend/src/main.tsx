import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Assessment = {
  status: 'research_candidate' | 'watchlist' | 'insufficient_data' | 'unsupported_sector'
  score: number | null
  reasons: string[]
  warning: string
}
type Stock = {
  symbol: string; name: string; sector: string; business: string
  market_cap_category: string; price: string; price_date: string; source: string
  financial_period: string | null; published_on: string | null
  fair_value: string | null; fair_value_date: string | null
  fair_value_source: string | null; fair_value_method: string | null
  assessment: Assessment
}
type Position = {
  symbol: string; quantity: number; sector: string; price_date: string
  value: number | null; cost_basis: number; unrealised_pnl: number | null
}
type Portfolio = {
  cash: number; total_value: number | null; contributions: number; total_costs: number
  unrealised_pnl: number | null; positions: Position[]; valuation_issues: string[]
  exposure_warnings: string[]; benchmark_comparison: string
  events: { id: number; kind: string; event_date: string; symbol: string | null; quantity: number | null; amount_paise: number; cost_paise: number }[]
}
const money = (n: number | string | null) => n === null ? 'Unavailable' :
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n))
const label = (value: string) => value.replaceAll('_', ' ')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`API returned HTTP ${response.status} without JSON. Check that the Python backend is running on port 8000.`)
  }
  const data: unknown = await response.json()
  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : data
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return data as T
}

function App() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [active, setActive] = useState('Research')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [csv, setCsv] = useState('')
  const [buy, setBuy] = useState({ symbol: '', quantity: '', price: '', cost: '' })
  const [amount, setAmount] = useState('')

  async function refresh() {
    const [s, p] = await Promise.all([api<Stock[]>('stocks'), api<Portfolio>('portfolio')])
    setStocks(s); setPortfolio(p)
  }
  useEffect(() => { refresh().catch(e => setError(String(e))) }, [])
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const detail = stocks.find(s => s.symbol === selected)
  const visible = stocks.filter(s => `${s.symbol} ${s.name} ${s.sector}`.toLowerCase().includes(filter.toLowerCase()))

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brand-icon">M</span>MyStock<span className="version">LOCAL / 01</span></div>
      <p className="aside-caption">Research before returns.</p>
      <nav aria-label="Main navigation">{['Research', 'Paper portfolio', 'Import data', 'Methodology'].map(item =>
        <button key={item} className={active === item ? 'nav-active' : ''} onClick={() => setActive(item)}>{item}</button>)}</nav>
      <div className="profile"><span className="eyebrow">YOUR INVESTMENT BRIEF</span>
        <h3>Patient capital.<br />Informed decisions.</h3>
        <p>1-4 year horizon<br />Up to INR 50,000/month<br />10% drawdown preference</p>
        <span className="local-dot">Local storage · No broker connection</span>
      </div>
    </aside>
    <main>
      <header><div><span className="eyebrow">INDIAN EQUITIES / DECISION SUPPORT</span>
        <h1>{active}</h1></div><div className="header-right"><span className="pill">PAPER MODE</span>
        <button disabled={busy} onClick={() => action(refresh)}>Refresh</button></div></header>
      <div className="risk-banner"><strong>Research tool, not a return forecast.</strong> Losses can exceed 10%. Small-cap inclusion does not imply suitability. Never treat a score as a success probability.</div>
      {error && <div role="alert" className="error">{error}</div>}
      {notice && <div role="status" className="notice">{notice}</div>}
      <div className="stats">
        <article><span>Paper portfolio value</span><strong>{portfolio ? money(portfolio.total_value) : 'Loading...'}</strong><small>Latest supplied prices, not live quotes</small></article>
        <article><span>Uninvested cash</span><strong>{portfolio ? money(portfolio.cash) : 'Loading...'}</strong><small>Waiting is a valid outcome</small></article>
        <article><span>Research candidates</span><strong>{stocks.filter(s => s.assessment.status === 'research_candidate').length}<em> / {stocks.length}</em></strong><small>Unvalidated 6-point quality screen</small></article>
      </div>
      {active === 'Research' && <>
        <section className="section-top"><div><h2>Your research universe</h2><p>Review the evidence. Understand the business. Then decide.</p></div>
          <input aria-label="Search stocks" placeholder="Search company, symbol or sector" value={filter} onChange={e => setFilter(e.target.value)} /></section>
        {!stocks.length ? <div className="empty"><span className="eyebrow">START WITH EVIDENCE</span><h2>No stocks imported yet.</h2>
          <p>Import your dated financial and price data. No sample stocks or fabricated recommendations are preloaded.</p>
          <button className="primary" onClick={() => setActive('Import data')}>Import your first CSV</button></div> :
          <div className="table-wrap"><table><thead><tr><th>Company</th><th>Price / date</th><th>Quality</th><th>Assessment</th><th>Evidence</th></tr></thead>
            <tbody>{visible.map(s => <tr key={s.symbol}>
              <td><strong>{s.name}</strong><small>{s.symbol} · {s.sector} · {s.market_cap_category} cap</small></td>
              <td>{money(s.price)}<small>{s.price_date}</small></td><td>{s.assessment.score === null ? 'N/A' : `${s.assessment.score}/6`}</td>
              <td><span className={`status ${s.assessment.status}`}>{label(s.assessment.status)}</span></td>
              <td><button onClick={() => setSelected(s.symbol)}>Review</button></td>
            </tr>)}</tbody></table>{!visible.length && <p className="muted">No matching stocks.</p>}</div>}
        {detail && <section className="detail"><div className="section-top"><h2>{detail.name} <small>{detail.symbol}</small></h2><button onClick={() => setSelected(null)}>Close</button></div>
          <h3>Understand the business</h3><p>{detail.business}</p><p className="muted">Review this description before deciding whether the business is familiar to you.</p>
          <div className="facts"><p><strong>Price source</strong><br />{detail.source}</p><p><strong>Financial period / publication</strong><br />{detail.financial_period ?? 'Missing'} / {detail.published_on ?? 'Missing'}</p>
            <p><strong>User-supplied fair value</strong><br />{money(detail.fair_value)} · {detail.fair_value_date ?? 'Undated'}</p></div>
          <p>Valuation source: {detail.fair_value_source ?? 'Missing'}<br />Method: {detail.fair_value_method ?? 'Missing'}</p>
          <ul className="reasons">{detail.assessment.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul><p className="muted">{detail.assessment.warning}</p>
        </section>}
      </>}
      {active === 'Import data' && <section className="panel">
        <h2>Bring your own evidence</h2><p>CSV imports are validated as one transaction. Invalid rows prevent the entire import; prior snapshots are retained.</p>
        <p>Amounts are INR, ratios are numeric, percentages are percentage points, dates use YYYY-MM-DD. Missing optional data stays blank and blocks candidate status where required.</p>
        <a className="button-link" href="/api/template" download="mystock-template.csv">Download CSV header template</a>
        <label className="file-label">Choose a CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => {
          const file = e.target.files?.[0]
          if (file) void action(async () => {
            if (file.size > 2_000_000) throw new Error('Maximum CSV file size is 2 MB.')
            setCsv(await file.text())
          })
        }} /></label>
        <label>Or paste CSV<textarea value={csv} onChange={e => setCsv(e.target.value)} rows={10} placeholder="Paste header and stock rows here..." /></label>
        <button className="primary" disabled={busy || !csv.trim()} onClick={() => action(async () => {
          const result = await api<{ imported: number }>('import', { csv_text: csv })
          setNotice(`${result.imported} stocks imported. Review their source dates and assessments.`); await refresh()
        })}>{busy ? 'Working...' : 'Validate and import'}</button>
        <p className="muted">No automatic provider is connected. Source claims and fair values are supplied by you, not independently verified. See README for the field dictionary.</p>
      </section>}
      {active === 'Paper portfolio' && <section>
        <div className="section-top"><div><h2>Learn without placing an order</h2><p>Hypothetical positions only. Today's events; no historical execution simulation.</p></div></div>
        {portfolio?.valuation_issues.map(issue => <p className="error" key={issue}>{issue}</p>)}
        {portfolio?.exposure_warnings.map(issue => <p className="risk-banner" key={issue}>{issue}</p>)}
        <div className="paper-grid">
          <form className="panel" onSubmit={e => { e.preventDefault(); void action(async () => {
            const result = await api<{ message: string; warning: string | null }>('buys', { ...buy, quantity: Number(buy.quantity), date: today() })
            setNotice(result.message + (result.warning ? ` ${result.warning}` : '')); setBuy({ symbol: '', quantity: '', price: '', cost: '' }); await refresh()
          }) }}>
            <h3>Record a paper buy</h3>
            <label>Research candidate<select required value={buy.symbol} onChange={e => setBuy({ ...buy, symbol: e.target.value })}>
              <option value="">Choose a stock</option>{stocks.filter(s => s.assessment.status === 'research_candidate').map(s => <option key={s.symbol}>{s.symbol}</option>)}</select></label>
            <label>Whole shares<input required type="number" min="1" step="1" value={buy.quantity} onChange={e => setBuy({ ...buy, quantity: e.target.value })} /></label>
            <label>Hypothetical entry price (INR)<input required type="number" min="0.01" step="0.01" value={buy.price} onChange={e => setBuy({ ...buy, price: e.target.value })} /></label>
            <label>Total transaction cost (INR)<input required type="number" min="0" step="0.01" value={buy.cost} onChange={e => setBuy({ ...buy, cost: e.target.value })} /></label>
            <button className="primary" disabled={busy}>Record hypothetical buy</button><p className="muted">10% per stock / 25% per sector enforced at entry. Costs are required; zero is explicitly flagged.</p>
          </form>
          <form className="panel" onSubmit={e => { e.preventDefault(); void action(async () => {
            await api('contributions', { amount, date: today() }); setAmount(''); setNotice('Paper contribution recorded.'); await refresh()
          }) }}>
            <h3>Add paper capital</h3><p>Optional contributions up to INR 50,000 per calendar month, separate from investment performance.</p>
            <label>Contribution (INR)<input required type="number" min="0.01" max="50000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
            <button disabled={busy}>Record contribution</button><hr /><h3>Performance context</h3>
            <p>Unrealised P&amp;L after entered costs: <strong>{portfolio ? money(portfolio.unrealised_pnl) : 'Loading...'}</strong></p>
            <p>Recorded transaction costs: {portfolio ? money(portfolio.total_costs) : 'Loading...'}</p>
            <p className="muted">Price-only paper marks: taxes, dividends and corporate actions are not modelled. Benchmark: Nifty 500 TRI. {portfolio?.benchmark_comparison} No annualised return or outperformance claim is made.</p>
          </form>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Position</th><th>Shares</th><th>Cost incl. fees</th><th>Marked value</th><th>Unrealised P&amp;L</th></tr></thead><tbody>
          {portfolio?.positions.map(p => <tr key={p.symbol}><td>{p.symbol}<small>{p.price_date}</small></td><td>{p.quantity}</td><td>{money(p.cost_basis)}</td><td>{money(p.value)}</td><td>{money(p.unrealised_pnl)}</td></tr>)}
        </tbody></table>{!portfolio?.positions.length && <p className="muted">No hypothetical positions yet.</p>}</div>
        <h3>Paper ledger</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Event</th><th>Stock / shares</th><th>Cash amount</th></tr></thead><tbody>
          {portfolio?.events.map(e => <tr key={e.id}><td>{e.event_date}</td><td>{e.kind}</td><td>{e.symbol ?? '-'} / {e.quantity ?? '-'}</td><td>{money(e.amount_paise / 100)}</td></tr>)}
        </tbody></table></div>
      </section>}
      {active === 'Methodology' && <section className="panel prose"><span className="eyebrow">TRANSPARENCY OVER CERTAINTY</span><h2>A research checklist. Not a crystal ball.</h2>
        <p>Each condition earns one point: positive 3-year revenue growth, positive 3-year EPS growth, ROE at least 15%, debt/equity at most 1, positive operating cash flow, and positive net profit with cash flow/profit at least 0.8.</p>
        <p>A research candidate needs at least 5/6, price below a dated user-supplied fair value, no reported governance red flag, zero promoter pledge, and average daily traded value of at least INR 1 crore.</p>
        <p>Missing required evidence means insufficient data. A failing condition or stale data means watchlist. Prices older than 7 calendar days and financial periods older than 180 days block candidates. Financial publication and fair-value dates cannot be later than the price date.</p>
        <p>Banks, NBFCs and insurers are unsupported until sector-specific rules are agreed. All company sizes can be imported; small caps require particular caution.</p>
        <p>These thresholds are explicitly unvalidated. This version performs no backtest, provides no calibrated probabilities, does not determine a market bottom, and cannot guarantee that losses stay within 10%.</p>
        <p>Fair value, source statements and governance flags are your inputs. The application validates their shape, not their truth. Retained snapshots alone are not a point-in-time historical research dataset.</p>
        <p>Data stays in local SQLite. No automatic market-data requests, broker connections, analytics, external fonts, or trading are configured. Dependency installation uses package registries.</p>
      </section>}
      <footer>MyStock / Local research workspace <span>Evidence first. Decisions remain yours.</span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
