/**
 * @file index.ts
 * @description Public entry point of the cqrs pipeline concern. Nothing outside may import past this
 * barrel.
 */

export * from 'src/core/cqrs/cache-invalidation.behavior';
export * from 'src/core/cqrs/command-pipeline';
export * from 'src/core/cqrs/module';
export * from 'src/core/cqrs/query-caching.behavior';
export * from 'src/core/cqrs/query-pipeline';
