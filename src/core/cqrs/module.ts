/**
 * @file module.ts
 * @description Wires the CQRS behavior pipelines: composes the ordered behavior lists and exposes
 * QueryPipeline/CommandPipeline as the buses every edge dispatches through. Re-exports the framework
 * CqrsModule so an importer gets both the pipelines and the raw buses (handler registration, facades).
 */

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CacheModule } from 'src/core/cache';
import { CacheInvalidationBehavior } from 'src/core/cqrs/cache-invalidation.behavior';
import { CommandPipeline, TOKEN_COMMAND_BEHAVIORS, type ICommandBehavior } from 'src/core/cqrs/command.pipeline';
import { QueryCachingBehavior } from 'src/core/cqrs/query-caching.behavior';
import { QueryPipeline, TOKEN_QUERY_BEHAVIORS, type IQueryBehavior } from 'src/core/cqrs/query.pipeline';

/**
 * The composition point for the CQRS pipelines. The behavior order lives here and nowhere else: a
 * new cross-cutting behavior (transaction, metrics, outbox) is added by binding it into these lists.
 */
@Module({
    imports: [CqrsModule, CacheModule],
    providers: [
        QueryPipeline,
        CommandPipeline,
        QueryCachingBehavior,
        CacheInvalidationBehavior,
        {
            provide: TOKEN_QUERY_BEHAVIORS,
            useFactory: (caching: QueryCachingBehavior): IQueryBehavior[] => [caching],
            inject: [QueryCachingBehavior],
        },
        {
            provide: TOKEN_COMMAND_BEHAVIORS,
            useFactory: (invalidation: CacheInvalidationBehavior): ICommandBehavior[] => [invalidation],
            inject: [CacheInvalidationBehavior],
        },
    ],
    exports: [QueryPipeline, CommandPipeline, CqrsModule],
})
export class CqrsPipelineModule {}
