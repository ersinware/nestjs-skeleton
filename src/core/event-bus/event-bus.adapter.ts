/**
 * @file event-bus.adapter.ts
 * @description Implementation of the event bus port using NestJS EventEmitter2.
 */

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IEventBusPort } from 'src/core/event-bus/event-bus.port';

/**
 * Adapter implementation for the Event Bus port using NestJS EventEmitter2.
 * Responsible for dispatching domain events globally across the application.
 */
@Injectable()
export class EventBusAdapter implements IEventBusPort {
    /**
     * Creates an instance of EventBusAdapter.
     *
     * @param eventEmitter - The underlying NestJS event emitter instance used to dispatch events.
     */
    constructor(private readonly eventEmitter: EventEmitter2) {}

    /**
     * Asynchronously emits an event with the given payload.
     *
     * @param event - The name or identifier of the event to be emitted.
     * @param payload - The data associated with the event.
     * @throws Throws if the underlying event emitter encounters an unhandled synchronous exception.
     */
    async emitAsync(event: string, payload: unknown) {
        await this.eventEmitter.emitAsync(event, payload);
    }
}
