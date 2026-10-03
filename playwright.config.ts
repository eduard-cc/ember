import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5188',
    launchOptions: {
      executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
  },
  projects: [
    {name: 'desktop', use: {viewport: {width: 1440, height: 1000}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}}},
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: !process.env.CI,
  },
});
