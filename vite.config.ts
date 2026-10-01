import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {localCsvMiddleware} from './scripts/local-csv.ts';
export default defineConfig({plugins: [react(), {
  name:'private-local-csv', apply:'serve',
  configureServer(server) {server.middlewares.use(localCsvMiddleware(process.env.GYM_LOG_CSV));},
}], server: {host: '127.0.0.1', port: 5188, strictPort: true}});
