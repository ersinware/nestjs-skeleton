import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    cacheDir: './.vitest-cache-e2e',
    plugins: [
        tsconfigPaths(),
        swc.vite({
            module: { type: 'es6' },
        }),
    ],
    test: {
        globals: true,
        root: './',
        include: ['test/**/*.e2e-spec.ts'],
        environment: 'node',
        fileParallelism: false,
    },
});
