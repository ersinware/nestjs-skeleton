/**
 * @file user-session.listener.ts
 * @description Event listener responsible for managing user sessions and bans when domain events occur.
 */

import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_SESSION_SERVICE } from 'src/common/port/security/session.constant';
import type { ISessionService } from 'src/common/port/security/session.service.interface';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { UserEvent } from '../enum/user-event.enum';
import type { UserDeletedEvent } from '../event/user-deleted.event';
import type { UserStatusChangedEvent } from '../event/user-status-changed.event';

/**
 * Listener to keep the session state synchronized with database mutations by reacting to user events.
 */
@Injectable()
export class UserSessionListener {
    /**
     * Injects the required session service.
     *
     * @param sessionService The service managing active user sessions and bans.
     */
    constructor(@Inject(TOKEN_SESSION_SERVICE) private readonly sessionService: ISessionService) {}

    /**
     * Handles the user deletion event.
     * Closes all active sessions and bans the user identifier.
     *
     * @param event The delete event payload containing the user ID.
     */
    @OnEvent(UserEvent.DELETED)
    async handleUserDeleted(event: UserDeletedEvent) {
        await this.sessionService.closeAllSessions(AuthUserRole.USER, event.userId);
        await this.sessionService.ban(AuthUserRole.USER, event.userId);
    }

    /**
     * Handles the user status change event.
     * Bans the user and closes sessions if deactivated, unbans if activated.
     *
     * @param event The status changed event payload containing the user ID and new status.
     */
    @OnEvent(UserEvent.STATUS_CHANGED)
    async handleUserStatusChanged(event: UserStatusChangedEvent) {
        if (!event.isActive) {
            await this.sessionService.closeAllSessions(AuthUserRole.USER, event.userId);
            await this.sessionService.ban(AuthUserRole.USER, event.userId);
        } else {
            await this.sessionService.unban(AuthUserRole.USER, event.userId);
        }
    }
}
