/**
 * @file index.ts
 * @description Public entry point of the cache concern. Nothing outside may import past this barrel.
 */

export { CacheModule } from 'src/core/cache/module';
export { TOKEN_CACHE_CLEANER_PORT, type ICacheCleanerPort } from 'src/core/cache/port/cache-cleaner.port';
export { TOKEN_CACHE_EVICTION_PORT, type ICacheEvictionPort } from 'src/core/cache/port/cache-eviction.port';
export { TOKEN_CACHE_HEALTH_PORT, type ICacheHealthPort } from 'src/core/cache/port/cache-health.port';
export { TOKEN_CACHE_PORT, type ICachePort } from 'src/core/cache/port/cache.port';
export { createRedisClient } from 'src/core/cache/redis-client.factory';
