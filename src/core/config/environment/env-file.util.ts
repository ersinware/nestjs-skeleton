/**
 * @file env-file.util.ts
 * @description Interprets `NODE_ENV` into the dotenv file `ConfigModule` loads, so the test suite
 * runs against its own isolated configuration.
 */

import { ENV } from 'src/core/config/environment/env.constant';
import { Environment } from 'src/core/config/environment/node-env.enum';

/**
 * Reads `NODE_ENV` and resolves the dotenv file path for `ConfigModule.forRoot`.
 *
 * Reads `process.env` directly because it runs before the DI container that owns `ConfigService`
 * exists. Interpret-only, fail safe: anything but the test environment resolves to `.env`, and
 * `NODE_ENV` itself is still validated moments later by the `EnvironmentVariables` constraints.
 *
 * @returns The dotenv file path: `.env.test` under the test environment, `.env` otherwise.
 */
export function resolveEnvFilePath(): string {
    return process.env[ENV.NODE_ENV] === Environment.TEST ? '.env.test' : '.env';
}
