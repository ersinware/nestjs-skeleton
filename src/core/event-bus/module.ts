/**
 * @file module.ts
 * @description The EventBus module that provides the global messaging infrastructure.
 */

import { Module } from '@nestjs/common';
import { EventBusAdapter } from 'src/core/event-bus/event-bus.adapter';
import { TOKEN_EVENT_BUS_PORT } from 'src/core/event-bus/event-bus.port';

/**
 * Module that registers and exports the Event Bus infrastructure.
 * Each module that publishes domain events imports it explicitly.
 */
@Module({
    providers: [
        {
            provide: TOKEN_EVENT_BUS_PORT,
            useClass: EventBusAdapter,
        },
    ],
    exports: [TOKEN_EVENT_BUS_PORT],
})
export class EventBusModule {}
