/**
 * @file index.ts
 * @description Public entry point of the event concern. Nothing outside may import past this barrel.
 */

export type { DispatchedDomainEvent } from 'src/shared/application/event/dispatched-domain-event.type';
export type { DurableEvent } from 'src/shared/application/event/durable-event.type';
