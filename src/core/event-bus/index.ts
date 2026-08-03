/**
 * @file index.ts
 * @description Public entry point of the event-bus concern. Nothing outside may import past this barrel.
 */

export { EventBusModule } from 'src/core/event-bus/module';
export { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus/port/event-publisher.port';
