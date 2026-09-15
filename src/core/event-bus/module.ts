/**
 * @file module.ts
 * @description Wires context-specific publishers over shared delivery storage.
 */

import { Module, type DynamicModule } from '@nestjs/common';
import { EventPublisherAdapter } from 'src/core/event-bus/adapter/event-publisher.adapter';
import { TOKEN_DELIVERY_ROUTES, type DeliveryRoutes } from 'src/core/event-bus/delivery-routes.type';
import { TOKEN_EVENT_PUBLISHER_PORT } from 'src/core/event-bus/port/event-publisher.port';
import { JobQueueModule } from 'src/core/job-queue';

/**
 * Keeps the storage singleton while giving each producer its own acceptance routes.
 */
@Module({
    imports: [JobQueueModule],
})
export class EventBusModule {
    /**
     * Registers the producer's allowed event-to-consumer mapping.
     *
     * @param routes Producer schema and versioned event targets
     * @returns Publisher module scoped to this routing catalog
     */
    static register(routes: DeliveryRoutes): DynamicModule {
        return {
            module: EventBusModule,
            providers: [
                { provide: TOKEN_DELIVERY_ROUTES, useValue: routes },
                { provide: TOKEN_EVENT_PUBLISHER_PORT, useClass: EventPublisherAdapter },
            ],
            exports: [TOKEN_EVENT_PUBLISHER_PORT],
        };
    }
}
