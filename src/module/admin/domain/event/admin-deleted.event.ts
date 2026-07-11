/**
 * @file admin-deleted.event.ts
 * @description Typed domain event emitted when an admin is soft-deleted.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when an admin account is soft-deleted.
 * Persisted to the outbox within the same transaction as the Admin aggregate.
 */
export class AdminDeletedEvent implements IDomainEvent {
    readonly type = AdminEvent.DELETED;

    /**
     * Initializes the AdminDeletedEvent.
     *
     * @param id The ID of the soft-deleted admin
     */
    constructor(readonly id: string) {}
}
