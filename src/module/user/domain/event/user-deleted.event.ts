/**
 * @file user-deleted.event.ts
 * @description Typed domain event emitted when a user is soft-deleted.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a user is soft-deleted.
 * Persisted to the outbox within the same transaction as the User aggregate.
 */
export class UserDeletedEvent implements IDomainEvent {
    readonly type = UserEvent.DELETED;

    constructor(readonly id: string) {}
}
