/**
 * @file job-trace-context.ts
 * @description Carries a W3C producer span reference through durable job payloads.
 */

import {
    context,
    isSpanContextValid,
    propagation,
    ROOT_CONTEXT,
    SpanKind,
    SpanStatusCode,
    trace,
    type SpanContext,
} from '@opentelemetry/api';
import { toError } from 'src/shared/exception';

/**
 * Shared tracer for queue production and delivery attempts.
 */
const tracer = trace.getTracer('job-queue');

/**
 * Runs one queue insertion under a producer span.
 *
 * @param queueName Destination queue
 * @param insert Performs the queue insertion while the producer span is active
 * @returns Result of the insertion
 */
export function runInJobProducerSpan<T>(queueName: string, insert: () => Promise<T>): Promise<T> {
    return tracer.startActiveSpan(
        `enqueue ${queueName}`,
        {
            kind: SpanKind.PRODUCER,
            attributes: {
                'messaging.system': 'pg-boss',
                'messaging.operation.name': 'enqueue',
                'messaging.operation.type': 'send',
                'messaging.destination.name': queueName,
            },
        },
        async (span) => {
            try {
                return await insert();
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

/**
 * Captures the active producer span without persisting baggage or vendor trace state.
 *
 * @returns W3C traceparent, or undefined when no producer span is active
 */
export function captureJobTraceparent(): string | undefined {
    const carrier: Record<string, string> = {};

    propagation.inject(context.active(), carrier);

    return typeof carrier['traceparent'] === 'string' ? carrier['traceparent'] : undefined;
}

/**
 * Runs one delivery attempt in a new trace linked to its producer.
 *
 * @param queueName Source queue being consumed
 * @param jobId Claimed pg-boss job identifier
 * @param deliveryId Logical delivery identifier
 * @param traceparent Persisted producer span reference, if present
 * @param consume Consumes the job while the consumer span is active
 * @returns Result of consuming the job
 */
export function runInJobConsumerSpan<T>(
    queueName: string,
    jobId: string,
    deliveryId: string,
    traceparent: string | undefined,
    consume: () => Promise<T>,
): Promise<T> {
    const producer = extractJobTraceparent(traceparent);

    return tracer.startActiveSpan(
        `consume ${queueName}`,
        {
            kind: SpanKind.CONSUMER,
            links: producer === undefined ? [] : [{ context: producer }],
            attributes: {
                'messaging.system': 'pg-boss',
                'messaging.operation.name': 'consume',
                'messaging.operation.type': 'process',
                'messaging.destination.name': queueName,
                'messaging.message.id': jobId,
                'job_queue.delivery_id': deliveryId,
            },
        },
        ROOT_CONTEXT,
        async (span) => {
            try {
                return await consume();
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

/**
 * Extracts a valid producer span context from a persisted traceparent.
 *
 * @param value Untrusted traceparent from a stored job
 * @returns Producer span context, or undefined for absent or malformed metadata
 */
function extractJobTraceparent(value: unknown): SpanContext | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const spanContext = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, { traceparent: value }));

    return spanContext !== undefined && isSpanContextValid(spanContext) ? spanContext : undefined;
}
