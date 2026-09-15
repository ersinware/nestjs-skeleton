/**
 * @file module.ts
 * @description Wires the in-process event publisher.
 */

import { Module } from '@nestjs/common';
import { EventPublisherAdapter } from 'src/core/event-bus/adapter/event-publisher.adapter';
import { TOKEN_EVENT_PUBLISHER_PORT } from 'src/core/event-bus/port/event-publisher.port';

/**
 * Exposes publishing through the application's EventEmitter2 instance.
 */
@Module({
    providers: [{ provide: TOKEN_EVENT_PUBLISHER_PORT, useClass: EventPublisherAdapter }],
    exports: [TOKEN_EVENT_PUBLISHER_PORT],
})
export class EventBusModule {}
