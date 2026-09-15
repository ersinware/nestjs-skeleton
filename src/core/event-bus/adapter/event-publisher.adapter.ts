/**
 * @file event-publisher.adapter.ts
 * @description Publishes events through the in-process event emitter.
 */

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IEventPublisherPort } from 'src/core/event-bus/port/event-publisher.port';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Dispatches events immediately, independently of database commit.
 */
@Injectable()
export class EventPublisherAdapter implements IEventPublisherPort {
    /**
     * Injects the application event emitter.
     *
     * @param eventEmitter In-process transport
     */
    constructor(private readonly eventEmitter: EventEmitter2) {}

    /**
     * Dispatches immediately without transaction coordination.
     *
     * @param event Event name
     * @param payload Aggregate reference
     */
    async publish(event: string, payload: DispatchedDomainEvent) {
        await this.eventEmitter.emitAsync(event, payload);
    }
}
