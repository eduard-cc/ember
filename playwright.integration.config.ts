import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5188',
    launchOptions: {executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']},
  },
});
