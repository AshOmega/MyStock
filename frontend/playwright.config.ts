import { defineConfig } from '@playwright/test'

if (!process.env.MYSTOCK_DB) {
  throw new Error('Set MYSTOCK_DB to a dedicated test database, not your personal paper ledger.')
}

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    actionTimeout: 15_000,
    launchOptions: process.env.MYSTOCK_TEST_BROWSER ? {
      executablePath: process.env.MYSTOCK_TEST_BROWSER,
    } : {},
  },
  webServer: [
    {
      command: '../.venv/bin/python -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8001',
      url: 'http://127.0.0.1:8001/api/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5174',
      url: 'http://127.0.0.1:5174',
      env: { MYSTOCK_API_URL: 'http://127.0.0.1:8001' },
      reuseExistingServer: false,
    },
  ],
})
