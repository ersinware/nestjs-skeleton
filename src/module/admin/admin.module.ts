/**
 * @file admin.module.ts
 * @description NestJS wiring of the admin bounded context.
 */

import { Module } from '@nestjs/common';
import { CqrsPipelineModule } from 'src/core/cqrs';
import { DatabaseModule } from 'src/core/database';
import { EmailModule } from 'src/core/email';
import { EventBusModule } from 'src/core/event-bus';
import { AuditModule } from 'src/core/observability/audit';
import { SessionModule } from 'src/core/security/session';
import { AdminFacade } from 'src/module/admin/admin.facade';
import { BanAdminCommandHandler } from 'src/module/admin/application/command/ban-admin/handler';
import { DeleteAdminCommandHandler } from 'src/module/admin/application/command/delete-admin/handler';
import { TOKEN_ADMIN_WRITER_PORT } from 'src/module/admin/application/command/port/admin-writer.port';
import { ReconcileAdminSessionCommandHandler } from 'src/module/admin/application/command/reconcile-admin-session/handler';
import { RevokeAdminSessionsCommandHandler } from 'src/module/admin/application/command/revoke-admin-sessions/handler';
import { UnbanAdminCommandHandler } from 'src/module/admin/application/command/unban-admin/handler';
import { AdminReuseListener } from 'src/module/admin/application/event/admin-reuse.listener';
import { AdminSessionListener } from 'src/module/admin/application/event/admin-session.listener';
import { GetAdminAuthStateQueryHandler } from 'src/module/admin/application/query/get-admin-auth-state/handler';
import { TOKEN_GET_ADMIN_AUTH_STATE_PORT } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { GetAdminCredentialsByEmailQueryHandler } from 'src/module/admin/application/query/get-admin-credentials-by-email/handler';
import { TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { TOKEN_GET_ADMIN_SESSION_VERSION_PORT } from 'src/module/admin/application/query/get-admin-session-version/port';
import { ListAdminsQueryHandler } from 'src/module/admin/application/query/list-admins/handler';
import { TOKEN_LIST_ADMINS_PORT } from 'src/module/admin/application/query/list-admins/port';
import { AdminReaderAdapter } from 'src/module/admin/infrastructure/adapter/admin-reader.adapter';
import { AdminWriterAdapter } from 'src/module/admin/infrastructure/adapter/admin-writer.adapter';
import { AdminController } from 'src/module/admin/presentation/controller/admin.controller';

/**
 * Wires the admin bounded context: binds every port token to its adapter, registers the handlers and
 * listeners, and exports only the facade — the sole surface other modules may consume.
 */
@Module({
    imports: [AuditModule, DatabaseModule, EventBusModule, SessionModule, EmailModule, CqrsPipelineModule],
    controllers: [AdminController],
    providers: [
        AdminFacade,
        DeleteAdminCommandHandler,
        BanAdminCommandHandler,
        UnbanAdminCommandHandler,
        RevokeAdminSessionsCommandHandler,
        ReconcileAdminSessionCommandHandler,
        ListAdminsQueryHandler,
        GetAdminCredentialsByEmailQueryHandler,
        GetAdminAuthStateQueryHandler,
        AdminReuseListener,
        AdminSessionListener,
        { provide: TOKEN_ADMIN_WRITER_PORT, useClass: AdminWriterAdapter },
        { provide: TOKEN_GET_ADMIN_AUTH_STATE_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_CREDENTIALS_BY_EMAIL_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_GET_ADMIN_SESSION_VERSION_PORT, useClass: AdminReaderAdapter },
        { provide: TOKEN_LIST_ADMINS_PORT, useClass: AdminReaderAdapter },
    ],
    exports: [AdminFacade],
})
export class AdminModule {}
