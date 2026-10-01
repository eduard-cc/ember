import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5188',
    launchOptions: {executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']},
  },
  projects: [
    {name: 'desktop', use: {viewport: {width: 1440, height: 1000}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}}},
  ],
  webServer: {command: 'npm run dev', url: 'http://127.0.0.1:5188', reuseExistingServer: true},
});
