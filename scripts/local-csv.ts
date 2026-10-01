import {readFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';

// This middleware is installed only on the loopback-bound Vite development server.
// The path comes from the operator's environment, never a request parameter.
export function localCsvMiddleware(path: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/__local/strong.csv') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }
    if (!path) {
      res.statusCode = 404;
      res.end('No local CSV configured');
      return;
    }
    try {
      const csv = await readFile(path, 'utf8');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.end(csv);
    } catch {
      res.statusCode = 500;
      res.end('The configured local CSV could not be read.');
    }
  };
}
