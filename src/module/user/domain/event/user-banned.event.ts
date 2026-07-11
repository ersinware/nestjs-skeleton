/**
 * @file user-banned.event.ts
 * @description Typed domain event emitted when a user is banned.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a user is banned.
 * Persisted to the outbox within the same transaction as the User aggregate.
 */
export class UserBannedEvent implements IDomainEvent {
    readonly type = UserEvent.BANNED;

    constructor(readonly id: string) {}
}
