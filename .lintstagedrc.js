module.exports = {
    '**/*.{js,mjs,cjs,ts,mts,cts}': () => 'npm run lint:fix',
    '**/*': () => 'npm run format',
    '**/*.ts': () => 'npm run test:type',
};
