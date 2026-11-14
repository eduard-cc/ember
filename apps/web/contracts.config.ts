import {fileURLToPath} from 'node:url';

/**
 * `@ember/contracts` is loaded from its source. Its own `zod` import resolves from this app's
 * node_modules (dedupe), so the bundle holds one zod. tsconfig.json maps the same two names.
 */
export const contracts = {
  alias: {
    find: /^@ember\/contracts$/,
    replacement: fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
  },
  dedupe: ['zod'],
};
