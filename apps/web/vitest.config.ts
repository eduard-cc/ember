import {defineConfig} from 'vitest/config';

import {contracts} from './contracts.config.ts';

export default defineConfig({
  resolve: {alias: [contracts.alias], dedupe: contracts.dedupe},
  test: {include: ['tests/**/*.test.{ts,tsx}']},
});
