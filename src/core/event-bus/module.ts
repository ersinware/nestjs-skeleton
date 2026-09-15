/**
 * @file module.ts
 * @description Wires the in-process publisher and the pre-provisioned delivery storage.
 */

import { Module } from '@nestjs/common';
import { EventPublisherAdapter } from 'src/core/event-bus/adapter/event-publisher.adapter';
import { DeliveryStorage } from 'src/core/event-bus/delivery-storage';
import { TOKEN_EVENT_PUBLISHER_PORT } from 'src/core/event-bus/port/event-publisher.port';
import { ErrorReporterModule } from 'src/core/observability/error-reporter';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Provides the event publisher. Each module that publishes events imports it explicitly.
 */
@Module({
    imports: [LoggerModule, ErrorReporterModule],
    providers: [
        DeliveryStorage,
        {
            provide: TOKEN_EVENT_PUBLISHER_PORT,
            useClass: EventPublisherAdapter,
        },
    ],
    exports: [TOKEN_EVENT_PUBLISHER_PORT],
})
export class EventBusModule {}
