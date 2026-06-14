import jsdoc from 'eslint-plugin-jsdoc'
import tsParser from '@typescript-eslint/parser'

/**
 * eslint is used ONLY to enforce documentation on exported surfaces
 * (eslint-plugin-jsdoc). biome remains the general linter/formatter. This config
 * requires a JSDoc/TSDoc comment to EXIST on exported declarations and validates
 * tag syntax — it does NOT force `@param`/`@returns` descriptions (that just
 * produces type-restating noise). See API §14 / UI §16.
 */
const tagSyntax = {
  // TSDoc tags (@remarks) + standard JSDoc tags used across the repo.
  'jsdoc/check-tag-names': ['error', { definedTags: ['remarks', 'throws', 'example', 'see'] }],
  'jsdoc/check-alignment': 'error',
}

const languageOptions = {
  parser: tsParser,
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: { ecmaFeatures: { jsx: true } },
}

export default [
  // Never lint generated/output/declaration/story/test files.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/*.d.ts',
      '**/*.stories.tsx',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
  },

  // Module boundary rule (api-spec §0 O3): a module may not import another
  // module's `schema/` (or repository) — cross-module access goes through
  // @perduraflow/contracts + the consumed read interface only. This is what
  // makes a cross-module query uncompilable rather than merely discouraged.
  // The migration generator (apps/api/drizzle.config.ts) and the seed
  // (apps/api/src/db/seed.ts) are NOT under modules/, so they are exempt by
  // design — they legitimately aggregate every module's schema.
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['apps/api/src/modules/**/schema/**'],
    languageOptions,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../*/schema',
                '../*/schema/*',
                '../../*/schema',
                '../../*/schema/*',
                '**/modules/*/schema',
                '**/modules/*/schema/*',
              ],
              message:
                "Module boundary (api-spec §0 O3): a module may not import another module's schema/. Use @perduraflow/contracts + the consumed read interface.",
            },
            {
              group: ['../*/*.repository', '../../*/*.repository'],
              message:
                "Module boundary (O1): import the other module's contract/read interface, not its repository.",
            },
          ],
        },
      ],
    },
  },

  // Base: exported classes, functions, and const declarations (covers UI
  // components built with styled(), hooks, stores, providers, guards, exported
  // helpers). Presence only — no forced param/return descriptions.
  {
    files: [
      'apps/api/src/**/*.ts',
      'packages/ui/src/**/*.{ts,tsx}',
      'packages/app/hooks/**/*.{ts,tsx}',
      'packages/app/stores/**/*.ts',
    ],
    plugins: { jsdoc },
    languageOptions,
    rules: {
      ...tagSyntax,
      'jsdoc/require-jsdoc': [
        'error',
        {
          // Disable all defaults; only the export-scoped contexts below apply
          // (so internal, non-exported declarations are never required).
          require: {
            FunctionDeclaration: false,
            ClassDeclaration: false,
            MethodDefinition: false,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
            ClassExpression: false,
          },
          // Target the export statement (not the inner declarator) so a JSDoc
          // written before `export const/function/class` is recognized. Excludes
          // re-exports (`export { x }`) and type aliases.
          contexts: [
            'ExportNamedDeclaration[declaration.type="FunctionDeclaration"]',
            'ExportNamedDeclaration[declaration.type="ClassDeclaration"]',
            'ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
          ],
        },
      ],
    },
  },

  // Self-describing plumbing not in API §14's list — exempt rather than write
  // filler: Nest modules (pure wiring), the data layer (schema tables, ulid,
  // drizzle module, seed) and repositories (thin Drizzle CRUD; method names say
  // all). Services/controllers/providers/guards/components/hooks/stores below
  // still require docs.
  {
    files: [
      'apps/api/src/**/*.module.ts',
      'apps/api/src/db/**/*.ts',
      'apps/api/src/**/*.repository.ts',
      'apps/api/src/**/*.db.ts',
      'apps/api/src/**/*.mapper.ts',
    ],
    plugins: { jsdoc },
    languageOptions,
    rules: { 'jsdoc/require-jsdoc': 'off' },
  },

  // Services + controllers additionally require docs on every public method —
  // the intent/ownership/tenant/@throws contract surface (API §14). Private
  // helpers (TS `private`) and constructors are exempt.
  {
    files: ['apps/api/src/**/*.service.ts', 'apps/api/src/**/*.controller.ts'],
    plugins: { jsdoc },
    languageOptions,
    rules: {
      ...tagSyntax,
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: false,
            ClassDeclaration: false,
            MethodDefinition: false,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
            ClassExpression: false,
          },
          contexts: [
            'ExportNamedDeclaration[declaration.type="ClassDeclaration"]',
            'MethodDefinition[accessibility!="private"][kind!="constructor"]',
          ],
        },
      ],
    },
  },
]
