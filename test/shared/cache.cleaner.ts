/**
 * @file cache.cleaner.ts
 * @description Utility functions to clear Redis cache state between E2E test cycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_CACHE_CLEANER_PORT, type ICacheCleanerPort } from 'src/core/cache';

/**
 * Invokes the cache cleaner provider to clear cache keys and database states during test cycles.
 *
 * @param app The running NestFastifyApplication instance.
 */
export async function cleanupCache(app: NestFastifyApplication): Promise<void> {
    await app.get<ICacheCleanerPort>(TOKEN_CACHE_CLEANER_PORT).cleanup();
}
