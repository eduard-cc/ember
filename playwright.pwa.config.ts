import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  testMatch: '**/*.spec.ts',
  // Lifecycle tests rewrite dist/sw.js. Never parallelize them or share this build with another suite.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  outputDir: 'test-results/pwa',
  reporter: process.env.CI
    ? [['line'], ['html', {outputFolder: 'playwright-pwa-report', open: 'never'}]]
    : 'list',
  timeout: 30000,
  use: {
    ...devices['Pixel 6'],
    baseURL: 'http://127.0.0.1:5193',
    serviceWorkers: 'allow',
    launchOptions: {
      executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
  },
  webServer: {
    command:
      'NODE_ENV=production node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5193 --strictPort',
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
