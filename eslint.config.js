import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const typeScriptFiles = ['**/*.{ts,tsx}']

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      '.playwright-mcp/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'public/data/**',
      'test-results/**'
    ]
  },
  {
    ...eslint.configs.recommended,
    files: ['**/*.{js,mjs,cjs}']
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true, ignoreVoidReturningFunctions: true }
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }]
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }]
    }
  },
  {
    files: ['scripts/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest
      }
    }
  },
  {
    // Эти mocks сохраняют динамический this оригинального метода Intl.
    files: ['src/App.test.tsx', 'src/domain/prayerCalculation.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off'
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: globals.node
    }
  }
)
