import { expect, test } from '@playwright/test'

test('imports, explains and paper-tracks synthetic data without real orders', async ({ page, request }) => {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const header = await (await request.get('/api/template')).text()
  const values: Record<string, string> = {
    symbol: 'UI&TEST', name: 'Synthetic UI company', sector: 'industrial',
    business: 'Synthetic business % & ; / भारत for browser tests only.',
    company_type: 'non_financial', market_cap_category: 'small',
    price: '100', price_date: today, source: 'Synthetic test source',
    financial_period: today, published_on: today,
    revenue_growth_3y_pct: '10', eps_growth_3y_pct: '10',
    roe_pct: '15', debt_equity: '1', operating_cash_flow: '80', net_profit: '100',
    promoter_pledge_pct: '0', governance_red_flag: 'false',
    avg_daily_traded_value: '10000000', fair_value: '120', fair_value_date: today,
    fair_value_source: 'Synthetic estimate', fair_value_method: 'Test only',
  }
  const csv = header + header.trim().split(',').map(k => values[k]).join(',') + '\n'
  await page.goto('/')
  await expect(page.getByText('No stocks imported yet.')).toBeVisible()
  await expect(page.getByText('₹3,00,000.00').first()).toBeVisible()
  await page.getByRole('button', { name: 'Import your first CSV' }).click()
  await page.getByLabel('Or paste CSV').fill('unknown\nbad')
  await page.getByRole('button', { name: 'Validate and import' }).click()
  await expect(page.getByRole('alert')).toContainText('Unknown columns')
  await page.getByLabel('Choose a CSV file').setInputFiles({
    name: 'oversized.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2_000_001),
  })
  await expect(page.getByRole('alert')).toContainText('Maximum CSV file size')
  await page.getByLabel('Choose a CSV file').setInputFiles({
    name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  })
  await expect(page.getByLabel('Or paste CSV')).toHaveValue(csv)
  await page.getByRole('button', { name: 'Validate and import' }).click()
  await expect(page.getByRole('status')).toContainText('1 stocks imported')
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await expect(page.getByText('research candidate', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText(values.business)).toBeVisible()
  await expect(page.getByText('PASS: ROE at least 15%', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Paper portfolio', exact: true }).click()
  await page.getByLabel('Research candidate').selectOption('UI&TEST')
  await page.getByLabel('Whole shares').fill('301')
  await page.getByLabel('Hypothetical entry price (INR)').fill('100')
  await page.getByLabel('Total transaction cost (INR)').fill('0')
  await page.getByRole('button', { name: 'Record hypothetical buy' }).click()
  await expect(page.getByRole('alert')).toContainText('10% stock exposure limit')
  await page.getByLabel('Whole shares').fill('100')
  await page.getByLabel('Total transaction cost (INR)').fill('10')
  await page.getByRole('button', { name: 'Record hypothetical buy' }).click()
  await expect(page.getByRole('status')).toContainText('not an actual order')
  await expect(page.getByText('₹2,89,990.00', { exact: true })).toBeVisible()
  await page.getByLabel('Contribution (INR)').fill('500')
  await page.getByRole('button', { name: 'Record contribution' }).click()
  await expect(page.getByRole('status')).toContainText('Paper contribution recorded')
  await page.reload()
  await expect(page.getByText('₹2,90,490.00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Methodology', exact: true }).click()
  await expect(page.getByText('A research checklist. Not a crystal ball.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Methodology', exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  await page.getByRole('button', { name: 'Paper portfolio', exact: true }).click()
  await page.getByLabel('Research candidate').selectOption('UI&TEST')
  await page.getByLabel('Whole shares').fill('1')
  await page.getByLabel('Hypothetical entry price (INR)').fill('100')
  await page.getByLabel('Total transaction cost (INR)').fill('1')
  await page.route('**/api/stocks', route => route.fulfill({
    status: 503, contentType: 'text/plain', body: 'Unavailable',
  }))
  await page.getByRole('button', { name: 'Record hypothetical buy' }).click()
  await expect(page.getByRole('status')).toContainText('Hypothetical buy recorded')
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.getByLabel('Whole shares')).toHaveValue('')
  await page.unroute('**/api/stocks')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('₹2,90,389.00', { exact: true })).toBeVisible()
})
