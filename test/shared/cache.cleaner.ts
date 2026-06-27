/**
 * @file cache.cleaner.ts
 * @description Utility functions to clear Redis cache state between E2E test cycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_CACHE_CLEANER_SERVICE } from 'src/common/port/cache/cache.constant';
import type { ICacheCleanerService } from 'src/common/port/cache/cache-cleaner-service.interface';

/**
 * Invokes the cache cleaner provider to clear cache keys and database states during test cycles.
 *
 * @param app The running NestFastifyApplication instance.
 */
export async function cleanupCache(app: NestFastifyApplication): Promise<void> {
    await app.get<ICacheCleanerService>(TOKEN_CACHE_CLEANER_SERVICE).cleanup();
}
