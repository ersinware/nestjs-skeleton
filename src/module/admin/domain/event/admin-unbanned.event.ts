/**
 * @file admin-unbanned.event.ts
 * @description Typed domain event emitted when an admin's active status changes to true.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when an admin account is unbanned (reactivated).
 * Persisted to the outbox within the same transaction as the Admin aggregate.
 */
export class AdminUnbannedEvent implements IDomainEvent {
    readonly type = AdminEvent.UNBANNED;

    /**
     * Initializes the AdminUnbannedEvent.
     *
     * @param id The ID of the unbanned admin
     */
    constructor(readonly id: string) {}
}
