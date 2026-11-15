// ESLint setup for the server. Prettier runs separately through format:check.
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = [
	{
		ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
	},
	...tseslint.configs['flat/recommended-type-checked'],
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: __dirname,
				sourceType: 'module',
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', ignoreRestSiblings: true}],
			// The server reports startup and shutdown on the console.
			'no-console': 'off',
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			// Tests read untyped JSON responses and query rows and assert their shape.
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			// node:test tracks the promise each top-level test() call returns.
			'@typescript-eslint/no-floating-promises': 'off',
			// Fault injection saves and replaces service prototype methods on purpose.
			'@typescript-eslint/unbound-method': 'off',
		},
	},
	prettierConfig,
];
