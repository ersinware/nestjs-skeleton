/**
 * @file module.ts
 * @description Wires the event publisher port to its in-process adapter.
 */

import { Module } from '@nestjs/common';
import { EventPublisherAdapter } from 'src/core/event-bus/adapter/event-publisher.adapter';
import { TOKEN_EVENT_PUBLISHER_PORT } from 'src/core/event-bus/port/event-publisher.port';

/**
 * Provides the event publisher. Each module that publishes events imports it explicitly.
 */
@Module({
    providers: [
        {
            provide: TOKEN_EVENT_PUBLISHER_PORT,
            useClass: EventPublisherAdapter,
        },
    ],
    exports: [TOKEN_EVENT_PUBLISHER_PORT],
})
export class EventBusModule {}
