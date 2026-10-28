import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import {localCsvMiddleware} from './scripts/local-csv.ts';
import {pwaShell} from './scripts/pwa-build.ts';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    pwaShell(),
    {
      name: 'private-local-csv',
      apply: 'serve',
      configureServer(server) {
        const localCsv = localCsvMiddleware(process.env.EMBER_CSV);
        // Connect ignores returned promises; the middleware handles its own read errors.
        server.middlewares.use((req, res, next) => void localCsv(req, res, next));
      },
    },
  ],
  server: {
    proxy: {
      '/api/v1': {
        target: `http://127.0.0.1:${process.env.EMBER_TEST_API_PORT ?? '5190'}`,
        ...(process.env.EMBER_TEST_HARNESS === '1'
          ? {headers: {'Tailscale-User-Login': 'ember-browser@example.invalid'}}
          : {}),
      },
    },
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
});
