/**
 * @file event-publisher.adapter.ts
 * @description Atomic durable acceptance with a transitional in-process publishing API.
 */

import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DeliveryRecord } from 'src/core/event-bus/delivery-record.type';
import { TOKEN_DELIVERY_ROUTES, type DeliveryRoutes } from 'src/core/event-bus/delivery-routes.type';
import { createDeliveryTopology } from 'src/core/event-bus/delivery-topology.util';
import type { IEventPublisherPort } from 'src/core/event-bus/port/event-publisher.port';
import { TOKEN_JOB_QUEUE_PORT, type IJobQueuePort } from 'src/core/job-queue';
import type { DispatchedDomainEvent, DurableEvent } from 'src/shared/application/event';
import { SystemException } from 'src/shared/exception';

/**
 * Persists explicit fan-out through the ambient primary transaction; legacy emit remains immediate.
 */
@Injectable()
export class EventPublisherAdapter implements IEventPublisherPort {
    /**
     * Registers storage from the producer's validated routing catalog.
     *
     * @param eventEmitter Transitional in-process transport
     * @param jobQueuePort Shared queue registration and atomic job acceptance
     * @param routes Required context-specific event catalog
     */
    constructor(
        private readonly eventEmitter: EventEmitter2,
        @Inject(TOKEN_JOB_QUEUE_PORT) private readonly jobQueuePort: IJobQueuePort,
        @Inject(TOKEN_DELIVERY_ROUTES) private readonly routes: DeliveryRoutes,
    ) {
        this.jobQueuePort.register(createDeliveryTopology(routes));
    }

    /**
     * Inserts every target using the same primary transaction, preserving the logical event identity.
     *
     * @param event Minimal event identity and aggregate reference
     */
    async publish(event: DurableEvent) {
        if (!Object.hasOwn(this.routes.events, event.eventType)) {
            throw new SystemException(`Missing delivery route: ${event.eventType}.`);
        }

        await this.jobQueuePort.enqueue(this.routes.schema, this.routes.events[event.eventType]!, {
            event: { eventId: event.eventId, eventType: event.eventType, aggregateId: event.aggregateId },
        } satisfies DeliveryRecord);
    }

    /**
     * Dispatches immediately without transaction coordination.
     *
     * @param event Event name
     * @param payload Event identity and aggregate reference
     */
    async emitAsync(event: string, payload: DispatchedDomainEvent) {
        await this.eventEmitter.emitAsync(event, payload);
    }
}
