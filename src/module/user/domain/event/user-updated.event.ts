/**
 * @file user-updated.event.ts
 * @description Typed domain event emitted when a user's profile is updated.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a user's profile (name or email) is updated.
 * Persisted to the outbox within the same transaction as the User aggregate.
 */
export class UserUpdatedEvent implements IDomainEvent {
    readonly type = UserEvent.UPDATED;

    constructor(readonly id: string) {}
}
