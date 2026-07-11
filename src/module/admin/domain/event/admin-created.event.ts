/**
 * @file admin-created.event.ts
 * @description Typed domain event emitted when a new admin is created.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a new admin is created.
 * Persisted to the outbox within the same transaction as the Admin aggregate.
 */
export class AdminCreatedEvent implements IDomainEvent {
    readonly type = AdminEvent.CREATED;

    /**
     * Initializes the AdminCreatedEvent.
     *
     * @param id The ID of the newly created admin
     */
    constructor(readonly id: string) {}
}
