import { useEffect, useState } from 'react'

type Metric = { key: string; title: string; value: number | null; passed: boolean | null; cells: string[]; method: string }
type Financials = {
  status: string; score: number | null; metrics: Metric[]; warning: string
  annual_period?: string; annual_age_days?: number; quarterly_period?: string | null; quarterly_age_days?: number | null
}
type WorkbookPayload = {
  company: string; sheets: string[]; undated_price: number | null; market_cap_crore: number | null
  annual: { period: string; values: Record<string, number | null>; cells: Record<string, string>; aligned: boolean }[]
  quarterly: { period: string; sales: number | null; net_profit: number | null; cells: string[] }[]
  warnings: string[]
}
type ChartFields = {
  company_id: string; company: string; timeframe: string; captured_at: string
  price: string; volume: string; sma20: string; sma50: string; sma200: string
  bar_complete: string
}
type ChartPayload = { ocr_text: string; suggestions: Partial<Record<keyof ChartFields, string | number>>; warnings: string[] }
type Preview = { id: number; kind: string; filename: string; payload: WorkbookPayload | ChartPayload; suggested_company_id: number | null }
type Evidence = {
  id: number; symbol: string | null; company: string; entry_status: string; missing_evidence: string[]
  workbook: { id: number; filename: string; payload: WorkbookPayload; confirmation: { basis: string; company_type: string }; assessment: Financials } | null
  chart: {
    id: number; filename: string; payload: ChartPayload
    confirmation: { captured_at: string; timeframe: string; price: number; volume: number | null; sma20: number | null; sma50: number | null; sma200: number | null; bar_complete: boolean }
    assessment: { status: string; reasons: string[]; warning: string; capture_age_days: number }
  } | null
}
const emptyChart: ChartFields = { company_id: '', company: '', timeframe: '', captured_at: '', price: '', volume: '', sma20: '', sma50: '', sma200: '', bar_complete: '' }
const fmt = (n: number | null | undefined) => n == null ? 'Unknown' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(n)
const words = (s: string) => s.replaceAll('_', ' ')
const companyKey = (name: string) => (name.toUpperCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .map(word => word === 'LTD' ? 'LIMITED' : word).join(' ')
function chartFields(preview: Preview): ChartFields {
  const suggestions = (preview.payload as ChartPayload).suggestions
  const fields = { ...emptyChart }
  for (const key of Object.keys(fields) as (keyof ChartFields)[]) {
    if (suggestions[key] !== undefined) fields[key] = String(suggestions[key])
  }
  fields.company_id = preview.suggested_company_id === null ? '' : String(preview.suggested_company_id)
  return fields
}

async function evidenceApi<T>(path: string, body?: unknown): Promise<T> {
  const upload = body instanceof FormData
  const response = await fetch(`/api/evidence${path}`, body === undefined ? {} : {
    method: 'POST', headers: upload ? undefined : { 'Content-Type': 'application/json' },
    body: upload ? body : JSON.stringify(body),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Evidence API HTTP ${response.status}; check the backend.`)
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
  return data as T
}

export default function EvidenceWorkspace() {
  const [items, setItems] = useState<Evidence[]>([])
  const [workbookPreview, setWorkbookPreview] = useState<Preview | null>(null)
  const [chartPreview, setChartPreview] = useState<Preview | null>(null)
  const [basis, setBasis] = useState('')
  const [units, setUnits] = useState('')
  const [companyType, setCompanyType] = useState('')
  const [chart, setChart] = useState<ChartFields>(emptyChart)
  const [workbookConfirmed, setWorkbookConfirmed] = useState(false)
  const [chartConfirmed, setChartConfirmed] = useState(false)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function refresh() { setItems(await evidenceApi<Evidence[]>('')) }
  useEffect(() => {
    Promise.all([evidenceApi<Evidence[]>(''), evidenceApi<Preview[]>('/drafts')]).then(([available, drafts]) => {
      setItems(available)
      setWorkbookPreview(drafts.find(d => d.kind === 'workbook') ?? null)
      const image = drafts.find(d => d.kind === 'chart') ?? null
      setChartPreview(image)
      if (image) setChart(chartFields(image))
    }).catch(e => setError(String(e)))
  }, [])
  async function action(work: () => Promise<void>) {
    setError(''); setNotice(''); setBusy(true)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  function upload(kind: string, file: File | undefined) {
    if (!file) return
    void action(async () => {
      if (file.size > 10_000_000) throw new Error('Maximum evidence file size is 10 MB.')
      const body = new FormData(); body.append('file', file)
      const result = await evidenceApi<Preview>(`/preview/${kind}`, body)
      if (kind === 'chart') {
        const available = await evidenceApi<Evidence[]>('')
        setItems(available)
        setChart(chartFields(result)); setChartPreview(result); setChartConfirmed(false)
      } else {
        setWorkbookPreview(result); setWorkbookConfirmed(false); setBasis(''); setUnits(''); setCompanyType('')
      }
    })
  }
  const companies = items.map(i => ({ value: String(i.id), company: i.company, pending: false }))
  if (workbookPreview) {
    const name = (workbookPreview.payload as WorkbookPayload).company
    if (!companies.some(i => companyKey(i.company) === companyKey(name))) {
      companies.push({ value: `draft:${workbookPreview.id}`, company: name, pending: true })
    }
  }
  const selectedCompany = companies.find(i => i.value === chart.company_id) ??
    companies.find(i => companyKey(i.company) === companyKey(chart.company))
  const chartCompanyValue = selectedCompany?.value ?? ''
  const item = items.find(i => String(i.id) === selected)
  return <section>
    <div className="section-top"><div><h2>One company. Correlated evidence.</h2>
      <p>Upload both files in either order. The workbook name appears immediately; confirm its definitions before saving the chart link.</p></div>
      <button disabled={busy} onClick={() => action(refresh)}>Refresh evidence</button></div>
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="paper-grid">
      <label className="file-label">Screener Excel workbook<input disabled={busy} type="file" accept=".xlsx"
        onChange={e => upload('workbook', e.target.files?.[0])} /></label>
      <label className="file-label">TradingView chart screenshot<input disabled={busy} type="file" accept=".png,.jpg,.jpeg"
        onChange={e => upload('chart', e.target.files?.[0])} /></label>
    </div>
    <p className="muted">All files and confirmations are retained in local SQLite. OCR uses Apple Vision on your Mac; no external AI request. Company identity comes from the workbook, not its filename. Do not use screenshots to substitute for end-of-day price data.</p>
    {busy && <p role="status">Extracting or saving evidence. Local OCR can take up to 90 seconds.</p>}
    {workbookPreview && <form className="panel" onSubmit={e => { e.preventDefault(); void action(async () => {
      const result = await evidenceApi<{ message: string; company_id: number }>(`/${workbookPreview.id}/workbook`, { basis, units, company_type: companyType, identity_confirmed: workbookConfirmed })
      setNotice(result.message + ' Missing entry evidence remains unknown.')
      if (selectedCompany?.value === `draft:${workbookPreview.id}`) {
        setChart(current => ({ ...current, company_id: String(result.company_id) }))
      }
      setSelected(String(result.company_id)); setWorkbookPreview(null); await refresh()
    }) }}>
      <h3>Confirm workbook identity and definitions</h3>
      <p><strong>{(workbookPreview.payload as WorkbookPayload).company}</strong> · {workbookPreview.filename}</p>
      <p>Sheets inspected: {(workbookPreview.payload as WorkbookPayload).sheets.join(', ')}</p>
      <p>Annual periods: {(workbookPreview.payload as WorkbookPayload).annual[0].period} to {(workbookPreview.payload as WorkbookPayload).annual.at(-1)?.period}.
        Latest quarter: {(workbookPreview.payload as WorkbookPayload).quarterly.at(-1)?.period ?? 'Unknown'}.</p>
      <p className="muted">Company identity is taken directly from the workbook. Case, punctuation and Ltd/Limited variations are normalised when matching charts.</p>
      <label>Financial reporting basis<select required value={basis} onChange={e => setBasis(e.target.value)}>
        <option value="">Confirm from your download</option><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label>
      <label>Workbook monetary units<select required value={units} onChange={e => setUnits(e.target.value)}>
        <option value="">Confirm units</option><option value="INR_crore">Financial amounts in INR crore; price/EPS in INR</option></select></label>
      <label>Company type<select aria-label="Company type" required value={companyType} onChange={e => setCompanyType(e.target.value)}>
        <option value="">Confirm company type</option><option value="non_financial">Non-financial company</option>
        <option value="bank">Bank</option><option value="nbfc">NBFC</option><option value="insurer">Insurer</option></select></label>
      <label className="check"><input type="checkbox" required checked={workbookConfirmed} onChange={e => setWorkbookConfirmed(e.target.checked)} />
        I confirm the company shown in this workbook and that the source is Screener.in.</label>
      <ul className="reasons">{workbookPreview.payload.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      <button className="primary" disabled={busy}>Confirm workbook company</button>
    </form>}
    {chartPreview && <form className="panel" onSubmit={e => { e.preventDefault(); void action(async () => {
      if (!selectedCompany || selectedCompany.pending) throw new Error('Confirm the selected workbook company before saving the chart link.')
      const nullable = (value: string) => value.trim() ? Number(value) : null
      const result = await evidenceApi<{ message: string; company_id: number }>(`/${chartPreview.id}/chart`, {
        ...chart, company_id: Number(selectedCompany.value), price: Number(chart.price), volume: nullable(chart.volume),
        sma20: nullable(chart.sma20), sma50: nullable(chart.sma50), sma200: nullable(chart.sma200),
        bar_complete: chart.bar_complete === 'true', identity_confirmed: chartConfirmed,
      })
      setNotice(result.message)
      setSelected(String(result.company_id)); setChartPreview(null); await refresh()
    }) }}>
      <h3>Verify OCR against the screenshot</h3>
      <img className="chart-image" src={`/api/evidence/${chartPreview.id}/image`} alt="Uploaded chart to verify extracted labels" />
      <details><summary>Raw OCR text</summary><pre className="ocr-text">{(chartPreview.payload as ChartPayload).ocr_text || 'No readable labels found. Enter visible values manually; do not guess.'}</pre></details>
      <div className="paper-grid">
        <label>Link chart to workbook company<select aria-label="Link chart to workbook company" required value={chartCompanyValue} onChange={e => setChart({ ...chart, company_id: e.target.value })}>
          <option value="">Select workbook company</option>{companies.map(i => <option key={i.value} value={i.value}>{i.company}{i.pending ? ' — workbook confirmation pending' : ''}</option>)}</select></label>
        <label>Chart company name<input required value={chart.company} onChange={e => setChart({ ...chart, company: e.target.value })} /></label>
        <label>Chart timeframe<select aria-label="Chart timeframe" required value={chart.timeframe} onChange={e => setChart({ ...chart, timeframe: e.target.value })}>
          <option value="">Confirm timeframe</option><option value="1W">1W — weekly bars and SMAs</option><option value="1D">1D — daily bars and SMAs</option></select></label>
        <label>Capture timestamp with timezone<input required value={chart.captured_at} placeholder="2026-10-01T15:11:00+05:30"
          onChange={e => setChart({ ...chart, captured_at: e.target.value })} /></label>
        {(['price', 'volume', 'sma20', 'sma50', 'sma200'] as const).map(key => <label key={key}>
          {{ price: 'Displayed bar price (INR)', volume: 'Displayed bar volume (shares, not daily average)', sma20: '20-period SMA', sma50: '50-period SMA', sma200: '200-period SMA' }[key]}
          <input type="number" required={key === 'price'} min={key === 'volume' ? '0' : '0.0001'} step="any"
            value={chart[key]} onChange={e => setChart({ ...chart, [key]: e.target.value })} /></label>)}
        <label>Is the displayed bar complete?<select required value={chart.bar_complete} onChange={e => setChart({ ...chart, bar_complete: e.target.value })}>
          <option value="">Confirm; never infer from capture time</option><option value="false">No / uncertain — treat as incomplete</option><option value="true">Yes — I verified bar completion</option></select></label>
      </div>
      <label className="check"><input type="checkbox" required checked={chartConfirmed} onChange={e => setChartConfirmed(e.target.checked)} />
        I checked every supplied value and confirm the screenshot belongs to this company. Blank indicators stay unknown.</label>
      {!selectedCompany && companies.length > 0 && <p className="muted">No unique exact company-name match was found. Select the correct workbook company and verify the OCR name; no fuzzy or filename match is used.</p>}
      <ul className="reasons">{chartPreview.payload.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      <button className="primary" disabled={busy || !selectedCompany || selectedCompany.pending}>Confirm chart for company</button>
      {selectedCompany?.pending && <p className="risk-banner">The workbook name is matched. Complete the workbook confirmation form above to enable saving this chart link; both previews remain available.</p>}
      {!companies.length && <p className="error">Upload a workbook to populate company names. The OCR name alone is not a workbook identity.</p>}
    </form>}
    {!items.length && <div className="empty"><h2>No confirmed equity evidence yet.</h2><p>Upload your XLSX, inspect the preview and confirm its company. Your paper portfolio is not modified by evidence uploads.</p></div>}
    {items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Company</th><th>Fundamentals</th><th>Chart context</th><th>Entry suitability</th><th>Evidence</th></tr></thead><tbody>
      {items.map(i => <tr key={i.id}><td><strong>{i.company}</strong>{i.symbol && <small>Existing symbol: {i.symbol}</small>}</td>
        <td>{i.workbook?.assessment.score == null ? 'Unsupported' : `${i.workbook.assessment.score}/6`}<small>{words(i.workbook?.assessment.status ?? 'unknown')}</small></td>
        <td>{words(i.chart?.assessment.status ?? 'no_chart')}</td><td>Not established</td><td><button onClick={() => setSelected(String(i.id))}>Inspect {i.company}</button></td></tr>)}
    </tbody></table></div>}
    {item && <section className="detail"><div className="section-top"><h2>{item.company} — correlated evidence</h2><button onClick={() => setSelected('')}>Close evidence</button></div>
      <div className="risk-banner"><strong>Entry suitability is not established.</strong> Fundamentals and a chart snapshot do not establish fair value, governance clearance or an acceptable loss limit. Waiting remains an option.</div>
      {item.workbook && <>
        <h3>Fundamentals · {item.workbook.confirmation.basis}</h3>
        <p>Annual statements: {item.workbook.assessment.annual_period ?? 'See history'} ({item.workbook.assessment.annual_age_days ?? 'Unknown'} days old).
          Latest quarter: {item.workbook.assessment.quarterly_period ?? 'Unknown'} ({item.workbook.assessment.quarterly_age_days ?? 'Unknown'} days old).</p>
        <p className="muted">{item.workbook.assessment.warning}</p>
        <div className="table-wrap"><table><thead><tr><th>Metric</th><th>Value</th><th>Checklist</th><th>Source cells / calculation</th></tr></thead><tbody>
          {item.workbook.assessment.metrics.map(m => <tr key={m.key}><td>{m.title}</td><td>{fmt(m.value)}</td><td>{m.passed === null ? 'Unknown' : m.passed ? 'Pass' : 'Fail'}</td>
            <td>{m.cells.join(', ')}<small>{m.method}</small></td></tr>)}
        </tbody></table></div>
        <details><summary>Annual source history (amounts in INR crore)</summary><div className="table-wrap"><table><thead><tr><th>Period</th><th>Sales</th><th>Profit</th><th>Operating cash flow</th><th>Borrowings</th></tr></thead><tbody>
          {item.workbook.payload.annual.map(a => <tr key={a.period}><td>{a.period}</td><td>{fmt(a.values.sales)}</td><td>{fmt(a.values.net_profit)}</td><td>{fmt(a.values.operating_cash_flow)}</td><td>{fmt(a.values.borrowings)}</td></tr>)}
        </tbody></table></div></details>
        <details><summary>Quarterly source history (amounts in INR crore)</summary><div className="table-wrap"><table><thead><tr><th>Period</th><th>Sales</th><th>Profit</th><th>Source</th></tr></thead><tbody>
          {item.workbook.payload.quarterly.map(q => <tr key={q.period}><td>{q.period}</td><td>{fmt(q.sales)}</td><td>{fmt(q.net_profit)}</td><td>{q.cells.join(', ')}</td></tr>)}
        </tbody></table></div></details>
        <p>Workbook price: {fmt(item.workbook.payload.undated_price)} INR — undated; never used as an executable quote.</p>
        <ul className="reasons">{item.workbook.payload.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      </>}
      {item.chart ? <>
        <h3>Chart context · {item.chart.confirmation.timeframe}</h3>
        <p>Captured: {item.chart.confirmation.captured_at} · user-confirmed displayed price: {fmt(item.chart.confirmation.price)} INR.
          Bar volume: {fmt(item.chart.confirmation.volume)} shares.</p>
        <p>Capture age: {item.chart.assessment.capture_age_days} days. This trend description applies to that snapshot, not necessarily today's market.</p>
        <p className="muted">These are screenshot labels, not independently verified live market data. Capture time is not the bar's end date.</p>
        <ul className="reasons">{item.chart.assessment.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        <p>{item.chart.assessment.warning}</p>
        <img className="chart-image" src={`/api/evidence/${item.chart.id}/image`} alt={`Confirmed chart for ${item.company}`} />
      </> : <p>No chart confirmed for this company.</p>}
      <h3>Evidence still needed for entry assessment</h3>
      <ul className="reasons">{item.missing_evidence.map(m => <li key={m}>{m}</li>)}</ul>
      <p className="muted">Legacy CSV-based paper eligibility is unchanged. This evidence workspace does not make XLSX/chart records eligible for paper buys.</p>
    </section>}
  </section>
}
