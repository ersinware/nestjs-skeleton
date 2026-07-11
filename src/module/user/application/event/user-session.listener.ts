/**
 * @file user-session.listener.ts
 * @description Event listener responsible for managing user sessions and bans when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';

import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import {
    UserEvent,
    type UserBannedEvent,
    type UserDeletedEvent,
    type UserPasswordChangedEvent,
    type UserUnbannedEvent,
} from 'src/module/user/domain/event';
import { UserRole } from 'src/shared/domain/user';

/**
 * Listener to keep the session state synchronized with database mutations by reacting to user events.
 */
@Injectable()
export class UserSessionListener {
    /**
     * Injects the required session service and query bus.
     *
     * @param queryBus The query bus to fetch current state.
     * @param sessionPort The service managing active user sessions and bans.
     */
    constructor(@Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort) {}

    /**
     * Handles the user status change and deletion events.
     * Revokes all active sessions and bans the user when they are deleted or banned.
     *
     * @param event The event payload containing the user ID.
     */
    @OnEvent(UserEvent.DELETED)
    @OnEvent(UserEvent.BANNED)
    async handleUserAccessRevoked(event: UserDeletedEvent | UserBannedEvent) {
        // No query is needed since the role is static
        await Promise.all([
            this.sessionPort.closeAllSessions(UserRole.USER, event.id),
            this.sessionPort.ban(UserRole.USER, event.id),
        ]);
    }

    /**
     * Revokes all active sessions when a user's password changes, ensuring all devices must re-authenticate.
     */
    @OnEvent(UserEvent.PASSWORD_CHANGED)
    async handleUserPasswordChanged(event: UserPasswordChangedEvent) {
        // No query is needed since the role is static
        await this.sessionPort.closeAllSessions(UserRole.USER, event.id);
    }

    @OnEvent(UserEvent.UNBANNED)
    async handleUserUnbanned(event: UserUnbannedEvent) {
        // No query is needed for the role since it is static
        await this.sessionPort.unban(UserRole.USER, event.id);
    }
}
