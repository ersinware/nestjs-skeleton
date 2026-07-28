/**
 * @file index.ts
 * @description Public entry point of the cqrs concern. Nothing outside may import past this barrel.
 */

export { type ICacheInvalidatingCommand } from 'src/core/cqrs/cache-invalidation.behavior';
export { CommandPipeline } from 'src/core/cqrs/command.pipeline';
export { CqrsPipelineModule } from 'src/core/cqrs/module';
export { type ICacheableQuery } from 'src/core/cqrs/query-caching.behavior';
export { QueryPipeline } from 'src/core/cqrs/query.pipeline';
