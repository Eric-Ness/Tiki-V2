import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Tauri build artifacts (codegen assets under target/, generated bindings
  // under gen/) are not source and must not be linted — they trip parsing errors.
  globalIgnores(['dist', 'src-tauri/target', 'src-tauri/gen']),
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

      // Honor the `_`-prefix intentional-discard convention. Unused vars stay an
      // ERROR (catches real dead code), but `_`-prefixed names (e.g. `_removed`,
      // `_r1`, `_get`, destructured `_removedTabs` array holes) are deliberate
      // discards — e.g. pulling a key out of an object/array to drop it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // --- Advisory rules downgraded to WARN (non-blocking) ---
      // These come from eslint-plugin-react-hooks v7's `recommended` preset,
      // which now bundles the React Compiler's advisory diagnostics. This project
      // has NOT adopted the React Compiler, so these are guidance, not
      // correctness errors. Tracked for incremental cleanup. NOTE:
      // `react-hooks/rules-of-hooks` (real correctness rule) stays an ERROR via
      // the recommended preset and is intentionally NOT listed here.
      'react-hooks/set-state-in-effect': 'warn', // Compiler advisory: setState in effect body
      'react-hooks/refs': 'warn', // Compiler advisory: ref access during render
      'react-hooks/purity': 'warn', // Compiler advisory: render-phase purity
      'react-hooks/preserve-manual-memoization': 'warn', // Compiler advisory: manual deps vs inferred
      // exhaustive-deps is conventionally a warning (deps choices are often
      // deliberate); react-refresh/only-export-components is a dev fast-refresh
      // nicety, not a correctness concern.
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
