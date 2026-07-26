/**
 * @file query-pipeline.ts
 * @description Wraps the framework QueryBus in a behavior chain so cross-cutting read concerns
 * (caching today; metrics/tracing later) apply uniformly to every dispatched query without a
 * handler ever knowing they exist.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { IQuery, Query } from '@nestjs/cqrs';
import { QueryBus } from '@nestjs/cqrs';

/**
 * DI token for the ordered list of query behaviors composed around the bus. Bound in the pipeline
 * module so the composition (which behaviors, in what order) lives in exactly one place.
 */
export const TOKEN_QUERY_BEHAVIORS = Symbol('TOKEN_QUERY_BEHAVIORS');

/**
 * A single link in the query pipeline. Each behavior wraps the rest of the chain (`next`) and may
 * run logic before and/or after it — the classic middleware onion, ordered by the array binding.
 */
export interface IQueryBehavior {
    /**
     * Runs this behavior around the remainder of the pipeline.
     *
     * @param query The query being dispatched
     * @param next Invokes the next behavior, ending at the real bus dispatch
     * @returns The (possibly short-circuited) query result
     */
    execute<TResult>(query: IQuery, next: () => Promise<TResult>): Promise<TResult>;
}

/**
 * The single read entry point every edge (controller, facade, listener, cron) dispatches through
 * instead of the raw QueryBus, so a query cannot bypass the behavior chain. Non-participating
 * behaviors pass a query straight through, so routing every read here is free.
 */
@Injectable()
export class QueryPipeline {
    /**
     * Injects the framework bus the chain ultimately delegates to and the ordered behavior list.
     *
     * @param queryBus The framework query bus that resolves the handler
     * @param behaviors The ordered behaviors wrapping each dispatch
     */
    constructor(
        private readonly queryBus: QueryBus,
        @Inject(TOKEN_QUERY_BEHAVIORS) private readonly behaviors: readonly IQueryBehavior[],
    ) {}

    /**
     * Dispatches a query through the behavior chain. Accepts only a typed `Query<TResult>`, so the
     * result type is always inferred from the query and never falls back to `unknown` — a query that
     * does not carry its result type on the `Query<T>` base is a compile error, by design.
     *
     * @param query The query to dispatch
     * @returns The query result, from a behavior (e.g. cache) or the handler
     */
    execute<TResult>(query: Query<TResult>): Promise<TResult> {
        const dispatch = (): Promise<TResult> => this.queryBus.execute<IQuery, TResult>(query);

        return this.behaviors.reduceRight<() => Promise<TResult>>(
            (next, behavior) => () => behavior.execute<TResult>(query, next),
            dispatch,
        )();
    }
}
