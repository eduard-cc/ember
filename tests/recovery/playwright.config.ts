import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5192',
    launchOptions: {executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']},
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5192 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:5192/tests/recovery/index.html',
    reuseExistingServer: false,
  },
});
