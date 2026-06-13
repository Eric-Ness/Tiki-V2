import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Fresh-ref guard (issues #210/#212): an inline `?? {}` / `?? []` / `|| {}`
      // / `|| []` allocates a NEW reference every render. In a Zustand selector
      // return (read by useSyncExternalStore) or a React hook dependency array,
      // that fresh ref defeats reference equality and triggers the infinite
      // re-render / blank-screen crash class. The fix is a module-level EMPTY_*
      // constant (e.g. EMPTY_TABS, EMPTY_COLUMN_ORDER). Mirrors the source-scan
      // freshRefGuard.test.ts. These selectors are deliberately scoped to
      // use*Store selector calls and React hook dep arrays ONLY, so the safe
      // inline `?? {}` spread inside store-action `set((state) => ...)` bodies
      // (kanbanStore.ts, selectionStore.ts) is NOT flagged.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^use[A-Z].*Store$/] LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/] > ObjectExpression[properties.length=0]',
          message:
            'Inline `?? {}` / `|| {}` in a Zustand selector (use*Store) creates a fresh reference every render — the #210/#212 useSyncExternalStore blank-screen crash class. Use a module-level EMPTY_* constant instead.',
        },
        {
          selector:
            'CallExpression[callee.name=/^use[A-Z].*Store$/] LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/] > ArrayExpression[elements.length=0]',
          message:
            'Inline `?? []` / `|| []` in a Zustand selector (use*Store) creates a fresh reference every render — the #210/#212 useSyncExternalStore blank-screen crash class. Use a module-level EMPTY_* constant instead.',
        },
        {
          selector:
            'CallExpression[callee.name=/^use(Effect|Memo|Callback|LayoutEffect|ImperativeHandle)$/] > ArrayExpression LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/] > ObjectExpression[properties.length=0]',
          message:
            'Inline `?? {}` / `|| {}` in a React hook dependency array creates a fresh reference every render, defeating memo equality — the #210/#212 crash class. Use a module-level EMPTY_* constant instead.',
        },
        {
          selector:
            'CallExpression[callee.name=/^use(Effect|Memo|Callback|LayoutEffect|ImperativeHandle)$/] > ArrayExpression LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/] > ArrayExpression[elements.length=0]',
          message:
            'Inline `?? []` / `|| []` in a React hook dependency array creates a fresh reference every render, defeating memo equality — the #210/#212 crash class. Use a module-level EMPTY_* constant instead.',
        },
      ],
    },
  },
])
