import {defineConfig} from '@playwright/test';

const port = Number(process.env.GYM_LOG_E2E_PORT ?? 5188);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL,
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
  // A dedicated strict-port server: reusing another checkout's dev server silently tests the wrong source.
  webServer: {
    command: `NODE_ENV=development npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
