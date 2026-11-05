import {defineConfig} from '@playwright/test';

const port = Number(process.env.EMBER_E2E_PORT ?? 5188);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The CI runner has 4 vCPUs. Recording a trace for every test cost about a quarter of the
  // run, so CI reruns a failed test once with tracing, and a pass on that retry still fails.
  workers: process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  // A mass breakage would otherwise retry every failure and run into the job timeout.
  maxFailures: process.env.CI ? 10 : 0,
  reporter: process.env.CI ? [['line'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL,
    launchOptions: {
      executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
  },
  projects: [
    // CI minutes are capped, so CI runs every flow at phone size and only the @desktop-tagged
    // (desktop-only) tests at desktop size. Local runs cover both projects in full.
    {
      name: 'desktop',
      use: {viewport: {width: 1440, height: 1000}},
      grep: process.env.CI ? /@desktop/ : undefined,
    },
    {name: 'mobile', use: {viewport: {width: 390, height: 844}}},
  ],
  // A dedicated strict-port server: reusing another checkout's dev server silently tests the wrong source.
  webServer: {
    command: `NODE_ENV=development npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
