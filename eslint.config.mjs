import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
        files: ['**/*.ts'],
        plugins: {
            boundaries,
            import: importPlugin,
        },
        settings: {
            'boundaries/elements': [
                { type: 'shared', pattern: 'src/shared/**/*' },
                { type: 'core', pattern: 'src/core/**/*' },
                { type: 'moduleIndex', pattern: 'src/module/*/index.ts', mode: 'file', capture: ['module'] },
                { type: 'facade', pattern: 'src/module/*/*.facade.ts', mode: 'file', capture: ['module'] },
                { type: 'module', pattern: 'src/module/*/*.module.ts', mode: 'file', capture: ['module'] },
                { type: 'domain', pattern: 'src/module/*/domain/**/*', capture: ['module'] },
                { type: 'application', pattern: 'src/module/*/application/**/*', capture: ['module'] },
                { type: 'infrastructure', pattern: 'src/module/*/infrastructure/**/*', capture: ['module'] },
                { type: 'presentation', pattern: 'src/module/*/presentation/**/*', capture: ['module'] },
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
                                { to: { type: 'facade' } },
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
                                { to: { type: 'facade' } },
                                { to: { type: 'moduleIndex' } },
                                { to: { type: 'core' } },
                                { to: { type: 'shared' } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['./*', '../*'],
                            message:
                                'Relative imports are not allowed. Please use absolute imports starting with "src/" or "test/".',
                        },
                    ],
                },
            ],
        },
    },
);
