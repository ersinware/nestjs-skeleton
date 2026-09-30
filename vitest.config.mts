import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    oxc: false,
    resolve: {
        tsconfigPaths: true,
    },
    cacheDir: './.vitest-cache',
    plugins: [
        swc.vite({
            module: { type: 'es6' },
        }),
    ],
    test: {
        globals: true,
        root: './',
        restoreMocks: true,
        // Since Vitest 3, `restoreMocks` touches only `vi.spyOn` spies; `clearMocks` is what wipes
        // call history on plain `vi.fn()` mocks between tests.
        clearMocks: true,
        // `eslint.config.spec.ts` tests the repository's own structure, so it runs with the unit
        // suite; the e2e config matches only `*.e2e-spec.ts` and boots an app.
        include: ['src/**/*.spec.ts', 'eslint.config.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
        },
    },
});
