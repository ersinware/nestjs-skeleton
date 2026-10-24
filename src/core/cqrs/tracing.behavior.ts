/**
 * @file tracing.behavior.ts
 * @description Pipeline behavior that wraps every dispatched command and query in an OpenTelemetry
 * span, so a use case is visible in a trace by name whichever edge (controller, facade, listener,
 * cron) dispatched it, and Tempo's span metrics count it as one thing.
 */

import { Injectable } from '@nestjs/common';
import { Command, type ICommand, type IQuery } from '@nestjs/cqrs';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { ICommandBehavior } from 'src/core/cqrs/command.pipeline';
import type { IQueryBehavior } from 'src/core/cqrs/query.pipeline';
import { toError } from 'src/shared/exception';

/**
 * The dispatched message's role, carried as a span attribute so a query and a command never merge.
 */
enum MessageKind {
    COMMAND = 'command',
    QUERY = 'query',
}

/**
 * Outermost behavior on both pipelines: it opens the span before caching or invalidation run, so
 * a cache hit is still a (short) span rather than an invisible read. A thrown error is recorded on
 * the span and rethrown untouched — the global filter still owns logging and the HTTP mapping.
 */
@Injectable()
export class TracingBehavior implements ICommandBehavior, IQueryBehavior {
    private readonly tracer = trace.getTracer('cqrs');

    /**
     * Runs the dispatched message inside a span named `<kind> <ClassName>` (e.g.
     * `command RegisterUserCommand`), the same attributes carried as `cqrs.kind` / `cqrs.name` so
     * TraceQL can filter on either. The kind comes from the framework base class every message
     * extends, never from its name. A rejection is recorded on the span and rethrown unchanged:
     * the span states that the use case failed, the global filter still decides what that means.
     *
     * @param message The dispatched command or query
     * @param next Invokes the remainder of the pipeline (ultimately the handler)
     * @returns The result returned by the handler or by a later behavior (e.g. the cache)
     */
    execute<TResult>(message: ICommand | IQuery, next: () => Promise<TResult>): Promise<TResult> {
        const name = message.constructor.name,
            kind = message instanceof Command ? MessageKind.COMMAND : MessageKind.QUERY;

        return this.tracer.startActiveSpan(
            `${kind} ${name}`,
            { attributes: { 'cqrs.kind': kind, 'cqrs.name': name } },
            async (span) => {
                try {
                    return await next();
                } catch (error) {
                    span.recordException(toError(error));
                    span.setStatus({ code: SpanStatusCode.ERROR });

                    throw error;
                } finally {
                    span.end();
                }
            },
        );
    }
}
