import {defineConfig} from '@playwright/test';

const port = Number(process.env.EMBER_E2E_PORT ?? 5188);
const devPort = port + 1;
const baseURL = `http://127.0.0.1:${port}`;
const devURL = `http://127.0.0.1:${devPort}`;
const viewport = {width: 390, height: 844};
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
    launchOptions: {
      executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    // The e2e build is a production build; the service worker is covered by the PWA suite.
    serviceWorkers: 'block',
  },
  // Ember is phone-only: phone-sized projects. Tests set Pixel 6 or other phone sizes
  // themselves where it matters. Tests run against a bundled build, because a dev-server page
  // load fetches every source module separately, which made page loads most of the CI time.
  // Tests that import or patch source modules by URL (`/src/...`) only work on the dev server
  // and are tagged @dev-server.
  projects: [
    {name: 'mobile', grepInvert: /@dev-server/, use: {viewport, baseURL}},
    {name: 'mobile-dev-server', grep: /@dev-server/, use: {viewport, baseURL: devURL}},
  ],
  // The `e2e` mode keeps the `?demo=1` entry that real builds strip. Dedicated strict-port
  // servers and output dir: reusing another checkout's server silently tests the wrong source,
  // and the PWA suite rewrites files in `dist/`.
  webServer: [
    {
      command: `NODE_ENV=production node node_modules/vite/bin/vite.js build --mode e2e --outDir dist-e2e --logLevel warn && node node_modules/vite/bin/vite.js preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: `NODE_ENV=development node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${devPort} --strictPort`,
      url: devURL,
      reuseExistingServer: false,
    },
  ],
});
