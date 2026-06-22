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
        include: ['src/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
        },
    },
});
