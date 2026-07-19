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
        clearMocks: true,
        // `test/architecture/` holds tests about the repository's own structure, so they belong with
        // the unit run rather than the e2e one (which matches only `*.e2e-spec.ts` and boots an app).
        include: ['src/**/*.spec.ts', 'test/architecture/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
        },
    },
});
