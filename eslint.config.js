import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.{ts,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['playwright.config.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
