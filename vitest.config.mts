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
        // `test/architecture/` tests the repository's own structure, so it runs with the unit
        // suite; the e2e config matches only `*.e2e-spec.ts` and boots an app.
        include: ['src/**/*.spec.ts', 'test/architecture/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
        },
    },
});
