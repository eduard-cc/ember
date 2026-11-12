// ESLint setup for the web app, written as a native flat config.
// The react-refresh plugin is left out: several views export small helpers next to
// their component, and the only cost is a full reload instead of Fast Refresh in development.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier/flat';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.local/**',
      '.impeccable/**',
      '.hermes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended-type-checked'],
  reactHooks.configs.flat.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.browser, ...globals.node},
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {react: {version: 'detect'}},
    rules: {
      // Async JSX event handlers are fine; keep the other checks.
      '@typescript-eslint/no-misused-promises': ['error', {checksVoidReturn: {attributes: false}}],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
      // TypeScript already checks component props.
      'react/prop-types': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs['flat/disable-type-checked'],
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests read untyped JSON, IndexedDB and page.evaluate results and assert their shape.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Fault injection saves and replaces browser prototype methods on purpose.
      '@typescript-eslint/unbound-method': 'off',
      // IndexedDB fixtures reject with the request's DOMException, as the browser does.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // fetch stubs stay async to match fetch's signature.
      '@typescript-eslint/require-await': 'off',
      // fetch stubs only ever receive string URLs.
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  prettier,
];
