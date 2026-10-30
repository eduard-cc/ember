import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import {pwaShell} from './scripts/pwa-build.ts';

export default defineConfig(({command}) => ({
  plugins: [tailwindcss(), react(), pwaShell()],
  // Builds keep the eager image URLs; see src/catalog/image-urls.dev.ts.
  resolve: {
    alias: command === 'serve' ? [{find: /^\.\/image-urls$/, replacement: './image-urls.dev'}] : [],
  },
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
}));
