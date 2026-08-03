/**
 * @file event-publisher.adapter.ts
 * @description In-process event publisher backed by NestJS EventEmitter2.
 */

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IEventPublisherPort } from 'src/core/event-bus/port/event-publisher.port';
import type { DispatchedDomainEvent } from 'src/shared/application/event';

/**
 * Publishes events through EventEmitter2 — the one legal owner of that class, so the
 * transport stays swappable behind the port.
 */
@Injectable()
export class EventPublisherAdapter implements IEventPublisherPort {
    constructor(private readonly eventEmitter: EventEmitter2) {}

    async emitAsync(event: string, payload: DispatchedDomainEvent) {
        await this.eventEmitter.emitAsync(event, payload);
    }
}
