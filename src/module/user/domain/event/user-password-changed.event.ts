/**
 * @file user-password-changed.event.ts
 * @description Typed domain event emitted when a user's password is changed.
 */

import { UserEvent } from 'src/module/user/domain/event/user-event.enum';
import type { IDomainEvent } from 'src/shared/domain/event';

/**
 * Domain event dispatched when a user's password is changed.
 * Persisted to the outbox within the same transaction as the User aggregate.
 */
export class UserPasswordChangedEvent implements IDomainEvent {
    readonly type = UserEvent.PASSWORD_CHANGED;

    constructor(readonly id: string) {}
}
