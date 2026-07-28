/**
 * @file index.ts
 * @description Public entry point of the cache concern. Nothing outside may import past this barrel.
 * Adapters are deliberately NOT exported: they are bound to their ports inside the module, so a
 * consumer can only reach the contract surface — never an adapter class.
 */

export * from 'src/core/cache/cache-client.token';
export * from 'src/core/cache/module';
export * from 'src/core/cache/port/cache-cleaner.port';
export * from 'src/core/cache/port/cache-health.port';
export * from 'src/core/cache/port/cache.port';
export * from 'src/core/cache/redis-client.factory';
