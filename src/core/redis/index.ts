/**
 * @file index.ts
 * @description Public entry point for Redis client creation and availability classification.
 */

export { createRedisClient } from 'src/core/redis/redis-client.factory';
export { isRedisUnavailable } from 'src/core/redis/redis-error.util';
