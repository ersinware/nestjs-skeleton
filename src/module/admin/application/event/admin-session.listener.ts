/**
 * @file admin-session.listener.ts
 * @description Event listener responsible for revoking or restoring admin sessions in response to status change events.
 * Decouples session management from the command handler, ensuring sessions are only affected after the DB write commits.
 */

import { Inject, Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import { TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security';
import { GetAdminRoleQuery, type GetAdminRoleResult } from 'src/module/admin/application/query/get-admin-role';
import {
    GetDeletedAdminRoleQuery,
    type GetDeletedAdminRoleResult,
} from 'src/module/admin/application/query/get-deleted-admin-role';
import {
    AdminEvent,
    type AdminBannedEvent,
    type AdminDeletedEvent,
    type AdminUnbannedEvent,
} from 'src/module/admin/domain/event';

/**
 * Reacts to admin status changes by adjusting their active sessions and blocklist state.
 * Running as a post-commit outbox consumer guarantees that session revocation only happens
 * after the admin record is safely persisted.
 */
@Injectable()
export class AdminSessionListener {
    constructor(
        private readonly queryBus: QueryBus,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
    ) {}

    @OnEvent(AdminEvent.DELETED)
    async handleAdminDeleted(event: AdminDeletedEvent) {
        const role = await this.queryBus.execute<GetDeletedAdminRoleQuery, GetDeletedAdminRoleResult>(
            new GetDeletedAdminRoleQuery(event.id),
        );

        await Promise.all([this.sessionPort.closeAllSessions(role, event.id), this.sessionPort.ban(role, event.id)]);
    }

    @OnEvent(AdminEvent.UNBANNED)
    async handleAdminUnbanned(event: AdminUnbannedEvent) {
        const role = await this.queryBus.execute<GetAdminRoleQuery, GetAdminRoleResult>(
            new GetAdminRoleQuery(event.id),
        );

        await this.sessionPort.unban(role, event.id);
    }

    @OnEvent(AdminEvent.BANNED)
    async handleAdminBanned(event: AdminBannedEvent) {
        const role = await this.queryBus.execute<GetAdminRoleQuery, GetAdminRoleResult>(
            new GetAdminRoleQuery(event.id),
        );

        await Promise.all([this.sessionPort.closeAllSessions(role, event.id), this.sessionPort.ban(role, event.id)]);
    }
}
