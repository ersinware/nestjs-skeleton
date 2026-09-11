import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    oxc: false,
    resolve: {
        tsconfigPaths: true,
    },
    cacheDir: './.vitest-cache-e2e',
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
        include: ['test/**/*.e2e-spec.ts'],
        environment: 'node',
        fileParallelism: false,
    },
});
