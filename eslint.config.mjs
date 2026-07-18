import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Relative imports hide where a file sits in the architecture and break on every move.
 * Declared once because the rule must be re-stated in every block that narrows it.
 */
const RELATIVE_IMPORT_PATTERN = {
    group: ['./*', '../*'],
    message: 'Relative imports are not allowed. Please use absolute imports starting with "src/" or "test/".',
};

export default tseslint.config(
    {
        ignores: [
            'eslint.config.mjs',
            'dist/**',
            '.lintstagedrc.js',
            '.act-artifacts/**',
            '.vitest-cache/**',
            '.vitest-cache-e2e/**',
            'node_modules/**',
            'coverage/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        /**
         * Scoped to `src/` only: `test/` has no element definitions yet, so including it here would
         * make `no-unknown-files` reject every test file. See the TODO in CLAUDE.md § Testing Rules.
         */
        files: ['src/**/*.ts'],
        plugins: {
            boundaries,
            import: importPlugin,
        },
        settings: {
            /**
             * `shared` and `core` are declared as the CONCERN ROOTS, not as `**` globs, because
             * `boundaries/entry-point` treats the matched folder as the element and its `index.ts`
             * as the only legal door. A shelf (`core/security`, `core/observability`, `shared/domain`)
             * therefore never appears here — only the capabilities inside it do.
             */
            'boundaries/elements': [
                { type: 'shared', pattern: 'src/shared/domain/*' },
                { type: 'shared', pattern: 'src/shared/application/*' },
                { type: 'shared', pattern: 'src/shared/pagination' },
                { type: 'shared', pattern: 'src/shared/search' },
                { type: 'shared', pattern: 'src/shared/sort' },
                { type: 'core', pattern: 'src/core/observability/*' },
                { type: 'core', pattern: 'src/core/security/*' },
                { type: 'core', pattern: 'src/core/cache' },
                { type: 'core', pattern: 'src/core/config' },
                { type: 'core', pattern: 'src/core/database' },
                { type: 'core', pattern: 'src/core/doc' },
                { type: 'core', pattern: 'src/core/email' },
                { type: 'core', pattern: 'src/core/event-bus' },
                { type: 'core', pattern: 'src/core/exception' },
                { type: 'core', pattern: 'src/core/http' },
                { type: 'bootstrap', pattern: 'src/{instrument,tracing}.ts', mode: 'file' },
                { type: 'moduleIndex', pattern: 'src/module/*/index.ts', mode: 'file', capture: ['module'] },
                { type: 'facade', pattern: 'src/module/*/*.facade.ts', mode: 'file', capture: ['module'] },
                { type: 'module', pattern: 'src/module/*/*.module.ts', mode: 'file', capture: ['module'] },
                { type: 'domain', pattern: 'src/module/*/domain/**', capture: ['module'] },
                { type: 'application', pattern: 'src/module/*/application/**', capture: ['module'] },
                { type: 'infrastructure', pattern: 'src/module/*/infrastructure/**', capture: ['module'] },
                { type: 'presentation', pattern: 'src/module/*/presentation/**', capture: ['module'] },
            ],
            'boundaries/ignore': ['src/main.ts', 'src/app.module.ts'],
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                },
            },
        },
        rules: {
            'boundaries/no-unknown': 'error',
            /**
             * A file that matches no element would otherwise live outside every rule — which is
             * exactly how a fourth top-level pillar gets added by accident.
             */
            'boundaries/no-unknown-files': 'error',
            /**
             * Barrels are BOUNDARIES: once a concern exposes an `index.ts`, reaching past it into
             * `port/`, `adapter/` or a kind folder re-opens what the boundary was meant to close.
             */
            'boundaries/entry-point': [
                'error',
                {
                    default: 'disallow',
                    rules: [
                        { target: ['shared', 'core'], allow: 'index.ts' },
                        { target: ['bootstrap', 'moduleIndex', 'facade', 'module'], allow: '*' },
                        {
                            target: ['domain', 'application', 'infrastructure', 'presentation'],
                            allow: '**',
                        },
                    ],
                },
            ],
            /**
             * The domain layer must stay framework-free so a bounded context can be lifted into its
             * own service without a rewrite. Expressed as an allowlist: a package nobody vetted is
             * denied by default rather than waiting to be added to a denylist.
             */
            'boundaries/external': [
                'error',
                {
                    default: 'allow',
                    rules: [
                        {
                            from: ['domain'],
                            disallow: ['*'],
                            message:
                                'The domain layer is pure TypeScript and must not import any external package (CLAUDE.md § Architecture 1).',
                        },
                    ],
                },
            ],
            'boundaries/dependencies': [
                'error',
                {
                    default: 'disallow',
                    rules: [
                        {
                            from: { type: 'shared' },
                            allow: [{ to: { type: 'shared' } }],
                        },
                        {
                            from: { type: 'core' },
                            allow: [{ to: { type: 'shared' } }, { to: { type: 'core' } }],
                        },
                        {
                            from: { type: 'bootstrap' },
                            allow: [{ to: { type: 'shared' } }, { to: { type: 'core' } }],
                        },
                        {
                            from: { type: 'domain' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'application' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'infrastructure' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'domain', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'infrastructure', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'moduleIndex' } },
                            ],
                        },
                        {
                            from: { type: 'presentation' },
                            allow: [
                                { to: { type: 'shared' } },
                                { to: { type: 'core' } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'presentation', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'facade' },
                            allow: [{ to: { type: 'application', captured: { module: '{{from.captured.module}}' } } }],
                        },
                        {
                            from: { type: 'moduleIndex' },
                            allow: [
                                { to: { type: 'facade', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'module', captured: { module: '{{from.captured.module}}' } } },
                            ],
                        },
                        {
                            from: { type: 'module' },
                            allow: [
                                { to: { type: 'presentation', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'application', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'infrastructure', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'facade', captured: { module: '{{from.captured.module}}' } } },
                                { to: { type: 'moduleIndex' } },
                                { to: { type: 'core' } },
                                { to: { type: 'shared' } },
                            ],
                        },
                    ],
                },
            ],
            /**
             * `boundaries` only constrains the direction between layers; a cycle inside one layer is
             * invisible to it. `forwardRef()` is prohibited, so nothing else would catch this.
             */
            'import/no-cycle': ['error', { maxDepth: Infinity }],
            'import/no-self-import': 'error',
            'import/no-useless-path-segments': ['error', { noUselessIndex: true }],
        },
    },
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [RELATIVE_IMPORT_PATTERN],
                    paths: [
                        {
                            /**
                             * Only the emitter class is banned. `@OnEvent` and `EventEmitterModule`
                             * are the subscribe and wiring sides, which have no port to go through.
                             */
                            name: '@nestjs/event-emitter',
                            importNames: ['EventEmitter2'],
                            message:
                                'Publish through IEventBusPort (TOKEN_EVENT_BUS_PORT) so the transport stays swappable (CLAUDE.md § Architecture 5).',
                        },
                    ],
                },
            ],
        },
    },
    {
        /** The event bus adapter IS the seam that owns the transport, so it is the one legal caller. */
        files: ['src/core/event-bus/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [RELATIVE_IMPORT_PATTERN] }],
        },
    },
);
