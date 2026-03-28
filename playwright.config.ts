import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 10 * 60 * 1000, // 10 min global — apache job can take a while
  fullyParallel: false,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Build shared types then start backend, wait for it to be ready
      command: 'npm run build --workspace=shared && npm run dev:server',
      url: 'http://localhost:3000/api/v1/jobs',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Then start frontend
      command: 'npm run dev:client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
