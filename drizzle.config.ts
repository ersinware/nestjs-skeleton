import { defineConfig } from 'drizzle-kit';
import fs from 'fs';
import { ENV } from './src/common/config/constant/env.constant';
import { Environment } from './src/common/enum/config/environment.enum';

const envFile = process.env[ENV.NODE_ENV] === Environment.TEST ? '.env.test' : '.env';
if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
}

let databaseUrl = process.env[ENV.DATABASE_URL];
if (!databaseUrl) {
    throw new Error(`${ENV.DATABASE_URL} environment variable is not defined.`);
}

if (!fs.existsSync('/.dockerenv') && databaseUrl.includes('@postgres:')) {
    databaseUrl = databaseUrl.replace('@postgres:', '@127.0.0.1:');
}

export default defineConfig({
    schema: './src/database/schema/index.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: databaseUrl,
    },
    verbose: true,
    strict: true,
});
