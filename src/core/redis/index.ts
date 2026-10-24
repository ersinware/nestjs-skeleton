/**
 * @file index.ts
 * @description Public entry point for Redis client creation and availability classification.
 */

export { createNodeRedisClient } from 'src/core/redis/node-redis-client.factory';
export { isNodeRedisUnavailable } from 'src/core/redis/node-redis-error.util';
export { createRedisClient } from 'src/core/redis/redis-client.factory';
export { isRedisUnavailable } from 'src/core/redis/redis-error.util';
