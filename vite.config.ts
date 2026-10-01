import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import {localCsvMiddleware} from './scripts/local-csv.ts';
import {pwaShell} from './scripts/pwa-build.ts';

export default defineConfig({
  plugins: [
    react(),
    pwaShell(),
    {
      name: 'private-local-csv',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use(localCsvMiddleware(process.env.GYM_LOG_CSV));
      },
    },
  ],
  server: {
    proxy: {
      '/api/v1': {
        target: `http://127.0.0.1:${process.env.GYM_LOG_TEST_API_PORT ?? '5190'}`,
        ...(process.env.GYM_LOG_TEST_HARNESS === '1'
          ? {headers: {'Tailscale-User-Login': 'gym-log-browser@example.invalid'}}
          : {}),
      },
    },
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
});
