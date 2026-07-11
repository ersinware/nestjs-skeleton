/**
 * @file user-unbanned.event.ts
 * @description Typed domain event emitted when a user is unbanned.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a user is unbanned.
 * Persisted to the outbox within the same transaction as the User aggregate.
 */
export class UserUnbannedEvent implements IDomainEvent {
    readonly type = UserEvent.UNBANNED;

    constructor(readonly id: string) {}
}
