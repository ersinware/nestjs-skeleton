/**
 * @file index.ts
 * @description Public entry point of the cqrs pipeline concern. Nothing outside may import past this
 * barrel, and only the contract surface crosses it: the pipelines every edge dispatches through, the
 * wiring module, and the opt-in query/command interfaces. Behavior classes, behavior interfaces and
 * the composition tokens are internal wiring bound by the module via deep import.
 */

export { type ICacheInvalidatingCommand } from 'src/core/cqrs/cache-invalidation.behavior';
export { CommandPipeline } from 'src/core/cqrs/command.pipeline';
export { CqrsPipelineModule } from 'src/core/cqrs/module';
export { type ICacheableQuery } from 'src/core/cqrs/query-caching.behavior';
export { QueryPipeline } from 'src/core/cqrs/query.pipeline';
