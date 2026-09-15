/**
 * @file index.ts
 * @description Public entry point of the event-bus concern. Nothing outside may import past this barrel.
 */

export { OnAppEvent } from 'src/core/event-bus/decorator/on-app-event.decorator';
export type { DeliveryRoutes } from 'src/core/event-bus/delivery-routes.type';
export { defineDeliveryRoutes } from 'src/core/event-bus/delivery-routes.util';
export { createDeliveryTopology } from 'src/core/event-bus/delivery-topology.util';
export { EventBusModule } from 'src/core/event-bus/module';
export { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus/port/event-publisher.port';
