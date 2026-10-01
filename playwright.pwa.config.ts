import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5193',
    serviceWorkers: 'allow',
    launchOptions: {executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']},
  },
  webServer: {
    command:
      'NODE_ENV=production node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5193 --strictPort',
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
