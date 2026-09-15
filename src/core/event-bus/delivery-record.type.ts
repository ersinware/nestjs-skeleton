/**
 * @file delivery-record.type.ts
 * @description Persisted job data separates event identity from optional technical correlation.
 */

import type { DurableEvent } from 'src/shared/application/event';

/**
 * Shared by every target delivery; telemetry is populated by enqueue instrumentation, not callers.
 */
export type DeliveryRecord = {
    /**
     * Minimal, transport-neutral event contract.
     */
    readonly event: DurableEvent;

    /**
     * Optional source context; absent until enqueue tracing is implemented.
     */
    readonly telemetry?: {
        /**
         * Source trace identity for correlation.
         */
        readonly traceId?: string;

        /**
         * Source W3C span context for a future consumer span link.
         */
        readonly traceparent?: string;
    };
};
