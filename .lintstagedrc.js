// String entries get the staged file list appended, so prettier/eslint run only on what changed.
// The npm scripts cannot be reused here: they end with a `.` target, which would lint the whole
// repo regardless. tsc stays a whole-project run — type-checking single files ignores the project
// config — and `--incremental` keeps it cheap.
module.exports = {
    '**/*': 'prettier --write --cache --cache-location .prettiercache --ignore-unknown',
    // Typed lint loads the whole project's type graph regardless of the staged file count, which
    // overflows Node's default ~2 GB heap; the flag raises it for this one process only.
    '**/*.{js,mjs,cjs,ts,mts,cts}':
        'node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js --fix --cache --max-warnings 0 --no-warn-ignored',
    '**/*.ts': () => 'npm run test:type',
};
