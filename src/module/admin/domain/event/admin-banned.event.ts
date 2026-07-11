/**
 * @file admin-banned.event.ts
 * @description Typed domain event emitted when an admin's active status changes to false.
 */

import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when an admin account is banned (deactivated).
 * Persisted to the outbox within the same transaction as the Admin aggregate.
 */
export class AdminBannedEvent implements IDomainEvent {
    readonly type = AdminEvent.BANNED;

    /**
     * Initializes the AdminBannedEvent.
     *
     * @param id The ID of the banned admin
     */
    constructor(readonly id: string) {}
}
