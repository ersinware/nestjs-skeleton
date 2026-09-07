import 'reflect-metadata'; // Must be first to support class-validator decorators loaded via src/core/config

import { defineConfig } from 'drizzle-kit';
import fs from 'fs';
import { ENV, resolveEnvFilePath } from './src/core/config';

const envFile = resolveEnvFilePath();
if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
}

let databaseUrl = process.env[ENV.DATABASE_URL];
if (!databaseUrl) {
    throw new Error(`${ENV.DATABASE_URL} environment variable is not defined.`);
}

// Outside a container the Compose hostname `postgres` does not resolve; fall back to the host port.
if (!fs.existsSync('/.dockerenv') && databaseUrl.includes('@postgres:')) {
    databaseUrl = databaseUrl.replace('@postgres:', '@127.0.0.1:');
}

export default defineConfig({
    // The audit trail is the only core-owned schema; every other table belongs to a bounded context.
    schema: ['./src/module/*/infrastructure/*.schema.ts', './src/core/observability/audit/audit.schema.ts'],
    out: './drizzle',
    dialect: 'postgresql',
    // push only touches schemas listed here (default: public only); every bounded context's logical schema must be listed.
    schemaFilter: ['public', 'admin', 'audit', 'user'],
    dbCredentials: {
        url: databaseUrl,
    },
    verbose: true,
    strict: true,
});
