import { expect, test } from '@playwright/test'
import path from 'node:path'

test('correlates the supplied TCS workbook and chart by company name without a symbol', async ({ page }) => {
  test.skip(!process.env.MYSTOCK_SAMPLE_DIR, 'Set MYSTOCK_SAMPLE_DIR to the directory containing the supplied TCS samples.')
  test.setTimeout(120_000)
  const samples = process.env.MYSTOCK_SAMPLE_DIR!
  await page.goto('/')
  await page.getByRole('button', { name: 'Excel & charts', exact: true }).click()
  await page.getByLabel('Screener Excel workbook').setInputFiles(path.join(samples, 'TCS.xlsx'))
  await expect(page.getByText('Confirm workbook identity and definitions', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Equity symbol', { exact: true })).toHaveCount(0)
  await page.getByLabel('Financial reporting basis').selectOption('consolidated')
  await page.getByLabel('Workbook monetary units').selectOption('INR_crore')
  await page.getByLabel('Company type', { exact: true }).selectOption('non_financial')
  await page.getByLabel('TradingView chart screenshot').setInputFiles(path.join(samples, 'TCS_chart.png'))
  await expect(page.getByText('Verify OCR against the screenshot', { exact: true })).toBeVisible({ timeout: 100_000 })
  await expect(page.getByText('Confirm workbook identity and definitions', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Financial reporting basis')).toHaveValue('consolidated')
  await expect(page.getByLabel('Workbook monetary units')).toHaveValue('INR_crore')
  await expect(page.getByLabel('Company type', { exact: true })).toHaveValue('non_financial')
  const companySelector = page.getByLabel('Link chart to workbook company', { exact: true })
  await expect(companySelector.locator('option:checked')).toHaveText('TATA CONSULTANCY SERVICES LTD — workbook confirmation pending')
  await expect(page.getByRole('button', { name: 'Confirm chart for company' })).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: 'Excel & charts', exact: true }).click()
  await expect(page.getByText('Verify OCR against the screenshot', { exact: true })).toBeVisible()
  await expect(page.getByText('Confirm workbook identity and definitions', { exact: true })).toBeVisible()
  await expect(companySelector.locator('option:checked')).toHaveText('TATA CONSULTANCY SERVICES LTD — workbook confirmation pending')
  await page.getByLabel('Financial reporting basis').selectOption('consolidated')
  await page.getByLabel('Workbook monetary units').selectOption('INR_crore')
  await page.getByLabel('Company type', { exact: true }).selectOption('non_financial')
  await page.getByLabel('I confirm the company shown').check()
  await page.getByRole('button', { name: 'Confirm workbook company' }).click()
  await expect(page.getByRole('status')).toContainText('Workbook confirmed for TATA CONSULTANCY SERVICES LTD')
  await expect(page.getByRole('cell', { name: '6/6 fundamentals available', exact: true })).toBeVisible()
  await expect(page.getByText('5.8018', { exact: true })).toBeVisible()
  await expect(page.getByText('Data Sheet!H17, Data Sheet!K17')).toBeVisible()
  await expect(page.getByLabel('Displayed bar price (INR)')).toHaveValue('2076.2')
  await expect(page.getByLabel('20-period SMA', { exact: true })).toHaveValue('2215.4')
  await expect(page.getByLabel('50-period SMA', { exact: true })).toHaveValue('2547.5')
  await expect(page.getByLabel('200-period SMA', { exact: true })).toHaveValue('3167')
  await expect(page.getByLabel('Capture timestamp with timezone')).toHaveValue('2026-10-01T15:11:00+05:30')
  await expect(page.getByLabel('Displayed bar volume')).toHaveValue('13300000')
  await expect(page.getByLabel('Chart timeframe', { exact: true })).toHaveValue('1W')
  await expect(companySelector.locator('option:checked')).toHaveText('TATA CONSULTANCY SERVICES LTD')
  await expect(companySelector).not.toHaveValue('')
  await page.getByLabel('Is the displayed bar complete?').selectOption('false')
  await page.getByLabel('I checked every supplied value').check()
  await page.getByLabel('Chart company name').fill('Wrong company')
  await page.getByRole('button', { name: 'Confirm chart for company' }).click()
  await expect(page.getByRole('alert')).toContainText('does not match')
  await page.getByLabel('Chart company name').fill('Tata Consultancy Services Limited')
  await page.getByRole('button', { name: 'Confirm chart for company' }).click()
  await expect(page.getByRole('status')).toContainText('Chart confirmed for TATA CONSULTANCY SERVICES LTD')
  await expect(page.getByText('below all averages', { exact: true })).toBeVisible()
  await expect(page.getByText('Entry suitability is not established.', { exact: true })).toBeVisible()
  await expect(page.getByText('Price at or below 20-1W SMA')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Excel & charts', exact: true }).click()
  await page.getByRole('button', { name: 'Inspect TATA CONSULTANCY SERVICES LTD', exact: true }).click()
  await expect(page.getByText('below all averages', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Confirmed chart for TATA CONSULTANCY SERVICES LTD' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})

test('keeps a chart-first preview and only matches a workbook with the same company name', async ({ page }) => {
  const company = 'Example % & भारत Company Limited'
  await page.route('**/api/evidence', route => route.fulfill({ json: [] }))
  await page.route('**/api/evidence/drafts', route => route.fulfill({ json: [] }))
  await page.route('**/api/evidence/preview/chart', route => route.fulfill({ json: {
    id: 901, kind: 'chart', filename: 'example.png', suggested_company_id: null,
    payload: { ocr_text: 'Synthetic chart', suggestions: { company: 'EXAMPLE % & भारत COMPANY LTD', price: 100 }, warnings: [] },
  } }))
  await page.route('**/api/evidence/preview/workbook', route => route.fulfill({ json: {
    id: 902, kind: 'workbook', filename: 'example.xlsx', suggested_company_id: null,
    payload: { company, sheets: ['Data Sheet'], annual: [{ period: '2026-03-31', values: {}, cells: {}, aligned: true }],
      quarterly: [], undated_price: null, market_cap_crore: null, warnings: [] },
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Excel & charts', exact: true }).click()
  await page.getByLabel('TradingView chart screenshot').setInputFiles({
    name: 'example.png', mimeType: 'image/png', buffer: Buffer.from('UI fixture only'),
  })
  const selector = page.getByLabel('Link chart to workbook company', { exact: true })
  await expect(selector).toHaveValue('')
  await page.getByLabel('Screener Excel workbook').setInputFiles({
    name: 'example.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('UI fixture only'),
  })
  await expect(page.getByText('Verify OCR against the screenshot', { exact: true })).toBeVisible()
  await expect(selector.locator('option:checked')).toHaveText(`${company} — workbook confirmation pending`)
  await expect(page.getByLabel('Displayed bar price (INR)')).toHaveValue('100')
  await expect(page.getByRole('button', { name: 'Confirm chart for company' })).toBeDisabled()
  await page.getByLabel('Chart company name').fill('Different Company Limited')
  await expect(selector).toHaveValue('')
  await page.getByLabel('Chart company name').fill('')
  await expect(selector).toHaveValue('')
})
