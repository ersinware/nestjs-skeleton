/**
 * @file cache.cleaner.ts
 * @description Utility functions to clear Redis cache and session stores between E2E test cycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_CACHE_CLEANER_PORT, type ICacheCleanerPort } from 'src/core/cache';
import { TOKEN_SESSION_CLEANER_PORT, type ISessionCleanerPort } from 'src/core/security/session';

/**
 * Invokes the cache and session cleaner providers to reset both Redis stores during test cycles.
 *
 * @param app The running NestFastifyApplication instance.
 */
export async function cleanupCache(app: NestFastifyApplication): Promise<void> {
    await Promise.all([
        app.get<ICacheCleanerPort>(TOKEN_CACHE_CLEANER_PORT).cleanup(),
        app.get<ISessionCleanerPort>(TOKEN_SESSION_CLEANER_PORT).cleanup(),
    ]);
}
